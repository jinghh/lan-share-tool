const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const address = require('address');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');
const { prepareDataDir } = require('./src/data-dir');
const { startTray } = require('./src/tray');
const autostart = require('./src/autostart');

// ========== 命令行参数 ==========
function parseArgs(argv) {
  const result = {
    dataDir: '',
    port: 0,
    tray: false,
    noOpen: false,
    autostartInstall: false,
    autostartRemove: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--data-dir':
        i += 1;
        result.dataDir = argv[i] || '';
        break;
      case '--port':
        i += 1;
        result.port = Number.parseInt(argv[i], 10) || 0;
        break;
      case '--tray':
        result.tray = true;
        break;
      case '--no-open':
        result.noOpen = true;
        break;
      case '--autostart-install':
        result.autostartInstall = true;
        break;
      case '--autostart-remove':
        result.autostartRemove = true;
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
      default:
        break;
    }
  }

  return result;
}

function printUsage() {
  console.log([
    '',
    '  LAN ShareBox —— 局域网文本 / 文件互传',
    '',
    '  用法: sharebox [选项]',
    '',
    '    --port <number>      指定端口（默认 3456，占用时自动顺延）',
    '    --data-dir <path>    指定数据目录（默认使用系统用户数据目录）',
    '    --tray               启动后驻留系统托盘（仅 Windows）',
    '    --no-open            启动后不自动打开浏览器',
    '    --autostart-install  设置开机自启',
    '    --autostart-remove   取消开机自启',
    '    -h, --help           显示帮助',
    '',
  ].join('\n'));
}

const CLI_ARGS = parseArgs(process.argv.slice(2));

if (CLI_ARGS.help) {
  printUsage();
  process.exit(0);
}

if (CLI_ARGS.autostartInstall) {
  const spec = autostart.install();
  console.log(`✅ 已设置开机自启: ${[spec.file].concat(spec.args).join(' ')}`);
  process.exit(0);
}

if (CLI_ARGS.autostartRemove) {
  autostart.remove();
  console.log('✅ 已取消开机自启');
  process.exit(0);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 100 * 1024 * 1024, // 100MB for Socket.IO
});

let PORT = CLI_ARGS.port || process.env.PORT || 3456;

// ========== 数据目录 ==========
// 打包成 exe / .app 后安装目录可能只读，数据统一放到系统用户数据目录
const {
  dataDir: DATA_DIR,
  uploadsDir: UPLOADS_DIR,
  migration,
} = prepareDataDir(CLI_ARGS.dataDir);
process.env.SHAREBOX_DATA_DIR = DATA_DIR; // 托盘「打开数据目录」菜单使用

const MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1GB
const MAX_MESSAGES = 50;

// 旧版本把数据放在运行目录的 uploads/ 下，升级后一次性搬过来
if (migration) {
  console.log(`📦 已迁移 ${migration.moved} 个历史文件: ${migration.from} → ${migration.to}`);
}

// ========== 本机判断（用于「清理」权限） ==========
// 运行服务的本机局域网 IP（访问自身时来源 IP 可能是它）
const SERVER_LAN_IP = address.ip();

// 判断连接是否来自「运行服务的本机」：
//   - 环回地址（localhost 访问）：::1 / 127.0.0.1 / 127.x
//   - 本机局域网 IP（同机用 LAN 地址访问）
function isLocalhost(ip) {
  if (!ip) return false;
  const normalized = String(ip).replace(/^::ffff:/, '');
  return normalized === '::1'
      || normalized === '127.0.0.1'
      || normalized.startsWith('127.')
      || normalized === SERVER_LAN_IP;
}

// 清空 uploads 目录里的所有上传文件（保留 .gitkeep / .metadata.json / .messages.json），返回删除数量
function cleanUploads() {
  const files = fs.readdirSync(UPLOADS_DIR);
  let count = 0;
  files.forEach((file) => {
    // 跳过所有隐藏文件（以 . 开头）：.gitkeep / .metadata.json / .messages.json
    if (file.startsWith('.')) return;
    try {
      fs.unlinkSync(path.join(UPLOADS_DIR, file));
      count++;
    } catch (e) {
      // 忽略单个文件删除失败
    }
  });
  return count;
}

// ========== 文件元数据持久化 ==========
// 目的：服务重启后能恢复上传文件列表（文件本身保留在磁盘上）
const METADATA_FILE = path.join(UPLOADS_DIR, '.metadata.json');

// 启动时恢复文件记录（只恢复磁盘上实际存在的文件）
function loadFileMetadata() {
  try {
    if (fs.existsSync(METADATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'));
      if (Array.isArray(data)) {
        data.forEach((fi) => {
          if (fi.id && fi.storedName && fs.existsSync(path.join(UPLOADS_DIR, fi.storedName))) {
            availableFiles.set(fi.id, fi);
          }
        });
        if (availableFiles.size > 0) {
          console.log(`📁 已恢复 ${availableFiles.size} 个文件记录`);
        }
      }
    }
  } catch (e) {
    console.warn('⚠️  文件元数据恢复失败，将忽略:', e.message);
  }
}

// 每次文件增删后持久化元数据
function saveFileMetadata() {
  try {
    const data = JSON.stringify(Array.from(availableFiles.values()));
    fs.writeFileSync(METADATA_FILE, data, 'utf-8');
  } catch (e) {
    console.warn('⚠️  文件元数据保存失败:', e.message);
  }
}

// ========== 消息持久化 ==========
const MESSAGES_FILE = path.join(UPLOADS_DIR, '.messages.json');

function loadMessages() {
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      const data = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'));
      if (Array.isArray(data)) {
        data.forEach((m) => {
          if (m && m.id && m.content) recentMessages.push(m);
        });
        // 数量上限裁剪
        while (recentMessages.length > MAX_MESSAGES) recentMessages.shift();
        if (recentMessages.length > 0) {
          console.log(`💬 已恢复 ${recentMessages.length} 条历史消息`);
        }
      }
    }
  } catch (e) {
    console.warn('⚠️  消息恢复失败，将忽略:', e.message);
  }
}

function saveMessages() {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(recentMessages), 'utf-8');
  } catch (e) {
    console.warn('⚠️  消息保存失败:', e.message);
  }
}

// ========== 内存数据存储 ==========
const onlineDevices = new Map();   // socketId → { id, name, ip, type }
const recentMessages = [];         // [{ id, from, content, timestamp }]
const availableFiles = new Map();  // fileId → { id, originalName, size, mimeType, from, timestamp, storedName }

// 启动时从磁盘恢复文件列表与历史消息
loadFileMetadata();
loadMessages();

// ========== Multer 配置 ==========
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const storedName = `${uuidv4()}${ext}`;
    cb(null, storedName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
});

// ========== Express 中间件 ==========
app.use(express.static(path.join(__dirname, 'public')));

// 文件上传（支持批量）
app.post('/api/upload', upload.array('files', 50), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: '没有选择文件' });
  }

  const results = [];
  const batchFiles = [];

  for (const file of req.files) {
    const fileId = uuidv4();
    const fileInfo = {
      id: fileId,
      originalName: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      storedName: file.filename,
      from: req.body.from || '未知设备',
      timestamp: Date.now(),
    };

    availableFiles.set(fileId, fileInfo);
    batchFiles.push({
      id: fileId,
      originalName: fileInfo.originalName,
      size: fileInfo.size,
      mimeType: fileInfo.mimeType,
      from: fileInfo.from,
      timestamp: fileInfo.timestamp,
    });
    results.push({ success: true, fileId, originalName: file.originalname });

    console.log(`📎 文件上传: ${fileInfo.originalName} (${(fileInfo.size / 1024).toFixed(1)} KB) 来自 ${fileInfo.from}`);
  }

  saveFileMetadata();

  // 批量通知所有连接的客户端
  io.emit('files-added', batchFiles);

  res.json({ success: true, files: results });
});

// 文件下载
app.get('/api/download/:fileId', (req, res) => {
  const fileInfo = availableFiles.get(req.params.fileId);
  if (!fileInfo) {
    return res.status(404).json({ error: '文件不存在或已过期' });
  }

  const filePath = path.join(UPLOADS_DIR, fileInfo.storedName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '文件已从磁盘删除' });
  }

  // ?inline=1 → 浏览器内联打开（本机用）；默认走下载（非本机设备用）
  if (req.query.inline) {
    res.setHeader('Content-Type', fileInfo.mimeType || 'application/octet-stream');
    res.sendFile(filePath);
  } else {
    res.download(filePath, fileInfo.originalName);
  }
});

// 二维码生成
app.get('/api/qrcode', async (req, res) => {
  try {
    const lanIP = address.ip();
    const url = `http://${lanIP}:${PORT}`;
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 280,
      margin: 2,
      color: { dark: '#ffffff', light: '#1e1e2e' },
    });
    res.json({ url, qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: '二维码生成失败' });
  }
});

// ========== Socket.IO 事件处理 ==========
io.on('connection', (socket) => {
  const clientIP = socket.handshake.address;
  const deviceId = uuidv4();
  const deviceInfo = {
    id: deviceId,
    name: `设备-${deviceId.slice(0, 6)}`,
    ip: clientIP,
    type: 'unknown',
    socketId: socket.id,
  };

  onlineDevices.set(socket.id, deviceInfo);

  console.log(`🔗 设备连接: ${deviceInfo.name} (${clientIP})，当前在线: ${onlineDevices.size}`);

  // 发送初始化数据给新设备
  socket.emit('init', {
    deviceId,
    deviceName: deviceInfo.name,
    isHost: isLocalhost(clientIP),
    onlineDevices: Array.from(onlineDevices.values()).map((d) => ({
      id: d.id,
      name: d.name,
      ip: d.ip,
      type: d.type,
    })),
    recentMessages,
    availableFiles: Array.from(availableFiles.values()).map((f) => ({
      id: f.id,
      originalName: f.originalName,
      size: f.size,
      mimeType: f.mimeType,
      from: f.from,
      timestamp: f.timestamp,
    })),
  });

  // 通知其他设备：新设备上线
  socket.broadcast.emit('device-joined', {
    id: deviceId,
    name: deviceInfo.name,
    ip: clientIP,
    type: deviceInfo.type,
  });

  // 设置设备名称和类型
  socket.on('set-device-name', (data) => {
    const dev = onlineDevices.get(socket.id);
    if (dev) {
      dev.name = data.name || dev.name;
      dev.type = data.type || dev.type;
      // 通知所有设备更新
      io.emit('device-updated', {
        id: dev.id,
        name: dev.name,
        ip: dev.ip,
        type: dev.type,
      });
    }
  });

  // 接收文本消息
  socket.on('send-text', (data) => {
    const dev = onlineDevices.get(socket.id);
    const from = dev ? dev.name : '未知设备';

    const message = {
      id: uuidv4(),
      from,
      content: data.content,
      timestamp: Date.now(),
    };

    recentMessages.push(message);

    // 限制消息数量
    while (recentMessages.length > MAX_MESSAGES) {
      recentMessages.shift();
    }
    saveMessages();

    // 广播给所有客户端（包括发送者以确认）
    io.emit('text-message', message);
    console.log(`💬 文本消息: "${data.content.slice(0, 50)}${data.content.length > 50 ? '...' : ''}" 来自 ${from}`);
  });

  // 清理（仅本机可执行）
  socket.on('clean', (data) => {
    // 权限校验：仅允许运行服务的本机
    if (!isLocalhost(socket.handshake.address)) {
      socket.emit('clean-error', { message: '只有本机可以执行清理' });
      console.log(`⚠️ 清理被拒绝: 来自 ${socket.handshake.address}`);
      return;
    }

    const type = (data && data.type) || 'all';
    const detail = [];

    if (type === 'text' || type === 'all') {
      recentMessages.length = 0;
      saveMessages();
      detail.push('文本消息');
    }
    if (type === 'file' || type === 'all') {
      const removed = cleanUploads();
      availableFiles.clear();
      saveFileMetadata();
      detail.push(`文件(${removed})`);
    }

    // 广播给所有设备，同步清空界面
    io.emit('cleaned', { type, by: deviceInfo.name });
    console.log(`🧹 清理完成: ${detail.join('、')}（由 ${deviceInfo.name} 发起）`);
  });

  // 断开连接
  socket.on('disconnect', () => {
    const dev = onlineDevices.get(socket.id);
    if (dev) {
      onlineDevices.delete(socket.id);
      io.emit('device-left', { id: dev.id, name: dev.name });
      console.log(`❌ 设备断开: ${dev.name}，当前在线: ${onlineDevices.size}`);
    }
  });
});

// ========== 优雅退出 ==========
let trayHandle = null;

function shutdown(code) {
  if (trayHandle) {
    try {
      trayHandle.dispose();
    } catch (e) {
      // 托盘进程已退出时忽略
    }
    trayHandle = null;
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === 'win32'
    ? `start "" "${url}"`
    : platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.log('  ⚠️  无法自动打开浏览器，请手动访问上面的地址');
    }
  });
}

// ========== 启动服务（端口自动切换） ==========
let startAttempted = false;

function startServer(port) {
  // 移除上一次的 error 监听器，避免累积
  server.removeAllListeners('error');

  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`  ⚠️  端口 ${port} 已被占用，尝试端口 ${port + 1}...`);
      server.close(() => {
        PORT = port + 1;
        startServer(port + 1);
      });
    } else {
      throw err;
    }
  });

  server.listen(port, '0.0.0.0', () => {
    const lanIP = address.ip();
    const localURL = `http://localhost:${port}`;
    const lanURL = `http://${lanIP}:${port}`;

    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  🔗  LAN ShareBox 已启动');
    console.log('═══════════════════════════════════════════');
    console.log(`  本地访问: ${localURL}`);
    console.log(`  局域网:   ${lanURL}`);
    console.log(`  数据目录: ${DATA_DIR}`);
    console.log('═══════════════════════════════════════════');
    console.log('');
    console.log('  手机扫描桌面端页面上的二维码即可连接');
    console.log('');

    // 首次启动：自动打开浏览器 + 按需驻留托盘
    if (!startAttempted) {
      startAttempted = true;

      if (CLI_ARGS.noOpen) {
        console.log('  已跳过自动打开浏览器（--no-open）');
      } else {
        openBrowser(localURL);
      }

      if (CLI_ARGS.tray) {
        startTray({ url: localURL, onQuit: () => shutdown(0) }).then((handle) => {
          if (handle) {
            trayHandle = handle;
            console.log('  已驻留系统托盘：右键托盘图标可打开页面 / 打开数据目录 / 退出');
          } else {
            console.log('  ⚠️  当前环境不支持托盘，已按普通方式运行');
          }
        });
      }
    }
  });
}

startServer(PORT);

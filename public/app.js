/* ========== LAN ShareBox — 前端逻辑 v2 ========== */

// ========== DOM 引用 ==========
const $ = (sel) => document.querySelector(sel);

const deviceCount = $('#deviceCount');
const deviceList = $('#deviceList');
const selfDevice = $('#selfDevice');
const qrImage = $('#qrImage');
const lanUrl = $('#lanUrl');
const messageList = $('#messageList');
const fileList = $('#fileList');
const textInput = $('#textInput');
const btnSend = $('#btnSend');
const fileInput = $('#fileInput');
const btnUpload = $('#btnUpload');
const uploadArea = $('#uploadArea');
const uploadProgress = $('#uploadProgress');
const progressFill = $('#progressFill');
const progressText = $('#progressText');
const toast = $('#toast');
const tabText = $('#tabText');
const tabFile = $('#tabFile');
const textPanel = $('#textPanel');
const filePanel = $('#filePanel');
const cleanupWrap = $('#cleanupWrap');
const btnCleanup = $('#btnCleanup');
const cleanupMenu = $('#cleanupMenu');
const cleanModalOverlay = $('#cleanModalOverlay');
const cleanModalIcon = $('#cleanModalIcon');
const cleanModalTitle = $('#cleanModalTitle');
const cleanModalDesc = $('#cleanModalDesc');
const cleanModalInputWrap = $('#cleanModalInputWrap');
const cleanModalInput = $('#cleanModalInput');
const cleanModalCancel = $('#cleanModalCancel');
const cleanModalConfirm = $('#cleanModalConfirm');

// ========== Socket.IO 连接 ==========
const socket = io({
  transports: ['websocket', 'polling'],
});

let myDeviceId = '';
let myDeviceName = '';
let isHost = false;

// 当前文件状态（id → size），用于清理前统计数量与总大小
const filesState = new Map();

// 连接状态日志
socket.on('connect', () => {
  console.log('✅ Socket.IO 已连接, sid:', socket.id);
});

socket.on('connect_error', (err) => {
  console.error('❌ Socket.IO 连接失败:', err.message);
  showToast('连接失败，请刷新页面重试', 'error');
});

socket.on('disconnect', (reason) => {
  console.warn('⚠️ Socket.IO 断开:', reason);
  if (reason === 'io server disconnect') {
    // 服务器主动断开，尝试重连
    socket.connect();
  }
});

// ========== 设备检测 ==========
function detectDevice() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return { type: 'iPhone', icon: '📱' };
  if (/iPad/.test(ua)) return { type: 'iPad', icon: '📱' };
  if (/Android/.test(ua)) return { type: 'Android', icon: '📱' };
  if (/Macintosh|Mac OS X/.test(ua)) return { type: 'Mac', icon: '💻' };
  if (/Windows/.test(ua)) return { type: 'Windows', icon: '🖥️' };
  if (/Linux/.test(ua) && !/Android/.test(ua)) return { type: 'Linux', icon: '🖥️' };
  return { type: 'Unknown', icon: '🔌' };
}

const myDevice = detectDevice();

function generateDeviceName() {
  switch (myDevice.type) {
    case 'iPhone': return 'iPhone';
    case 'iPad': return 'iPad';
    case 'Android': return 'Android 手机';
    case 'Mac': return 'Mac';
    case 'Windows': return 'Windows 电脑';
    case 'Linux': return 'Linux';
    default: return '未知设备';
  }
}

myDeviceName = generateDeviceName();

// ========== Toast 通知 ==========
let toastTimer;
function showToast(msg, type = '') {
  if (!toast) return;
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  void toast.offsetWidth;
  toast.classList.add('show');
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

// ========== 时间格式化 ==========
function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return time;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

// ========== 文件大小格式化 ==========
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ========== 文件图标 ==========
function getFileIcon(mimeType, fileName) {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.includes('pdf')) return '📄';
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar') || mimeType.includes('gz')) return '📦';
  if (mimeType.includes('text') || mimeType.includes('json') || mimeType.includes('xml')) return '📝';
  if (/\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(fileName || '')) return '📊';
  return '📎';
}

function isImage(mimeType) {
  return mimeType.startsWith('image/');
}

// ========== HTML 转义 ==========
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ========== 剪贴板复制 ==========
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('✅ 已复制到剪贴板', 'success');
    }).catch(() => {
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
    showToast('✅ 已复制到剪贴板', 'success');
  } catch (e) {
    showToast('复制失败，请手动复制', 'error');
  }
  document.body.removeChild(ta);
}

// ========== Socket.IO 事件处理 ==========

// 初始化：服务器发送当前完整状态
socket.on('init', (data) => {
  console.log('📩 收到 init 数据:', data);
  myDeviceId = data.deviceId;
  myDeviceName = data.deviceName;
  isHost = !!data.isHost;

  // 前端兜底：如果服务端未下发 isHost（旧版服务），用 location.hostname 判断
  // 最终 cleanup 动作仍由服务端 IP 校验，所以这里只影响按钮显隐，安全性不变
  if (!isHost) {
    var h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') {
      isHost = true;
    }
  }

  // 仅本机（运行服务的设备）显示清理入口
  if (isHost && cleanupWrap) {
    cleanupWrap.removeAttribute('hidden');
  }

  // 更新本设备显示
  if (selfDevice) {
    selfDevice.querySelector('.device-icon').textContent = myDevice.icon;
    selfDevice.querySelector('.device-name').textContent = '本设备 (' + myDeviceName + ')';
  }

  // 告知服务器真实设备类型和名称
  socket.emit('set-device-name', {
    name: myDeviceName,
    type: myDevice.type,
  });

  // 渲染在线设备
  renderDeviceList(data.onlineDevices || [], data.deviceId);

  // 渲染历史消息
  if (data.recentMessages && data.recentMessages.length > 0) {
    data.recentMessages.forEach((msg) => addMessage(msg, false));
  }

  // 渲染已有文件
  filesState.clear();
  if (data.availableFiles && data.availableFiles.length > 0) {
    data.availableFiles.forEach((f) => addFileItem(f));
  }

  updateDeviceCount();
});

// 新文本消息
socket.on('text-message', (msg) => {
  console.log('💬 收到消息:', msg.from, '→', msg.content.slice(0, 30));
  addMessage(msg, true);
});

// 新文件通知
socket.on('file-added', (file) => {
  console.log('📎 收到文件通知:', file.originalName);
  addFileItem(file);
  showToast('📎 收到文件: ' + file.originalName, 'success');
});

// 文件被删除
socket.on('file-removed', (data) => {
  filesState.delete(data.id);
  const el = document.querySelector('[data-file-id="' + data.id + '"]');
  if (el) {
    el.style.transition = 'opacity 0.2s';
    el.style.opacity = '0';
    setTimeout(() => {
      el.remove();
      checkFileEmpty();
    }, 200);
  }
});

// 清理完成（由本机发起，广播给所有设备）
socket.on('cleaned', (data) => {
  const type = (data && data.type) || 'all';
  if (type === 'text' || type === 'all') {
    if (messageList) messageList.innerHTML = '';
    checkMessageEmpty();
  }
  if (type === 'file' || type === 'all') {
    if (fileList) fileList.innerHTML = '';
    filesState.clear();
    checkFileEmpty();
  }
  const label = type === 'text' ? '文本消息' : type === 'file' ? '文件' : '文本与文件';
  showToast('🧹 已清理' + label, 'success');
});

// 清理被拒绝（非本机）
socket.on('clean-error', (data) => {
  showToast((data && data.message) || '清理失败', 'error');
});

// 设备上线
socket.on('device-joined', (device) => {
  console.log('🔗 设备上线:', device.name, device.type);
  addDeviceItem(device);
  updateDeviceCount();
  showToast('🔗 ' + (device.name || '未知设备') + ' 已连接');
});

// 设备离线
socket.on('device-left', (data) => {
  console.log('👋 设备离线:', data.name);
  const el = document.querySelector('[data-device-id="' + data.id + '"]');
  if (el) {
    el.remove();
    updateDeviceCount();
    showToast('👋 ' + data.name + ' 已断开');
  }
});

// 设备信息更新
socket.on('device-updated', (device) => {
  const el = document.querySelector('[data-device-id="' + device.id + '"]');
  if (el) {
    el.querySelector('.device-name').textContent = device.name;
    const iconMap = {
      iPhone: '📱', iPad: '📱', Android: '📱',
      Mac: '💻', Windows: '🖥️', Linux: '🖥️',
    };
    el.querySelector('.device-icon').textContent = iconMap[device.type] || '🔌';
  }
});

// ========== 渲染函数 ==========

function renderDeviceList(devices, selfId) {
  // 清除旧设备项（保留 selfDevice）
  const oldItems = deviceList.querySelectorAll('.device-item:not(.device-self)');
  oldItems.forEach((el) => el.remove());

  devices.forEach((device) => {
    if (device.id !== selfId) {
      addDeviceItem(device);
    }
  });
}

function addDeviceItem(device) {
  // 防重复
  if (document.querySelector('[data-device-id="' + device.id + '"]')) return;

  const iconMap = {
    iPhone: '📱', iPad: '📱', Android: '📱',
    Mac: '💻', Windows: '🖥️', Linux: '🖥️',
  };

  const li = document.createElement('li');
  li.className = 'device-item';
  li.setAttribute('data-device-id', device.id);
  li.innerHTML =
    '<span class="device-icon">' + (iconMap[device.type] || '🔌') + '</span>' +
    '<span class="device-name">' + escapeHtml(device.name) + '</span>';
  deviceList.appendChild(li);
}

function updateDeviceCount() {
  const count = deviceList.querySelectorAll('.device-item').length;
  deviceCount.textContent = '在线: ' + count;
}

// 添加消息到列表
function addMessage(msg, animate) {
  if (!messageList) return;

  // 清除空状态
  const empty = messageList.querySelector('.empty-state');
  if (empty) empty.remove();

  const msgDiv = document.createElement('div');
  msgDiv.className = 'message-item';
  if (animate) {
    msgDiv.style.opacity = '0';
    msgDiv.style.transform = 'translateY(10px)';
  }

  // 用 data 属性存储原始文本供复制使用
  msgDiv.setAttribute('data-content', msg.content);

  const fromHtml = escapeHtml(msg.from);
  const contentHtml = escapeHtml(msg.content);
  const timeStr = formatTime(msg.timestamp);

  msgDiv.innerHTML =
    '<div class="message-meta">' +
      '<span class="message-from">' + fromHtml + '</span>' +
      '<span class="message-time">' + timeStr + '</span>' +
    '</div>' +
    '<div class="message-bubble">' + contentHtml + '</div>' +
    '<div class="message-actions">' +
      '<button class="btn-copy" data-action="copy">📋 复制</button>' +
    '</div>';

  messageList.appendChild(msgDiv);

  // 滚动到底部
  requestAnimationFrame(() => {
    messageList.scrollTop = messageList.scrollHeight;
  });

  // 动画
  if (animate) {
    requestAnimationFrame(() => {
      msgDiv.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
      msgDiv.style.opacity = '1';
      msgDiv.style.transform = 'translateY(0)';
    });
  }
}

// 添加文件项
function addFileItem(file) {
  if (!fileList) return;

  const empty = fileList.querySelector('.empty-state');
  if (empty) empty.remove();

  // 记录文件大小，供清理前统计
  filesState.set(file.id, file.size || 0);

  if (document.querySelector('[data-file-id="' + file.id + '"]')) return;

  const fileDiv = document.createElement('div');
  fileDiv.className = 'file-item';
  fileDiv.setAttribute('data-file-id', file.id);

  const icon = getFileIcon(file.mimeType, file.originalName);
  const imgPreview = isImage(file.mimeType)
    ? '<img class="file-preview-img" src="/api/download/' + file.id + '" alt="" loading="lazy">'
    : '';

  fileDiv.innerHTML =
    (imgPreview || '<span class="file-icon">' + icon + '</span>') +
    '<div class="file-info">' +
      '<div class="file-name" title="' + escapeHtml(file.originalName) + '">' + escapeHtml(file.originalName) + '</div>' +
      '<div class="file-meta">' +
        '<span>' + formatSize(file.size) + '</span>' +
        '<span>来自 ' + escapeHtml(file.from) + '</span>' +
        '<span>' + formatTime(file.timestamp) + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="file-actions">' +
      (isHost
        ? '<button class="btn-download" data-action="open" data-file-id="' + file.id + '">📂 打开</button>'
        : '<button class="btn-download" data-action="download" data-file-id="' + file.id + '" data-file-name="' + escapeHtml(file.originalName) + '">⬇️ 下载</button>'
      ) +
    '</div>';

  fileList.appendChild(fileDiv);
}

function checkMessageEmpty() {
  if (messageList && messageList.querySelectorAll('.message-item').length === 0) {
    messageList.innerHTML =
      '<div class="empty-state">' +
      '<span class="empty-icon">💬</span>' +
      '<p>还没有消息，发送第一条吧</p>' +
      '</div>';
  }
}

function checkFileEmpty() {
  if (fileList && fileList.querySelectorAll('.file-item').length === 0) {
    fileList.innerHTML =
      '<div class="empty-state">' +
        '<span class="empty-icon">📎</span>' +
        '<p>还没有文件，上传第一个文件吧</p>' +
      '</div>';
  }
}

// ========== 事件委托：处理复制和下载按钮 ==========
document.addEventListener('click', (e) => {
  // 复制文本按钮
  const copyBtn = e.target.closest('[data-action="copy"]');
  if (copyBtn) {
    const msgItem = copyBtn.closest('.message-item');
    if (msgItem) {
      const text = msgItem.getAttribute('data-content') || '';
      copyToClipboard(text);
    }
  }

  // 打开按钮（本机：新标签页内联打开，图片/PDF/文本等浏览器直接渲染）
  const openBtn = e.target.closest('[data-action="open"]');
  if (openBtn) {
    const fid = openBtn.getAttribute('data-file-id');
    window.open('/api/download/' + fid + '?inline=1', '_blank');
  }

  // 下载按钮（非本机设备）
  const downloadBtn = e.target.closest('[data-action="download"]');
  if (downloadBtn) {
    const fid = downloadBtn.getAttribute('data-file-id');
    const fname = downloadBtn.getAttribute('data-file-name') || 'file';
    downloadFile(fid, fname);
  }
});

// ========== 文本发送 ==========
function sendText() {
  const content = textInput.value.trim();
  if (!content) return;

  console.log('📤 发送文本:', content.slice(0, 30));
  socket.emit('send-text', { content: content });
  textInput.value = '';
  textInput.focus();
}

btnSend.addEventListener('click', sendText);

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendText();
  }
});

// ========== 文件上传 ==========
btnUpload.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    uploadFile(fileInput.files[0]);
    fileInput.value = '';
  }
});

// 拖拽上传
uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  uploadArea.style.borderColor = 'var(--accent)';
});

uploadArea.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  uploadArea.style.borderColor = '';
});

uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  uploadArea.style.borderColor = '';
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    uploadFile(files[0]);
  }
});

// 全局拖拽
document.addEventListener('dragover', (e) => {
  e.preventDefault();
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.target.closest('.upload-area') || e.target.closest('.text-input') || e.target.closest('.message-list') || e.target.closest('.file-list')) {
    return;
  }
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    uploadFile(files[0]);
    tabFile.click();
  }
});

function uploadFile(file) {
  if (file.size > 100 * 1024 * 1024) {
    showToast('文件超过 100MB 限制', 'error');
    return;
  }

  var formData = new FormData();
  formData.append('file', file);
  formData.append('from', myDeviceName);

  var xhr = new XMLHttpRequest();

  uploadProgress.style.display = 'flex';
  progressFill.style.width = '0%';
  progressText.textContent = '0%';

  xhr.upload.addEventListener('progress', function (e) {
    if (e.lengthComputable) {
      var pct = Math.round((e.loaded / e.total) * 100);
      progressFill.style.width = pct + '%';
      progressText.textContent = pct + '%';
    }
  });

  xhr.addEventListener('load', function () {
    uploadProgress.style.display = 'none';
    if (xhr.status === 200) {
      showToast('✅ ' + file.name + ' 上传成功', 'success');
    } else {
      try {
        var err = JSON.parse(xhr.responseText);
        showToast(err.error || '上传失败', 'error');
      } catch (ex) {
        showToast('上传失败', 'error');
      }
    }
  });

  xhr.addEventListener('error', function () {
    uploadProgress.style.display = 'none';
    showToast('网络错误，上传失败', 'error');
  });

  xhr.open('POST', '/api/upload');
  xhr.send(formData);
}

// ========== 文件下载 ==========
function downloadFile(fileId, fileName) {
  var a = document.createElement('a');
  a.href = '/api/download/' + fileId;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('⬇️ 正在下载 ' + fileName, 'success');
}

// ========== 清理（仅本机）==========
function toggleCleanupMenu(open) {
  if (!cleanupMenu) return;
  const shouldOpen = typeof open === 'boolean' ? open : !cleanupMenu.classList.contains('show');
  cleanupMenu.classList.toggle('show', shouldOpen);
  if (btnCleanup) btnCleanup.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
}

if (btnCleanup) {
  btnCleanup.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCleanupMenu();
  });
}

// 点击页面其他位置收起菜单
document.addEventListener('click', (e) => {
  if (!cleanupWrap || !cleanupMenu) return;
  if (!cleanupWrap.contains(e.target)) {
    toggleCleanupMenu(false);
  }
});

// 菜单项：清理文本 / 文件 / 全部
if (cleanupMenu) {
  cleanupMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.cleanup-item');
    if (!item) return;
    const type = item.getAttribute('data-clean');
    toggleCleanupMenu(false);
    openCleanModal(type);
  });
}

// ========== 清理确认弹窗 ==========
const CLEAN_CONFIRM_WORD = '确认';

// 统计当前消息数与文件（数量 / 总大小）
function getMessageCount() {
  return messageList ? messageList.querySelectorAll('.message-item').length : 0;
}
function getFileStats() {
  let count = 0;
  let total = 0;
  filesState.forEach((size) => {
    count += 1;
    total += size || 0;
  });
  return { count, total };
}

// 根据清理类型生成描述文案（含数量 / 总大小）
function buildCleanDesc(type) {
  const msgCount = getMessageCount();
  const stats = getFileStats();
  if (type === 'text') {
    return msgCount > 0
      ? '将清空 ' + msgCount + ' 条文本消息。'
      : '当前没有文本消息。';
  }
  if (type === 'file') {
    return stats.count > 0
      ? '将删除 ' + stats.count + ' 个文件（共 ' + formatSize(stats.total) + '）。'
      : '当前没有文件。';
  }
  // all
  return '将清空 ' + msgCount + ' 条文本消息，并删除 ' + stats.count +
    ' 个文件（共 ' + formatSize(stats.total) + '）。\n此操作不可撤销。';
}

let cleanModalType = '';

function openCleanModal(type) {
  if (!cleanModalOverlay) {
    // 兜底：没有弹窗 DOM 时退回原生确认
    if (window.confirm(buildCleanDesc(type))) socket.emit('clean', { type: type });
    return;
  }

  cleanModalType = type;
  const icons = { text: '💬', file: '📎', all: '🗑️' };
  const titles = { text: '清理文本', file: '清理文件', all: '全部清理' };
  if (cleanModalIcon) cleanModalIcon.textContent = icons[type] || '🧹';
  if (cleanModalTitle) cleanModalTitle.textContent = titles[type] || '清理';
  if (cleanModalDesc) cleanModalDesc.textContent = buildCleanDesc(type);

  // 仅「全部清理」需要输入“确认”二字防误触
  const needInput = type === 'all';
  if (cleanModalInputWrap) cleanModalInputWrap.hidden = !needInput;
  if (cleanModalInput) cleanModalInput.value = '';
  if (cleanModalConfirm) cleanModalConfirm.disabled = needInput;

  cleanModalOverlay.hidden = false;
  if (needInput && cleanModalInput) {
    setTimeout(() => cleanModalInput.focus(), 0);
  }
}

function closeCleanModal() {
  if (!cleanModalOverlay) return;
  cleanModalOverlay.hidden = true;
  cleanModalType = '';
}

if (cleanModalCancel) {
  cleanModalCancel.addEventListener('click', closeCleanModal);
}

// 点击遮罩关闭
if (cleanModalOverlay) {
  cleanModalOverlay.addEventListener('click', (e) => {
    if (e.target === cleanModalOverlay) closeCleanModal();
  });
}

// Esc 关闭
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && cleanModalOverlay && !cleanModalOverlay.hidden) closeCleanModal();
});

// 输入“确认”后才允许提交（仅对「全部清理」生效）
if (cleanModalInput) {
  cleanModalInput.addEventListener('input', () => {
    if (!cleanModalConfirm) return;
    const ok = cleanModalInput.value.trim() === CLEAN_CONFIRM_WORD;
    cleanModalConfirm.disabled = !ok;
  });
  // 回车提交
  cleanModalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && cleanModalConfirm && !cleanModalConfirm.disabled) {
      cleanModalConfirm.click();
    }
  });
}

// 确认清理
if (cleanModalConfirm) {
  cleanModalConfirm.addEventListener('click', () => {
    if (cleanModalConfirm.disabled) return;
    socket.emit('clean', { type: cleanModalType });
    closeCleanModal();
  });
}

// ========== 标签切换 ==========
tabText.addEventListener('click', function () {
  tabText.classList.add('active');
  tabFile.classList.remove('active');
  textPanel.classList.add('active');
  filePanel.classList.remove('active');
});

tabFile.addEventListener('click', function () {
  tabFile.classList.add('active');
  tabText.classList.remove('active');
  filePanel.classList.add('active');
  textPanel.classList.remove('active');
});

// ========== 二维码加载 ==========
function loadQRCode() {
  fetch('/api/qrcode')
    .then(function (resp) { return resp.json(); })
    .then(function (data) {
      if (qrImage) qrImage.src = data.qrDataUrl;
      if (lanUrl) {
        lanUrl.textContent = data.url;
        lanUrl.title = '点击复制链接';
        lanUrl.addEventListener('click', function () {
          copyToClipboard(data.url);
        });
      }
    })
    .catch(function (err) {
      console.error('二维码加载失败:', err);
    });
}

// 桌面端加载二维码
if (window.innerWidth > 768) {
  loadQRCode();
}

// ========== 启动日志 ==========
console.log('🚀 LAN ShareBox 前端已就绪');
console.log('📱 设备类型:', myDevice.type);
console.log('🔌 正在连接 Socket.IO...');

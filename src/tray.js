'use strict';

/**
 * Windows 托盘驻留。
 *
 * 不使用 systray / node-tray 这类原生模块（pkg 打包后要带 .node 二进制，
 * 交叉构建和分发都会变麻烦），改为调用系统自带的 PowerShell + WinForms，
 * 纯脚本方案在 pkg 下零成本。非 Windows 或没有桌面会话时静默降级。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const EXIT_SIGNAL = 'SHAREBOX_TRAY_EXIT';
const TRAY_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'tray.ps1');
const DEFAULT_ICON = path.resolve(__dirname, '..', 'assets', 'app.ico');

/**
 * 启动托盘。
 * @param {{ url?: string, iconPath?: string, onQuit?: () => void }} options
 * @returns {Promise<{ dispose: () => void } | null>} 不支持时 resolve(null)
 */
function startTray(options = {}) {
  const { url = '', iconPath = DEFAULT_ICON, onQuit } = options;

  if (process.platform !== 'win32') {
    return Promise.resolve(null);
  }

  let tmpDir = '';
  let child = null;
  let settled = false;

  const cleanup = () => {
    if (child && !child.killed) {
      try {
        child.kill();
      } catch (e) {
        // 进程已退出时忽略
      }
    }
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (e) {
        // 临时目录清理失败不影响主程序
      }
    }
  };

  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharebox-tray-'));

    // 打包后脚本位于 pkg 虚拟文件系统，PowerShell 读不到，先落到真实磁盘
    // 写入 UTF-8 BOM，避免 Windows PowerShell 5.1 按 ANSI 解析中文乱码
    const scriptPath = path.join(tmpDir, 'tray.ps1');
    fs.writeFileSync(scriptPath, `\uFEFF${fs.readFileSync(TRAY_SCRIPT, 'utf8')}`, 'utf8');

    const args = ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];
    if (url) {
      args.push('-Url', url);
    }
    // 传给托盘做看门狗：主进程消失时托盘自行退出，避免残留孤儿图标
    args.push('-ParentPid', String(process.pid));

    let realIcon = '';
    if (iconPath && fs.existsSync(iconPath)) {
      realIcon = path.join(tmpDir, 'tray.ico');
      fs.writeFileSync(realIcon, fs.readFileSync(iconPath));
      args.push('-IconPath', realIcon);
    }

    child = spawn('powershell.exe', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      // 信号可能被拆成多块，累积后再判断
      stdoutBuf += chunk;
      if (stdoutBuf.length > 4096) {
        stdoutBuf = stdoutBuf.slice(-1024);
      }
      if (stdoutBuf.includes(EXIT_SIGNAL) && !settled) {
        settled = true;
        if (typeof onQuit === 'function') onQuit();
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk;
      if (stderrBuf.length > 1024) {
        stderrBuf = stderrBuf.slice(-512);
      }
    });

    child.on('error', () => {
      // PowerShell 不可用（Server Core / 无桌面会话）：降级为无托盘运行
    });

    child.on('close', () => {
      if (!settled) {
        settled = true;
        if (typeof onQuit === 'function') onQuit();
      }
    });

    return Promise.resolve({ dispose: cleanup });
  } catch (e) {
    cleanup();
    return Promise.resolve(null);
  }
}

module.exports = { startTray };

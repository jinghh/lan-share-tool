'use strict';

/**
 * 开机自启。
 *   - Windows 写入 HKCU Run 注册表项（不需要管理员权限）
 *   - macOS   写入 ~/Library/LaunchAgents
 *   - Linux   写入 ~/.config/autostart/*.desktop
 *
 * 自启一律以「后台驻留」方式启动（--tray --no-open），避免每次开机弹出浏览器。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'LAN ShareBox';
const MAC_LABEL = 'com.lan.sharebox';
const LINUX_FILE = 'sharebox.desktop';

const { isPackaged } = require('./data-dir');

/** 自启时实际执行的命令（文件 + 参数），避免手工拼字符串出错 */
function launchSpec() {
  if (isPackaged()) {
    const exe = process.execPath;
    // 安装目录下带静默启动脚本时优先用它，避免开机弹出控制台黑窗
    const hiddenLauncher = path.join(path.dirname(exe), 'start-hidden.vbs');
    if (process.platform === 'win32' && fs.existsSync(hiddenLauncher)) {
      return { file: 'wscript.exe', args: [hiddenLauncher] };
    }
    return { file: exe, args: ['--tray', '--no-open'] };
  }

  const entry = path.resolve(__dirname, '..', 'server.js');
  return { file: process.execPath, args: [entry, '--tray', '--no-open'] };
}

function quoteIfNeeded(value) {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/** 可执行文件路径始终加引号；参数仅在含空格 / 引号时才加 */
function toCommandLine(spec) {
  return [`"${spec.file}"`].concat(spec.args.map(quoteIfNeeded)).join(' ');
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------- Windows ----------------

function installWindows(spec) {
  execFileSync('reg', [
    'add', RUN_KEY,
    '/v', RUN_VALUE,
    '/t', 'REG_SZ',
    '/d', toCommandLine(spec),
    '/f',
  ], { stdio: 'pipe' });
}

function removeWindows() {
  execFileSync('reg', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f'], { stdio: 'pipe' });
}

// ---------------- macOS ----------------

function macPlistPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${MAC_LABEL}.plist`);
}

function installMac(spec) {
  const dir = path.dirname(macPlistPath());
  fs.mkdirSync(dir, { recursive: true });

  const argv = [spec.file].concat(spec.args);
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${MAC_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...argv.map((arg) => `    <string>${escapeXml(arg)}</string>`),
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>StandardOutPath</key>',
    `  <string>${escapeXml(path.join(os.homedir(), 'Library', 'Logs', `${MAC_LABEL}.log`))}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${escapeXml(path.join(os.homedir(), 'Library', 'Logs', `${MAC_LABEL}.log`))}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');

  fs.writeFileSync(macPlistPath(), plist, 'utf8');

  try {
    execFileSync('launchctl', ['load', '-w', macPlistPath()], { stdio: 'pipe' });
  } catch (e) {
    // 已加载时 launchctl 会报错，配置文件已写入，忽略即可
  }
}

function removeMac() {
  const plist = macPlistPath();
  try {
    execFileSync('launchctl', ['unload', '-w', plist], { stdio: 'pipe' });
  } catch (e) {
    // 未加载时忽略
  }
  try {
    fs.unlinkSync(plist);
  } catch (e) {
    // 文件不存在时忽略
  }
}

// ---------------- Linux ----------------

function linuxDesktopPath() {
  return path.join(os.homedir(), '.config', 'autostart', LINUX_FILE);
}

function installLinux(spec) {
  const file = linuxDesktopPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const content = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=LAN ShareBox',
    'Comment=LAN file and text sharing',
    `Exec=${toCommandLine(spec)}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
  fs.writeFileSync(file, content, 'utf8');
}

function removeLinux() {
  try {
    fs.unlinkSync(linuxDesktopPath());
  } catch (e) {
    // 文件不存在时忽略
  }
}

// ---------------- 对外 API ----------------

function install() {
  const spec = launchSpec();
  if (process.platform === 'win32') {
    installWindows(spec);
  } else if (process.platform === 'darwin') {
    installMac(spec);
  } else {
    installLinux(spec);
  }
  return spec;
}

function remove() {
  if (process.platform === 'win32') {
    removeWindows();
  } else if (process.platform === 'darwin') {
    removeMac();
  } else {
    removeLinux();
  }
}

module.exports = { install, remove, launchSpec };

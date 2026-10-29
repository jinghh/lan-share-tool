'use strict';

/**
 * 把 pkg 产出的裸二进制包装成 macOS .app 包。
 *
 * 用法: node scripts/make-mac-app.js <binary> <App路径> [icns路径]
 * 例:   node scripts/make-mac-app.js dist/ShareBox-macos-arm64 dist/LAN-ShareBox-arm64.app assets/app.icns
 */

const fs = require('fs');
const path = require('path');

const [binaryArg, appArg, icnsArg] = process.argv.slice(2);

if (!binaryArg || !appArg) {
  console.error('用法: node scripts/make-mac-app.js <binary> <App路径> [icns路径]');
  process.exit(1);
}

const binary = path.resolve(binaryArg);
const appPath = path.resolve(appArg);
const icns = icnsArg ? path.resolve(icnsArg) : path.resolve(__dirname, '..', 'assets', 'app.icns');
const bundleName = path.basename(appPath, '.app');

if (!fs.existsSync(binary)) {
  console.error(`找不到二进制文件: ${binary}`);
  process.exit(1);
}

const contentsDir = path.join(appPath, 'Contents');
const macOsDir = path.join(contentsDir, 'MacOS');
const resourcesDir = path.join(contentsDir, 'Resources');
const executableName = 'ShareBox';

fs.rmSync(appPath, { recursive: true, force: true });
fs.mkdirSync(macOsDir, { recursive: true });
fs.mkdirSync(resourcesDir, { recursive: true });

fs.copyFileSync(binary, path.join(macOsDir, executableName));
fs.chmodSync(path.join(macOsDir, executableName), 0o755);

if (fs.existsSync(icns)) {
  fs.copyFileSync(icns, path.join(resourcesDir, 'app.icns'));
}

const infoPlist = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
  '<dict>',
  '  <key>CFBundleName</key>',
  `  <string>${bundleName}</string>`,
  '  <key>CFBundleDisplayName</key>',
  '  <string>LAN ShareBox</string>',
  '  <key>CFBundleIdentifier</key>',
  '  <string>com.lan.sharebox</string>',
  '  <key>CFBundleExecutable</key>',
  `  <string>${executableName}</string>`,
  '  <key>CFBundleIconFile</key>',
  '  <string>app</string>',
  '  <key>CFBundlePackageType</key>',
  '  <string>APPL</string>',
  '  <key>CFBundleVersion</key>',
  '  <string>1.1.0</string>',
  '  <key>CFBundleShortVersionString</key>',
  '  <string>1.1.0</string>',
  '  <key>LSMinimumSystemVersion</key>',
  '  <string>10.15</string>',
  '  <key>NSHighResolutionCapable</key>',
  '  <true/>',
  '</dict>',
  '</plist>',
  '',
].join('\n');

fs.writeFileSync(path.join(contentsDir, 'Info.plist'), infoPlist, 'utf8');

console.log(`🍎 已生成 ${appPath}`);

'use strict';

/**
 * 数据目录解析。
 *
 * 打包成 exe / .app 之后，程序通常安装在 Program Files / Applications 这类
 * 只读目录，不能再把上传文件写到可执行文件旁边，因此统一迁移到用户数据目录：
 *   - Windows  %APPDATA%\ShareBox
 *   - macOS    ~/Library/Application Support/ShareBox
 *   - Linux    $XDG_DATA_HOME/ShareBox  (~/.local/share/ShareBox)
 *
 * 优先级：--data-dir / SHAREBOX_DATA_DIR  >  便携模式(可执行文件同级 data/)  >  系统用户数据目录
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_NAME = 'ShareBox';
const LEGACY_DIR_NAME = 'uploads';

function isPackaged() {
  return Boolean(process.pkg);
}

function exeDir() {
  try {
    return path.dirname(process.execPath);
  } catch (e) {
    return process.cwd();
  }
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch (e) {
    return false;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function defaultUserDataDir() {
  const home = os.homedir();

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, APP_NAME);
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', APP_NAME);
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), APP_NAME);
}

function resolveDataDir(explicitDir) {
  const fromInput = explicitDir || process.env.SHAREBOX_DATA_DIR;
  if (fromInput) {
    return path.resolve(fromInput);
  }

  // 便携模式：可执行文件旁边存在 data 目录时，数据跟着程序走（方便放 U 盘）
  if (isPackaged()) {
    const portableDir = path.join(exeDir(), 'data');
    if (isDirectory(portableDir)) {
      return portableDir;
    }
  }

  return defaultUserDataDir();
}

/** 旧数据目录的指纹文件，避免误搬其它项目的 uploads 目录 */
function looksLikeLegacyDir(dir) {
  return ['.metadata.json', '.messages.json'].some((name) =>
    fs.existsSync(path.join(dir, name)),
  );
}

/**
 * 旧版本把上传文件放在运行目录的 uploads/ 下，升级后一次性搬到新数据目录。
 * 仅在数据目录首次创建、且源目录确实是 ShareBox 旧数据时执行，避免误伤。
 */
function migrateLegacyUploads(dataDir) {
  const target = path.join(dataDir, LEGACY_DIR_NAME);
  const sources = isPackaged()
    ? [path.join(exeDir(), LEGACY_DIR_NAME), path.join(process.cwd(), LEGACY_DIR_NAME)]
    : [path.join(process.cwd(), LEGACY_DIR_NAME)];

  for (const source of sources) {
    if (!isDirectory(source)) continue;
    if (path.resolve(source) === path.resolve(target)) continue;
    if (!looksLikeLegacyDir(source)) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(source);
    } catch (e) {
      continue;
    }
    if (entries.length === 0) continue;

    ensureDir(target);
    let moved = 0;
    for (const name of entries) {
      // .gitkeep 是仓库占位文件，留在原目录，避免旧目录在 git 中消失
      if (name === '.gitkeep') continue;

      const from = path.join(source, name);
      const to = path.join(target, name);
      if (fs.existsSync(to)) continue;
      try {
        fs.renameSync(from, to);
        moved += 1;
      } catch (e) {
        // 跨盘符 / 权限问题：退化为复制后删除
        try {
          fs.copyFileSync(from, to);
          fs.unlinkSync(from);
          moved += 1;
        } catch (e2) {
          // 单个文件失败不影响其余文件
        }
      }
    }

    if (moved > 0) {
      return { from: source, to: target, moved };
    }
  }

  return null;
}

/**
 * 准备数据目录：解析路径 → 创建 → 首次创建时迁移旧数据。
 */
function prepareDataDir(explicitDir) {
  const dataDir = resolveDataDir(explicitDir);
  const existed = isDirectory(dataDir);

  ensureDir(dataDir);
  const uploadsDir = ensureDir(path.join(dataDir, LEGACY_DIR_NAME));

  return {
    dataDir,
    uploadsDir,
    migration: existed ? null : migrateLegacyUploads(dataDir),
  };
}

module.exports = {
  APP_NAME,
  ensureDir,
  exeDir,
  isPackaged,
  migrateLegacyUploads,
  prepareDataDir,
  resolveDataDir,
};

// engine/lib/transaction.js — 持久化崩溃恢复级事务管理器（零外部依赖）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let activeTxId = null;

function getTransactionsBaseDir() {
  return path.join(process.cwd(), '.asa/transactions');
}

function getTxDir(txId) {
  return path.join(getTransactionsBaseDir(), txId);
}

function getPathHash(filePath) {
  const norm = path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
  return crypto.createHash('sha256').update(norm).digest('hex').substring(0, 12);
}

function getActiveTxId() {
  return activeTxId;
}

function setActiveTxId(txId) {
  activeTxId = txId;
}

/**
 * 原子且安全地覆写 manifest.json
 */
function writeManifestAtomic(txDir, manifest) {
  const manifestPath = path.join(txDir, 'manifest.json');
  const tmpPath = manifestPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8');
  fs.renameSync(tmpPath, manifestPath);
}

/**
 * 开始一个新的持久化事务
 */
function beginTransaction(txId) {
  if (!txId) {
    txId = `tx-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }
  
  const txDir = getTxDir(txId);
  fs.mkdirSync(txDir, { recursive: true });

  const manifest = {
    txId,
    status: 'prepared',
    startedAt: new Date().toISOString(),
    backups: [],
    createdFiles: []
  };

  writeManifestAtomic(txDir, manifest);
  activeTxId = txId;
  return txId;
}

/**
 * 登记需要修改/创建的文件。如果是修改，则物理备份；如果是新创建，则登记到 createdFiles 以便回滚时物理删除。
 */
function registerFile(txId, filePath) {
  if (!txId) return;
  const txDir = getTxDir(txId);
  const manifestPath = path.join(txDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const resolvedPath = path.resolve(filePath);
  const relPath = path.relative(process.cwd(), resolvedPath).replace(/\\/g, '/');

  // 强防线：校验路径穿越，绝不记录或改写项目根以外的文件
  const isInside = !relPath.startsWith('..') && !path.isAbsolute(relPath);
  if (!isInside) {
    throw new Error(`登记文件路径超越项目根目录边界，拦截: "${filePath}"`);
  }

  // 防止重复登记
  if (manifest.backups.some(b => b.original === relPath) || manifest.createdFiles.includes(relPath)) {
    return;
  }

  if (fs.existsSync(resolvedPath)) {
    // 文件已存在，执行物理备份
    const hash = getPathHash(resolvedPath);
    const backupName = `${path.basename(resolvedPath)}.${hash}.bak`;
    const backupPath = path.join(txDir, backupName);
    
    fs.copyFileSync(resolvedPath, backupPath);
    manifest.backups.push({
      original: relPath,
      backup: path.relative(process.cwd(), backupPath).replace(/\\/g, '/')
    });
  } else {
    // 文件在修改前不存在，登记为新增文件，回滚时物理删除
    manifest.createdFiles.push(relPath);
  }

  writeManifestAtomic(txDir, manifest);
}

/**
 * 阶段控制：标定为提交中 (committing)
 */
function markCommitting(txId) {
  if (!txId) return;
  const txDir = getTxDir(txId);
  const manifestPath = path.join(txDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  manifest.status = 'committing';
  writeManifestAtomic(txDir, manifest);
}

/**
 * 提交事务：标记为 completed 并物理清理临时备份与清单目录
 */
function commitTransaction(txId) {
  if (!txId) return;
  const txDir = getTxDir(txId);
  const manifestPath = path.join(txDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  manifest.status = 'completed';
  writeManifestAtomic(txDir, manifest);

  // 清理备份目录
  try {
    fs.rmSync(txDir, { recursive: true, force: true });
  } catch (e) {
    // 忽略清理失败
  }
  if (activeTxId === txId) activeTxId = null;
}

/**
 * 回滚单个事务：还原 backups，删除 createdFiles，清理目录
 */
function rollbackTransaction(txId) {
  const txDir = getTxDir(txId);
  const manifestPath = path.join(txDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return;

  let manifest;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8').trim();
    if (!raw) {
      throw new Error('Manifest file is empty');
    }
    manifest = JSON.parse(raw);
  } catch (parseErr) {
    // 损坏的事务清单强制 Fail-Closed 阻断并物理保留现场！
    throw new Error(`[ASA] ❌ 事务清单 manifest.json 损坏或为空！为了安全起见，禁止删除。请手工从 "${txDir}" 提取备份恢复。`);
  }

  try {
    // 1. 还原备份文件
    if (Array.isArray(manifest.backups)) {
      for (const b of manifest.backups) {
        const orig = path.resolve(b.original);
        const rel = path.relative(process.cwd(), orig);
        const isInside = !rel.startsWith('..') && !path.isAbsolute(rel);
        if (!isInside) {
          throw new Error(`回滚路径超越项目根目录边界，拦截还原: "${b.original}"`);
        }

        const bak = path.resolve(b.backup);
        if (fs.existsSync(bak)) {
          fs.mkdirSync(path.dirname(orig), { recursive: true });
          fs.copyFileSync(bak, orig);
        }
      }
    }

    // 2. 删除新增文件
    if (Array.isArray(manifest.createdFiles)) {
      for (const f of manifest.createdFiles) {
        const p = path.resolve(f);
        const rel = path.relative(process.cwd(), p);
        const isInside = !rel.startsWith('..') && !path.isAbsolute(rel);
        if (!isInside) {
          throw new Error(`删除文件路径超越项目根目录边界，拦截删除: "${f}"`);
        }
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
        }
      }
    }
  } catch (err) {
    console.error(`[ASA Transaction Rollback Error] txId: ${txId} — ${err.message}`);
    // 还原异常时，强制不清理事务目录，向上抛错阻断
    throw err;
  }

  // 3. 还原成功后，物理清理事务目录
  try {
    fs.rmSync(txDir, { recursive: true, force: true });
  } catch (e) {}

  if (activeTxId === txId) activeTxId = null;
}

/**
 * 诊断自愈：扫描并回滚所有未完成（非 completed）的事务，清洗垃圾
 */
function rollbackAllIncomplete() {
  const baseDir = getTransactionsBaseDir();
  if (!fs.existsSync(baseDir)) return 0;

  const currentTxId = getActiveTxId();

  let recoveredCount = 0;
  const items = fs.readdirSync(baseDir);
  for (const item of items) {
    if (item === currentTxId) continue; // 跳过当前正在活跃运行的事务
    const txDir = path.join(baseDir, item);
    if (!fs.statSync(txDir).isDirectory()) continue;

    const manifestPath = path.join(txDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const raw = fs.readFileSync(manifestPath, 'utf-8').trim();
        if (!raw) {
          throw new Error('Empty manifest');
        }
        const manifest = JSON.parse(raw);
        if (manifest.status !== 'completed') {
          rollbackTransaction(item);
          recoveredCount++;
        }
      } catch (e) {
        // 损坏的事务清单强制 Fail-Closed 阻断并物理保留现场！
        throw new Error(`[ASA] ❌ 扫描到受损的脏事务 ${item} (清单损坏)！为了防止备份数据丢失，禁止自动删除。请联系架构师或手动修复/清理 "${txDir}"。`);
      }
    } else {
      // 孤儿目录，直接清理
      try { fs.rmSync(txDir, { recursive: true, force: true }); } catch (err) {}
      recoveredCount++;
    }
  }

  // 清除残留的临时事务文件，安全收缩，绝不扫描全项目根目录
  try {
    cleanTmpFiles(baseDir);
  } catch (e) {}

  return recoveredCount;
}

function cleanTmpFiles(dir) {
  if (!fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const p = path.join(dir, item);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      cleanTmpFiles(p);
    } else if (item.endsWith('.tmp')) {
      try { fs.unlinkSync(p); } catch (e) {}
    } else if (item.endsWith('.bak')) {
      // 异常路径备份自愈：如果是普通事务备份，直接物理删除
      // 如果是 hook-*.bak，只有当其在磁盘上生存且无人领养陈旧超过 60 秒时，才作为崩溃残留孤儿垃圾予以物理清除 (M2 / B3 修复)
      if (!item.startsWith('hook-')) {
        try { fs.unlinkSync(p); } catch (e) {}
      } else {
        const age = Date.now() - stat.mtimeMs;
        if (age > 60000) {
          try { fs.unlinkSync(p); } catch (e) {}
        }
      }
    }
  }
}

module.exports = {
  beginTransaction,
  registerFile,
  markCommitting,
  commitTransaction,
  rollbackTransaction,
  rollbackAllIncomplete,
  getActiveTxId,
  setActiveTxId
};

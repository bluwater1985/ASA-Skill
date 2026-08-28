// engine/lib/lock.js — ASA 写锁管理（零外部依赖）
const fs = require('fs');
const path = require('path');

let lockDepth = 0;

function getLockPath() {
  return path.join(process.cwd(), '.asa/lock');
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e.code === 'EPERM') {
      return true;
    }
    return false;
  }
}

function acquireLock() {
  if (lockDepth > 0) {
    lockDepth++;
    return;
  }

  const lockPath = getLockPath();
  const lockDir = path.dirname(lockPath);
  if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
  }

  let attempts = 0;
  while (attempts < 2) {
    attempts++;
    try {
      // 尝试以 'wx' 标志原子且排他地写入锁文件
      fs.writeFileSync(lockPath, JSON.stringify({
        pid: process.pid,
        timestamp: Date.now()
      }), { flag: 'wx', encoding: 'utf-8' });
      
      lockDepth = 1;
      return;
    } catch (e) {
      if (e.code === 'EEXIST') {
        // 锁文件已存在，读取其中内容进行分析
        let content;
        try {
          const raw = fs.readFileSync(lockPath, 'utf-8').trim();
          if (!raw) {
            throw new Error('Lock is empty');
          }
          content = JSON.parse(raw);
        } catch (readErr) {
          // 损坏锁/空锁强制保守阻断，严禁自动物理删除，指引人工清理
          throw new Error(`[ASA] ❌ 写锁文件已损坏或为空！为了保证数据安全，禁止自动删除该锁。请手动删除 ".asa/lock" 释放锁现场，并运行 diagnose / doctor 排查。`);
        }

        const { pid, timestamp } = content;
        
        // 强力结构类型防御：pid 必须为正整数、timestamp 必须为合法数值
        const numericPid = Number(pid);
        const numericTime = Number(timestamp);
        if (isNaN(numericPid) || isNaN(numericTime) || numericPid <= 0 || numericTime <= 0) {
          throw new Error(`[ASA] ❌ 写锁文件已损坏或已被篡改（非正常损坏/篡改写锁）！为了保证数据安全，紧急锁死。请手动清除 ".asa/lock" 释放锁现场。`);
        }
        
        // 检查进程存活
        if (isProcessAlive(numericPid)) {
          throw new Error(`[ASA] Lock is held by active process ${numericPid}.`);
        }

        // 进程已死，检查锁年龄
        const age = Date.now() - numericTime;
        if (age < 10000) {
          throw new Error(`[ASA] Lock is held by dead process ${numericPid} but has not expired (age: ${age}ms, lease timeout: 10s). Please wait.`);
        }

        // 进程已死且满 10s，强行接管：先删除，再进入下一轮重试写入
        try { fs.unlinkSync(lockPath); } catch (uErr) {}
        continue;
      }
      throw e; // 抛出其他意外文件操作错误
    }
  }
  
  throw new Error('[ASA] Failed to acquire lock.');
}

function releaseLock() {
  if (lockDepth > 1) {
    lockDepth--;
    return;
  }

  if (lockDepth === 1) {
    const lockPath = getLockPath();
    if (fs.existsSync(lockPath)) {
      try {
        const raw = fs.readFileSync(lockPath, 'utf-8');
        const content = JSON.parse(raw);
        if (content.pid === process.pid) {
          fs.unlinkSync(lockPath);
        }
      } catch (e) {
        // 损坏锁不自删：保留损坏锁现场交给 doctor 命令审计，仅清零 lockDepth 报告损坏 (P2-1 修复)
        console.warn(`[ASA] ⚠️ 锁文件 ${lockPath} 损坏，已跳过自删并保留现场供 doctor 命令排查。`);
      }
    }
    lockDepth = 0;
  }
}

module.exports = {
  acquireLock,
  releaseLock,
  getLockPath,
  isProcessAlive
};

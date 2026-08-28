// engine/lib/lock.test.js — TDD 写锁测试
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 在实现 lock.js 前，我们先写这个测试（RED 状态）
// 此时 require('./lock.js') 会失败，因为文件尚未创建或内容为空。
const { acquireLock, releaseLock, getLockPath, isProcessAlive } = require('./lock.js');

describe('Lock Manager', () => {
  let sandboxDir;
  let originalCwd;

  beforeEach(() => {
    originalCwd = process.cwd();
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asa-lock-test-'));
    process.chdir(sandboxDir);
    // 确保 .asa 目录存在
    fs.mkdirSync(path.join(sandboxDir, '.asa'), { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch (e) {
      // 忽略 Windows 上的清理失败
    }
  });

  it('acquires and releases lock successfully when free', () => {
    const lockPath = getLockPath();
    assert.equal(fs.existsSync(lockPath), false);

    // 第一次上锁应该成功
    acquireLock();
    assert.equal(fs.existsSync(lockPath), true);

    const content = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    assert.equal(content.pid, process.pid);
    assert.ok(typeof content.timestamp === 'number');

    // 释放锁
    releaseLock();
    assert.equal(fs.existsSync(lockPath), false);
  });

  it('supports reentrancy (nested lock acquisition)', () => {
    const lockPath = getLockPath();

    acquireLock(); // depth = 1
    acquireLock(); // depth = 2
    assert.equal(fs.existsSync(lockPath), true);

    releaseLock(); // depth = 1
    assert.equal(fs.existsSync(lockPath), true); // 锁依然存在

    releaseLock(); // depth = 0
    assert.equal(fs.existsSync(lockPath), false); // 锁被物理删除
  });

  it('blocks concurrent acquisition by another active process', () => {
    const lockPath = getLockPath();
    
    // 写入一个模拟的、属于另外一个活动进程的锁（假设 PID 为 999999 且存活）
    const originalKill = process.kill;
    try {
      process.kill = (pid, signal) => {
        if (pid === 999999) return true; // 模拟存活
        return originalKill(pid, signal);
      };

      fs.writeFileSync(lockPath, JSON.stringify({
        pid: 999999,
        timestamp: Date.now() - 5000 // 5s ago
      }), 'utf-8');

      // 尝试上锁应该抛出错误
      assert.throws(() => {
        acquireLock();
      }, /Lock is held by active process 999999/);

    } finally {
      process.kill = originalKill;
    }
  });

  it('allows taking over lock of a dead process after lease timeout (10s)', () => {
    const lockPath = getLockPath();
    const originalKill = process.kill;

    try {
      // 模拟进程已消亡
      process.kill = (pid, signal) => {
        if (pid === 888888) {
          const err = new Error('No such process');
          err.code = 'ESRCH';
          throw err;
        }
        return originalKill(pid, signal);
      };

      // 情况 A: PID 已死，但锁未满 10 秒 -> 抛出错误，禁止抢占
      fs.writeFileSync(lockPath, JSON.stringify({
        pid: 888888,
        timestamp: Date.now() - 5000 // 5s ago
      }), 'utf-8');

      assert.throws(() => {
        acquireLock();
      }, /Lock is held by dead process 888888 but has not expired/);

      // 情况 B: PID 已死，且锁超过 10 秒 -> 允许强行接管
      fs.writeFileSync(lockPath, JSON.stringify({
        pid: 888888,
        timestamp: Date.now() - 11000 // 11s ago
      }), 'utf-8');

      acquireLock(); // 应该接管成功
      assert.equal(fs.existsSync(lockPath), true);
      const content = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      assert.equal(content.pid, process.pid); // 锁已被更新为当前进程

      releaseLock();
    } finally {
      process.kill = originalKill;
    }
  });
});

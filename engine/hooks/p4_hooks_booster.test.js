// engine/hooks/p4_hooks_booster.test.js — Hook 隐藏高吞吐分支与并发排他锁硬核硬化测试
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const HOOKS_DIR = __dirname;

function getPathHash(filePath) {
  const norm = path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
  return crypto.createHash('sha256').update(norm).digest('hex').substring(0, 12);
}

function makeHookSandbox(phase, activeTask) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asa-hook-boost-'));
  fs.mkdirSync(path.join(d, '.asa/nodes/tasks'), { recursive: true });
  const meta = `meta:\n  phase: "${phase || 'discovery'}"${activeTask ? `\n  activeTask: ${activeTask}` : ''}\n  schemaVersion: 3\n  compiledDocsExpectedDigest: "sha256:empty"\n  compiledDocsActualDigest: "sha256:empty"\nrisks: []\nrequirements: {}\narchitecture: {}\ntasks: {}\nedges: []\n`;
  fs.writeFileSync(path.join(d, '.asa/matrix.yaml'), meta);
  return d;
}

function cleanupSandbox(d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
}

describe('Hooks Hardening - Extreme Branch & Concurrency', () => {
  // ── 1. 验证 lockFile 陈旧死锁自愈 (10s 抢占) ──
  it('detects stale .lock file (>10s) and self-heals by unlinking it', () => {
    const d = makeHookSandbox('implementation', 'TASK-001');
    const fileToValidate = path.join(d, '.asa/nodes/tasks/TASK-001.yaml');
    const hash = getPathHash(fileToValidate);

    const txDir = path.join(d, '.asa/transactions');
    fs.mkdirSync(txDir, { recursive: true });

    const lockPath = path.join(txDir, `invocation-${hash}.json.lock`);
    // 物理创建一个陈旧的锁文件，其修改时间 (mtimeMs) 设定为 20秒以前
    fs.writeFileSync(lockPath, 'stale_pid_9999');
    const pastTime = (Date.now() - 20000) / 1000;
    fs.utimesSync(lockPath, pastTime, pastTime);

    // 运行 validate-yaml.js (由于锁陈旧，它应该成功自愈删除它、出队并成功执行)
    const invocationFile = path.join(txDir, `invocation-${hash}.json`);
    fs.writeFileSync(invocationFile, JSON.stringify({ invocationIds: ['uuid_123'] }), 'utf-8');

    fs.writeFileSync(fileToValidate, 'id: TASK-001\ntitle: "任务1"\nstatus: pending\nlinkedReqs: []\nchangedFiles: []\n');

    // 模拟运行 validate-yaml.js (由于 OK，退出码应该是 0)
    const r = spawnSync(process.execPath, [path.join(HOOKS_DIR, 'validate-yaml.js'), fileToValidate], { cwd: d, encoding: 'utf8' });
    assert.equal(r.status, 0, 'Should self-heal the lock and allow validation success');
    assert.ok(!fs.existsSync(lockPath), 'Stale lock must be self-healed and deleted');

    cleanupSandbox(d);
  });

  // ── 2. 验证 lockFile 超时 Fail-Closed 拦截 ──
  it('fails closed when .lock is held actively by others and times out', () => {
    const d = makeHookSandbox('implementation', 'TASK-001');
    const fileToValidate = path.join(d, '.asa/nodes/tasks/TASK-001.yaml');
    const hash = getPathHash(fileToValidate);

    const txDir = path.join(d, '.asa/transactions');
    fs.mkdirSync(txDir, { recursive: true });

    // 物理创建一个活动的、未过期的锁（mtime 为当前时间）
    const lockPath = path.join(txDir, `invocation-${hash}.json.lock`);
    fs.writeFileSync(lockPath, 'active_pid_7777');

    const invocationFile = path.join(txDir, `invocation-${hash}.json`);
    fs.writeFileSync(invocationFile, JSON.stringify({ invocationIds: ['uuid_123'] }), 'utf-8');

    fs.writeFileSync(fileToValidate, 'id: TASK-001\ntitle: "任务1"\nstatus: pending\nlinkedReqs: []\nchangedFiles: []\n');

    // 运行 validate-yaml.js 并在 L30 处抛出超时异常，退出码应该为 2 (Claude 拦截退出码)
    const r = spawnSync(process.execPath, [path.join(HOOKS_DIR, 'validate-yaml.js'), fileToValidate], { cwd: d, encoding: 'utf8' });
    assert.equal(r.status, 2, 'Must fail-closed and return exit code 2 on lock timeout');
    assert.match(r.stderr, /锁获取超时/, 'Error message must record lock timeout');

    cleanupSandbox(d);
  });

  // ── 3. 验证 JSON 损坏 parseFailed 拒绝静默删除 ──
  it('keeps invocation file when JSON is corrupted and refuses to unlink it', () => {
    const d = makeHookSandbox('implementation', 'TASK-001');
    const fileToValidate = path.join(d, '.asa/nodes/tasks/TASK-001.yaml');
    const hash = getPathHash(fileToValidate);

    const txDir = path.join(d, '.asa/transactions');
    fs.mkdirSync(txDir, { recursive: true });

    // 物理写入一个彻底损坏、不可解析的 JSON 映射文件
    const invocationFile = path.join(txDir, `invocation-${hash}.json`);
    fs.writeFileSync(invocationFile, '{"broken_json: unmatched_brackets...', 'utf-8');

    fs.writeFileSync(fileToValidate, 'id: TASK-001\ntitle: "任务1"\nstatus: pending\nlinkedReqs: []\nchangedFiles: []\n');

    // 运行 validate-yaml.js (由于解析失败，程序拒绝静默删除原文件，保留现场)
    const r = spawnSync(process.execPath, [path.join(HOOKS_DIR, 'validate-yaml.js'), fileToValidate], { cwd: d, encoding: 'utf8' });
    assert.equal(r.status, 2); // 应该解析报错被拦截
    assert.ok(fs.existsSync(invocationFile), 'Corrupted invocation mapping must not be silently unlinked');
    assert.match(r.stderr, /检测到损坏的 invocation 映射文件/, 'Stderr must warn about corrupted mapping');

    cleanupSandbox(d);
  });

  // ── 4. 验证 validate-yaml 对写后非法状态的物理还原 ──
  it('rolls back and restores file content to backup on validate-yaml failure', () => {
    const d = makeHookSandbox('implementation', 'TASK-001');
    const fileToValidate = path.join(d, '.asa/nodes/tasks/TASK-001.yaml');
    const hash = getPathHash(fileToValidate);

    const txDir = path.join(d, '.asa/transactions');
    fs.mkdirSync(txDir, { recursive: true });

    // 1. 物理模拟一个预先存在的合法备份 (比如 status 为 pending)
    const backupPath = path.join(txDir, `hook-${hash}-uuid_back.bak`);
    fs.writeFileSync(backupPath, 'id: TASK-001\ntitle: "备份的原生内容"\nstatus: pending\nlinkedReqs: []\nchangedFiles: []\n');

    const invocationFile = path.join(txDir, `invocation-${hash}.json`);
    fs.writeFileSync(invocationFile, JSON.stringify({ invocationIds: ['uuid_back'] }), 'utf-8');

    // 2. 写入一个被篡改过的、非法状态 of TASK 文件 ( status 被写成了非法的 proposed)
    fs.writeFileSync(fileToValidate, 'id: TASK-001\ntitle: "非法修改"\nstatus: proposed\nlinkedReqs: []\nchangedFiles: []\n');

    // 3. 运行 validate-yaml.js，应当判定状态非法，并强制把 fileToValidate 还原到备份中的 pending 内容
    const r = spawnSync(process.execPath, [path.join(HOOKS_DIR, 'validate-yaml.js'), fileToValidate], { cwd: d, encoding: 'utf8' });
    assert.equal(r.status, 2); // 回滚阻断，返回 2
    assert.match(r.stderr, /非法的 status 状态值/);

    // 验证物理还原
    const restoredText = fs.readFileSync(fileToValidate, 'utf-8');
    assert.match(restoredText, /备份的原生内容/, 'File content must be fully rolled back and restored');
    assert.match(restoredText, /status: pending/, 'Status must be rolled back to pending');

    cleanupSandbox(d);
  });

  // ── 5. 验证 check-work-order 在 implementation 阶段无 active-task 拦截 ──
  it('blocks file edits in implementation phase when no active-task is set', () => {
    const d = makeHookSandbox('implementation'); // 无 active-task
    const fileToEdit = path.join(d, 'src/app.js');

    const r = spawnSync(process.execPath, [path.join(HOOKS_DIR, 'check-work-order.js'), fileToEdit], { cwd: d, encoding: 'utf8' });
    assert.equal(r.status, 2, 'BeforeHook must block write in implementation phase without active-task');
    assert.match(r.stderr, /当前没有活跃 Task/);

    cleanupSandbox(d);
  });

  // ── 6. 验证 check-work-order 在 implementation 阶段任务处于完成/取消等状态时的拦截 ──
  it('blocks file edits in implementation phase when active-task is cancelled or completed', () => {
    // 任务状态为 cancelled
    const d = makeHookSandbox('implementation', 'TASK-999');
    fs.mkdirSync(path.join(d, '.asa/nodes/tasks'), { recursive: true });
    fs.writeFileSync(path.join(d, '.asa/nodes/tasks/TASK-999.yaml'), 'id: TASK-999\ntitle: "取消任务"\nstatus: cancelled\n');

    const fileToEdit = path.join(d, 'src/app.js');

    const r = spawnSync(process.execPath, [path.join(HOOKS_DIR, 'check-work-order.js'), fileToEdit], { cwd: d, encoding: 'utf8' });
    assert.equal(r.status, 2, 'BeforeHook must block write when active task is cancelled');
    assert.match(r.stderr, /状态为已失效/);

    cleanupSandbox(d);
  });

  // ── 6.1 验证 check-work-order 在 awaiting-confirmation 等待用户确认状态时的 Before 前置阻断 ──
  it('blocks file edits in implementation phase when active-task is awaiting-confirmation', () => {
    const d = makeHookSandbox('implementation', 'TASK-998');
    fs.mkdirSync(path.join(d, '.asa/nodes/tasks'), { recursive: true });
    fs.writeFileSync(path.join(d, '.asa/nodes/tasks/TASK-998.yaml'), 'id: TASK-998\ntitle: "提审任务"\nstatus: awaiting-confirmation\n');

    const fileToEdit = path.join(d, 'src/app.js');

    const r = spawnSync(process.execPath, [path.join(HOOKS_DIR, 'check-work-order.js'), fileToEdit], { cwd: d, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /等待用户确认中/);

    cleanupSandbox(d);
  });

  // ── 6.2 验证 check-work-order 对 Stdin 坏 JSON 格式解析的 Fail-Closed 拦截 ──
  it('fails closed on check-work-order Stdin JSON parsing exceptions', () => {
    const d = makeHookSandbox('implementation', 'TASK-001');
    const r = spawnSync(process.execPath, [path.join(HOOKS_DIR, 'check-work-order.js')], {
      cwd: d,
      input: '{"invalid_json: true',
      encoding: 'utf8'
    });
    // Stdin 模式下根据 Gemini 协议：统一退 0 + 在 stdout 输出 decision: deny (物理自愈对账设计)
    assert.equal(r.status, 0);
    assert.match(r.stdout, /"decision":"deny"/);
    assert.match(r.stdout, /JSON 解析异常/);

    cleanupSandbox(d);
  });

  // ── 7. 验证 check-work-order 在 Before 阶段损坏 JSON mapping 的 C-P2 现场保护 ──
  it('blocks Before write and protects corrupted invocation file from being overwritten', () => {
    const d = makeHookSandbox('implementation', 'TASK-001');
    fs.mkdirSync(path.join(d, '.asa/nodes/tasks'), { recursive: true });
    fs.writeFileSync(path.join(d, '.asa/nodes/tasks/TASK-001.yaml'), 'id: TASK-001\ntitle: "活跃任务"\nstatus: in_progress\n');

    // 必须写 yaml 节点文件，才能正确触发 BeforeTool 的备份和 lock 逻辑
    const fileToEdit = path.join(d, '.asa/nodes/tasks/TASK-001.yaml');
    const hash = getPathHash(fileToEdit);

    const txDir = path.join(d, '.asa/transactions');
    fs.mkdirSync(txDir, { recursive: true });

    // 物理写入一个损坏的 json
    const invocationFile = path.join(txDir, `invocation-${hash}.json`);
    fs.writeFileSync(invocationFile, '{"broken_json: missing_braces...', 'utf-8');

    const r = spawnSync(process.execPath, [path.join(HOOKS_DIR, 'check-work-order.js'), fileToEdit], { cwd: d, encoding: 'utf8' });
    assert.equal(r.status, 2); // 应该阻断报错
    assert.match(r.stderr, /检测到损坏的 invocation 映射文件/);
    assert.ok(fs.existsSync(invocationFile), 'Corrupted mapping must stay intact');

    cleanupSandbox(d);
  });
});
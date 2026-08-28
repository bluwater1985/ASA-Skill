// engine/hooks/hooks.test.js — Hook 双协议测试（Claude argv / Gemini stdin）
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const HOOKS_DIR = __dirname;
let dir;

function makeSandbox(phase, activeTask) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asa-hook-'));
  fs.mkdirSync(path.join(d, '.asa/nodes/tasks'), { recursive: true });
  const meta = `meta:\n  phase: "${phase || 'discovery'}"${activeTask ? `\n  activeTask: ${activeTask}` : ''}\n  schemaVersion: 2\n  docsExpectedDigest: "sha256:empty"\n  docsActualDigest: "sha256:empty"\nrisks: []\nrequirements: {}\narchitecture: {}\ntasks: {}\nedges: []\n`;
  fs.writeFileSync(path.join(d, '.asa/matrix.yaml'), meta);
  return d;
}

function cleanup(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }

// 运行 hook（Claude argv 模式）
function runArgv(d, hook, filePath) {
  const r = spawnSync(process.execPath, [path.join(HOOKS_DIR, hook), filePath], { cwd: d, encoding: 'utf8' });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

// 运行 hook（Gemini stdin 模式）
// 通过 stdin 输入 JSON 的 Gemini 协议
function runStdin(d, hook, payload) {
  const r = spawnSync(process.execPath, [path.join(HOOKS_DIR, hook)], { cwd: d, input: JSON.stringify(payload), encoding: 'utf8' });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  return { stdout: r.stdout, parsed, status: r.status };
}

// ── check-work-order ──
describe('check-work-order hook', () => {
  it('allows writes in discovery phase', () => {
    const d = makeSandbox('discovery');
    const r = runArgv(d, 'check-work-order.js', path.join(d, 'src/app.js'));
    assert.equal(r.status, 0);
    cleanup(d);
  });

  it('allows .asa/ file writes even in implementation without active task', () => {
    const d = makeSandbox('implementation');
    const r = runArgv(d, 'check-work-order.js', path.join(d, '.asa/nodes/tasks/TASK-001.yaml'));
    assert.equal(r.status, 0);
    cleanup(d);
  });

  it('blocks writes in implementation without active task (Claude mode) with exit code 2', () => {
    const d = makeSandbox('implementation');
    const r = runArgv(d, 'check-work-order.js', path.join(d, 'src/app.js'));
    assert.equal(r.status, 2); // 验证进程退出码是否为 2
    assert.match(r.stderr, /没有活跃 Task/);
    cleanup(d);
  });

  it('allows writes when active task is set', () => {
    const d = makeSandbox('implementation', 'TASK-001');
    const r = runArgv(d, 'check-work-order.js', path.join(d, 'src/app.js'));
    assert.equal(r.status, 0);
    cleanup(d);
  });

  it('treats activeTask null as no active task (Gemini mode)', () => {
    const d = makeSandbox('implementation', 'null');
    const r = runStdin(d, 'check-work-order.js', { tool_input: { file_path: path.join(d, 'src/app.js') } });
    assert.equal(r.parsed.decision, 'deny');
    assert.match(JSON.stringify(r.parsed), /没有活跃 Task/);
    cleanup(d);
  });

  it('ignores commented-out activeTask (Gemini mode)', () => {
    const d = makeSandbox('implementation', 'TASK-001');
    // 注入注释里的陈旧 activeTask
    const mp = path.join(d, '.asa/matrix.yaml');
    let m = fs.readFileSync(mp, 'utf-8');
    m = m.replace('meta:', '# activeTask: TASK-999\nmeta:', 1);
    fs.writeFileSync(mp, m);
    const r = runStdin(d, 'check-work-order.js', { tool_input: { file_path: path.join(d, 'src/app.js') } });
    assert.equal(r.parsed.decision, 'allow');
    cleanup(d);
  });

  it('fails open when file path cannot be extracted (Gemini mode)', () => {
    const d = makeSandbox('implementation');
    const r = runStdin(d, 'check-work-order.js', { unknown_shape: {} });
    assert.equal(r.parsed.decision, 'deny');
    cleanup(d);
  });
});

// ── validate-yaml ──
describe('validate-yaml hook', () => {
  it('passes valid YAML with absolute path', () => {
    const d = makeSandbox('discovery');
    fs.writeFileSync(path.join(d, '.asa/nodes/tasks/OK.yaml'), 'meta:\n  phase: "discovery"\n');
    const r = runArgv(d, 'validate-yaml.js', path.join(d, '.asa/nodes/tasks/OK.yaml'));
    assert.equal(r.status, 0);
    assert.match(r.stdout, /YAML 通过/);
    cleanup(d);
  });

  it('blocks YAML with Tab indentation with exit code 2', () => {
    const d = makeSandbox('discovery');
    fs.writeFileSync(path.join(d, '.asa/nodes/tasks/BAD.yaml'), 'meta:\n\tphase: "x"\n');
    const r = runArgv(d, 'validate-yaml.js', path.join(d, '.asa/nodes/tasks/BAD.yaml'));
    assert.equal(r.status, 2); // 验证进程退出码是否为 2
    assert.match(r.stderr, /Tab/);
    cleanup(d);
  });

  it('blocks block scalar marker with exit code 2', () => {
    const d = makeSandbox('discovery');
    fs.writeFileSync(path.join(d, '.asa/nodes/tasks/BAD.yaml'), 'desc: |\n  x\n');
    const r = runArgv(d, 'validate-yaml.js', path.join(d, '.asa/nodes/tasks/BAD.yaml'));
    assert.equal(r.status, 2); // 验证进程退出码是否为 2
    assert.match(r.stderr, /块标量/);
    cleanup(d);
  });

  it('handles read errors gracefully with exit code 2 in Claude mode', () => {
    const d = makeSandbox('discovery');
    const folderPath = path.join(d, 'badfile.yaml');
    fs.mkdirSync(folderPath); // It's a directory but ends with .yaml
    const r = runArgv(d, 'validate-yaml.js', folderPath);
    assert.equal(r.status, 2); // Should exit with 2 even on error/throw!
    cleanup(d);
  });

  it('denies invalid YAML in Gemini stdin mode', () => {
    const d = makeSandbox('discovery');
    fs.writeFileSync(path.join(d, '.asa/nodes/tasks/BAD.yaml'), 'meta:\n\tphase: "x"\n');
    const r = runStdin(d, 'validate-yaml.js', { tool_input: { file_path: path.join(d, '.asa/nodes/tasks/BAD.yaml') } });
    assert.equal(r.parsed.decision, 'deny');
    cleanup(d);
  });

  it('fails open when path cannot be extracted', () => {
    const d = makeSandbox('discovery');
    const r = runStdin(d, 'validate-yaml.js', { unknown: true });
    assert.equal(r.parsed.decision, 'deny');
    cleanup(d);
  });

  // TDD 契约测试：验证 status: blocked 为合法业务状态，不遭回滚阻断 (P2 修复)
  it('passes validation for node with status: blocked', () => {
    const d = makeSandbox('discovery');
    fs.writeFileSync(path.join(d, '.asa/nodes/tasks/TASK-001.yaml'), 'id: TASK-001\ntitle: "Blocked Task"\nstatus: blocked\nlinkedReqs: []\nchangedFiles: []\n');
    const r = runArgv(d, 'validate-yaml.js', path.join(d, '.asa/nodes/tasks/TASK-001.yaml'));
    assert.equal(r.status, 0); // 应该顺利放行 (0)
    cleanup(d);
  });

  // TDD 契约测试：验证高并发/快速重入写同路径时多槽配对的先进先出 (FIFO) 隔离性能 (P1 修复)
  it('verifies FIFO Queue isolation for concurrent Before-After invocations on same node', () => {
    const d = makeSandbox('discovery');
    const beforeHook = path.join(HOOKS_DIR, 'check-work-order.js');
    const afterHook = path.join(HOOKS_DIR, 'validate-yaml.js');
    const nodePath = path.join(d, '.asa/nodes/tasks/TASK-001.yaml');
    fs.writeFileSync(nodePath, 'id: TASK-001\ntitle: "Concur"\nstatus: proposed\n');

    // 1. 模拟 Before 1：UUID_1 入队
    execFileSync(process.execPath, [beforeHook], {
      cwd: d,
      input: JSON.stringify({ arguments: { file_path: '.asa/nodes/tasks/TASK-001.yaml' } }),
      encoding: 'utf8',
      env: { ...process.env, ASA_INTERNAL_WRITE: 'true' }
    });

    // 2. 模拟 Before 2：UUID_2 入队
    execFileSync(process.execPath, [beforeHook], {
      cwd: d,
      input: JSON.stringify({ arguments: { file_path: '.asa/nodes/tasks/TASK-001.yaml' } }),
      encoding: 'utf8',
      env: { ...process.env, ASA_INTERNAL_WRITE: 'true' }
    });

    // 检查 transactions 下是否正确记录了多个配对 UUID
    const crypto = require('crypto');
    const norm = path.resolve(nodePath).replace(/\\/g, '/').toLowerCase();
    const hash = crypto.createHash('sha256').update(norm).digest('hex').substring(0, 12);
    const mapPath = path.join(d, `.asa/transactions/invocation-${hash}.json`);
    assert.ok(fs.existsSync(mapPath), 'Multi-slot mapping file must be established');

    const map = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
    assert.ok(Array.isArray(map.invocationIds), 'invocationIds must be an array');
    assert.equal(map.invocationIds.length, 2, 'Should queue 2 concurrent invocation IDs');

    const [id1, id2] = map.invocationIds;
    assert.notEqual(id1, id2, 'Invocation IDs must be physically isolated UUIDs');

    // 确保各自的备份文件和 marker 文件真实并存在磁盘上
    const backup1 = path.join(d, `.asa/transactions/hook-${hash}-${id1}.bak`);
    const backup2 = path.join(d, `.asa/transactions/hook-${hash}-${id2}.bak`);
    assert.ok(fs.existsSync(backup1), 'Backup 1 must exist');
    assert.ok(fs.existsSync(backup2), 'Backup 2 must exist');

    // 3. 模拟 After 1 (正常放行并清理最早入队的 UUID_1)
    execFileSync(process.execPath, [afterHook], {
      cwd: d,
      input: JSON.stringify({ arguments: { file_path: '.asa/nodes/tasks/TASK-001.yaml' } }),
      encoding: 'utf8'
    });
    // 此时 backup1 应被自洁删除，而 backup2 作为并发中的下一个写依然完好保留！
    assert.ok(!fs.existsSync(backup1), 'Backup 1 must be cleaned up after First After');
    assert.ok(fs.existsSync(backup2), 'Backup 2 must stay immune during First After');

    // 4. 模拟 After 2 (正常放行并清理接下来的 UUID_2)
    execFileSync(process.execPath, [afterHook], {
      cwd: d,
      input: JSON.stringify({ arguments: { file_path: '.asa/nodes/tasks/TASK-001.yaml' } }),
      encoding: 'utf8'
    });
    // 此时 backup2 也应被删除，且关系描述文件由于队列清空被彻底自洁unlink！
    assert.ok(!fs.existsSync(backup2), 'Backup 2 must be cleaned up after Second After');
    assert.ok(!fs.existsSync(mapPath), 'Mapping file must be unlinked after all slots are shift-emptied');

    cleanup(d);
  });

  // TDD 契约测试：验证 validate-yaml 状态集按品类分类校验拦截 (P2 修复)
  it('blocks category-mismatched status values', () => {
    const d = makeSandbox('discovery');
    // 创建一个 ARCH 节点，但写入非法的 status proposed (proposed 仅限 REQ 节点)
    fs.mkdirSync(path.join(d, '.asa/nodes/architecture'), { recursive: true });
    const archPath = path.join(d, '.asa/nodes/architecture/ARCH-001.yaml');
    fs.writeFileSync(archPath, 'id: ARCH-001\ntitle: "Mismatched State"\nstatus: proposed\n');
    const r = runArgv(d, 'validate-yaml.js', archPath);
    assert.equal(r.status, 2); // 应当拦截失败
    assert.match(r.stderr, /非法的 status 状态值/);
    cleanup(d);
  });

  it('allows ARCH approved status and blocks REQ verified status', () => {
    const d = makeSandbox('discovery');
    fs.mkdirSync(path.join(d, '.asa/nodes/architecture'), { recursive: true });
    fs.mkdirSync(path.join(d, '.asa/nodes/requirements'), { recursive: true });

    // 1. ARCH approved 应当通过
    const archPath = path.join(d, '.asa/nodes/architecture/ARCH-002.yaml');
    fs.writeFileSync(archPath, 'id: ARCH-002\ntitle: "Valid ARCH State"\nstatus: approved\n');
    const r1 = runArgv(d, 'validate-yaml.js', archPath);
    assert.equal(r1.status, 0); // 应当放行

    // 2. REQ verified 应当拦截 (verified 仅限 TASK)
    const reqPath = path.join(d, '.asa/nodes/requirements/REQ-002.yaml');
    fs.writeFileSync(reqPath, 'id: REQ-002\ntitle: "Invalid REQ State"\nstatus: verified\npriority: P1\n');
    const r2 = runArgv(d, 'validate-yaml.js', reqPath);
    assert.equal(r2.status, 2); // 应当拦截失败
    assert.match(r2.stderr, /非法的 status 状态值/);

    cleanup(d);
  });
});

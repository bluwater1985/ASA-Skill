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

  it('blocks writes in implementation without active task (Claude mode)', () => {
    const d = makeSandbox('implementation');
    const r = runArgv(d, 'check-work-order.js', path.join(d, 'src/app.js'));
    assert.notEqual(r.status, 0);
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
    assert.equal(r.parsed.decision, 'allow');
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

  it('blocks YAML with Tab indentation', () => {
    const d = makeSandbox('discovery');
    fs.writeFileSync(path.join(d, '.asa/nodes/tasks/BAD.yaml'), 'meta:\n\tphase: "x"\n');
    const r = runArgv(d, 'validate-yaml.js', path.join(d, '.asa/nodes/tasks/BAD.yaml'));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Tab/);
    cleanup(d);
  });

  it('blocks block scalar marker', () => {
    const d = makeSandbox('discovery');
    fs.writeFileSync(path.join(d, '.asa/nodes/tasks/BAD.yaml'), 'desc: |\n  x\n');
    const r = runArgv(d, 'validate-yaml.js', path.join(d, '.asa/nodes/tasks/BAD.yaml'));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /块标量/);
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
    assert.equal(r.parsed.decision, 'allow');
    cleanup(d);
  });
});

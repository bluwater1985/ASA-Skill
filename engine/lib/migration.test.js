// engine/lib/migration.test.js — 存量数据自动迁移测试（旧版数据 → 新引擎兼容）
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { softenYaml, parseAsaYaml, stringifyAsaYaml } = require('./yaml.js');

function makeOldSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asa-mig-'));
  fs.mkdirSync(path.join(dir, '.asa/nodes/requirements'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.asa/nodes/tasks'), { recursive: true });
  // 旧版 matrix：无 schemaVersion、无 nodesDigest、旧 digest 值
  const oldMatrix = `meta:
  project: "old"
  phase: "implementation"
  docsExpectedDigest: "sha256:deadbeef"
  docsActualDigest: "sha256:deadbeef"
risks: []
requirements: {}
architecture: {}
tasks: {}
edges: []
`;
  fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), oldMatrix);
  // 旧版节点：块标量 + pending 状态
  const oldReq = `id: REQ-001
title: 旧需求
desc: |
  第一行描述
  第二行描述
status: pending
`;
  fs.writeFileSync(path.join(dir, '.asa/nodes/requirements/REQ-001.yaml'), oldReq);
  return dir;
}

function copyEngine(dir) {
  const repo = path.join(__dirname, '..', '..');
  fs.copyFileSync(path.join(repo, 'engine/index.js'), path.join(dir, '.asa/index.js'));
  fs.copyFileSync(path.join(repo, 'engine/version.js'), path.join(dir, '.asa/version.js'));
  fs.cpSync(path.join(repo, 'engine/commands'), path.join(dir, '.asa/commands'), { recursive: true });
  fs.cpSync(path.join(repo, 'engine/lib'), path.join(dir, '.asa/lib'), { recursive: true });
}

function runCli(dir, args) {
  const r = execFileSync(process.execPath, [path.join(dir, '.asa/index.js'), ...args], { cwd: dir, encoding: 'utf8' });
  return r;
}

// ── softenYaml ──
describe('softenYaml', () => {
  it('converts literal block scalar to quoted string', () => {
    const yaml = 'desc: |\n  第一行\n  第二行\nstatus: pending';
    const r = softenYaml(yaml);
    const data = parseAsaYaml(r.text);
    assert.equal(data.desc, '第一行\n第二行');
    assert.equal(data.status, 'pending');
    assert.ok(r.fixes.some(f => f.includes('块标量')));
  });

  it('converts folded block scalar to single-line string', () => {
    const yaml = 'desc: >\n  第一行\n  第二行';
    const r = softenYaml(yaml);
    const data = parseAsaYaml(r.text);
    assert.equal(data.desc, '第一行 第二行');
  });

  it('converts Tab indentation to spaces', () => {
    const yaml = 'meta:\n\tphase: discovery\n\tactiveTask: TASK-001';
    const r = softenYaml(yaml);
    const data = parseAsaYaml(r.text);
    assert.equal(data.meta.phase, 'discovery');
    assert.ok(r.fixes.some(f => f.includes('Tab')));
  });

  it('leaves normal YAML unchanged', () => {
    const yaml = 'title: 正常\nstatus: proposed\nlist:\n  - a\n  - b';
    const r = softenYaml(yaml);
    const data = parseAsaYaml(r.text);
    assert.deepEqual(data, { title: '正常', status: 'proposed', list: ['a', 'b'] });
    assert.equal(r.fixes.length, 0);
  });

  it('preserves content with special chars in block scalar', () => {
    const yaml = 'desc: |\n  含"引号"和: 冒号\n  第二行';
    const r = softenYaml(yaml);
    const data = parseAsaYaml(r.text);
    assert.equal(data.desc, '含"引号"和: 冒号\n第二行');
  });
});

// ── reconcile 自动迁移（端到端）──
describe('reconcile auto-migration', () => {
  it('migrates old data: block scalar + pending status + digest', () => {
    const dir = makeOldSandbox();
    copyEngine(dir);
    // 非 TTY 环境应自动迁移（半自动：TTY 才询问）
    const output = runCli(dir, ['reconcile']);
    // 迁移后节点应可加载、状态保留 pending (P1-1 修复)
    const node = parseAsaYaml(fs.readFileSync(path.join(dir, '.asa/nodes/requirements/REQ-001.yaml'), 'utf-8'));
    assert.equal(node.status, 'pending');
    // desc 已转成引号串（可正常解析）
    assert.ok(node.desc.includes('第一行'));
    // matrix 应更新：schemaVersion 3 + nodesDigest
    const matrix = parseAsaYaml(fs.readFileSync(path.join(dir, '.asa/matrix.yaml'), 'utf-8'));
    assert.equal(matrix.meta.schemaVersion, 3);
    assert.ok(matrix.meta.nodesDigest);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('creates a backup before migrating', () => {
    const dir = makeOldSandbox();
    copyEngine(dir);
    runCli(dir, ['reconcile']);
    const backups = fs.readdirSync(path.join(dir, '.asa/backups'));
    assert.ok(backups.some(b => b.startsWith('reconcile-pre-v3')));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('validate passes after migration + compile', () => {
    const dir = makeOldSandbox();
    copyEngine(dir);
    runCli(dir, ['reconcile']);
    runCli(dir, ['compile']);
    const out = runCli(dir, ['validate']);
    assert.match(out, /健康检查通过/);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });
});

// engine/commands/commands.test.js — CLI 命令集成测试（每个 describe 独立沙箱）
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createSandbox, run, readNode, readMatrix, writeNode } = require('./helpers.js');

// ── add ──
describe('add command', () => {
  let dir;
  before(() => { dir = createSandbox(); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('creates REQ node with correct id and template', () => {
    const r = run(dir, 'add-req', ['规则检查']);
    assert.match(r.output, /REQ-001 已创建/);
    const node = readNode(dir, 'requirements', 'REQ-001');
    assert.equal(node.id, 'REQ-001');
    assert.equal(node.title, '规则检查');
    assert.equal(node.status, 'proposed');
    assert.equal(node.version, 1);
  });

  it('creates ARCH and TASK nodes', () => {
    run(dir, 'add-arch', ['引擎架构']);
    run(dir, 'add-task', ['实现任务']);
    assert.ok(readNode(dir, 'architecture', 'ARCH-001'));
    assert.equal(readNode(dir, 'architecture', 'ARCH-001').status, 'draft');
    assert.equal(readNode(dir, 'tasks', 'TASK-001').status, 'pending');
  });

  it('parses --priority flag for REQ', () => {
    run(dir, 'add-req', ['优先级需求', '--priority', 'P1']);
    assert.equal(readNode(dir, 'requirements', 'REQ-002').priority, 'P1');
  });

  it('registers node into matrix summary', () => {
    const m = readMatrix(dir);
    assert.ok(m.requirements['REQ-001']);
    assert.equal(m.requirements['REQ-001'].status, 'proposed');
  });
});

// ── status ──
describe('status command', () => {
  let dir;
  before(() => { dir = createSandbox(); run(dir, 'add-req', ['状态测试']); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('advances valid transition and bumps version', () => {
    const r = run(dir, 'status', ['REQ-001', 'approved']);
    assert.match(r.output, /proposed → approved/);
    const node = readNode(dir, 'requirements', 'REQ-001');
    assert.equal(node.status, 'approved');
    assert.equal(node.version, 2);
  });

  it('rejects illegal transition', () => {
    const r = run(dir, 'status', ['REQ-001', 'verified']);
    assert.match(r.output, /不允许/);
    assert.ok(r.exitCode !== 0);
  });

  it('is idempotent for same state', () => {
    const r = run(dir, 'status', ['REQ-001', 'approved']);
    assert.match(r.output, /已是 approved/);
  });
});

// ── edge ──
describe('edge command', () => {
  let dir;
  before(() => { dir = createSandbox(); run(dir, 'add-req', ['边测试']); run(dir, 'add-arch', ['架构']); run(dir, 'add-task', ['任务']); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('adds edge with type', () => {
    const r = run(dir, 'edge', ['add', 'REQ-001', 'ARCH-001', '--type', 'depends']);
    assert.match(r.output, /边已添加/);
  });

  it('rejects cycle', () => {
    run(dir, 'edge', ['add', 'ARCH-001', 'TASK-001', '--type', 'refines']);
    const r = run(dir, 'edge', ['add', 'TASK-001', 'REQ-001', '--type', 'depends']);
    assert.match(r.output, /循环依赖/);
    assert.ok(r.exitCode !== 0);
  });

  it('rejects unknown type', () => {
    const r = run(dir, 'edge', ['add', 'REQ-001', 'TASK-001', '--type', 'banana']);
    assert.match(r.output, /无效边类型/);
  });

  it('removes edge', () => {
    const r = run(dir, 'edge', ['rm', 'REQ-001', 'ARCH-001']);
    assert.match(r.output, /边已删除/);
  });
});

// ── impact ──
describe('impact command', () => {
  let dir;
  before(() => {
    dir = createSandbox();
    run(dir, 'add-req', ['影响测试']); run(dir, 'add-arch', ['架构']); run(dir, 'add-task', ['任务']);
    run(dir, 'edge', ['add', 'REQ-001', 'ARCH-001', '--type', 'depends']);
    run(dir, 'edge', ['add', 'ARCH-001', 'TASK-001', '--type', 'refines']);
  });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('reports downstream nodes', () => {
    const r = run(dir, 'impact', ['REQ-001']);
    assert.match(r.output, /下游影响/);
    assert.match(r.output, /ARCH-001/);
  });

  it('errors on missing node', () => {
    const r = run(dir, 'impact', ['GHOST-001']);
    assert.match(r.output, /不存在/);
    assert.ok(r.exitCode !== 0);
  });
});

// ── propagate ──
describe('propagate command', () => {
  let dir;
  before(() => { dir = createSandbox(); run(dir, 'add-task', ['任务']); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('executes pendingPropagation actions', () => {
    writeNode(dir, 'requirements', 'REQ-003', {
      id: 'REQ-003', title: '传播源', status: 'approved', version: 2,
      changeLog: [], pendingPropagation: [{
        changeVersion: 3, status: 'pending',
        affectedNodes: [{ id: 'TASK-001', action: { type: 'append_to_array', target: 'outputs', value: '爬电原子' } }],
      }],
    });
    const r = run(dir, 'propagate', ['REQ-003']);
    assert.match(r.output, /append_to_array/);
    const task = readNode(dir, 'tasks', 'TASK-001');
    assert.ok(task.outputs.includes('爬电原子'));
    // approved → modified 合法，源节点置 modified 且版本递增
    const src = readNode(dir, 'requirements', 'REQ-003');
    assert.equal(src.status, 'modified');
    assert.equal(src.version, 3);
  });

  it('clears entry on all-idempotent skip', () => {
    writeNode(dir, 'requirements', 'REQ-006', {
      id: 'REQ-006', title: '幂等源', status: 'approved', version: 2,
      changeLog: [], pendingPropagation: [{
        changeVersion: 3, status: 'pending',
        affectedNodes: [{ id: 'TASK-001', action: { type: 'set_status', value: 'pending' } }], // TASK-001 已是 pending → 幂等
      }],
    });
    const r = run(dir, 'propagate', ['REQ-006']);
    assert.match(r.output, /幂等命中/);
    const src = readNode(dir, 'requirements', 'REQ-006');
    assert.deepEqual(src.pendingPropagation, []);
  });

  it('keeps failed action as partial with non-zero exit', () => {
    writeNode(dir, 'tasks', 'TASK-002', { id: 'TASK-002', title: '已完成', status: 'completed', version: 2, changeLog: [] });
    writeNode(dir, 'requirements', 'REQ-004', {
      id: 'REQ-004', title: '失败源', status: 'proposed', version: 1,
      changeLog: [], pendingPropagation: [{
        changeVersion: 2, status: 'pending',
        affectedNodes: [{ id: 'TASK-002', action: { type: 'set_status', value: 'in_progress' } }],
      }],
    });
    const r = run(dir, 'propagate', ['REQ-004']);
    assert.ok(r.exitCode !== 0);
    const src = readNode(dir, 'requirements', 'REQ-004');
    assert.equal(src.pendingPropagation[0].status, 'partial');
  });
});

// ── deprecate ──
describe('deprecate command', () => {
  let dir;
  before(() => { dir = createSandbox(); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('marks REQ deprecated', () => {
    writeNode(dir, 'requirements', 'REQ-005', { id: 'REQ-005', title: '待废弃', status: 'proposed', version: 1 });
    const r = run(dir, 'deprecate', ['REQ-005']);
    assert.match(r.output, /deprecated/);
    assert.equal(readNode(dir, 'requirements', 'REQ-005').status, 'deprecated');
  });

  it('dispatches ARCH to superseded', () => {
    writeNode(dir, 'architecture', 'ARCH-002', { id: 'ARCH-002', title: '架构', status: 'draft', version: 1 });
    const r = run(dir, 'deprecate', ['ARCH-002']);
    assert.match(r.output, /superseded/);
    assert.equal(readNode(dir, 'architecture', 'ARCH-002').status, 'superseded');
  });

  it('cascades downstream TASK to cancelled', () => {
    writeNode(dir, 'requirements', 'REQ-010', { id: 'REQ-010', title: '级联源', status: 'proposed', version: 1 });
    writeNode(dir, 'tasks', 'TASK-010', { id: 'TASK-010', title: '下游', status: 'pending', version: 1 });
    run(dir, 'edge', ['add', 'REQ-010', 'TASK-010']);
    run(dir, 'deprecate', ['REQ-010']);
    assert.equal(readNode(dir, 'tasks', 'TASK-010').status, 'cancelled');
  });

  it('clears activeTask when cascaded task was active', () => {
    writeNode(dir, 'requirements', 'REQ-011', { id: 'REQ-011', title: '活跃源', status: 'proposed', version: 1 });
    writeNode(dir, 'tasks', 'TASK-011', { id: 'TASK-011', title: '活跃', status: 'pending', version: 1 });
    run(dir, 'edge', ['add', 'REQ-011', 'TASK-011']);
    run(dir, 'set', ['active-task', 'TASK-011']);
    run(dir, 'deprecate', ['REQ-011']);
    assert.equal(readMatrix(dir).meta.activeTask, '(none)');
  });
});

// ── change ──
describe('change command', () => {
  let dir;
  before(() => { dir = createSandbox(); run(dir, 'add-req', ['变更测试']); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('creates a backup snapshot', () => {
    const r = run(dir, 'change-req', ['REQ-001']);
    assert.match(r.output, /快照/);
    const backups = fs.readdirSync(path.join(dir, '.asa/backups'));
    assert.ok(backups.some(b => b.startsWith('REQ-001.')));
  });
});

// ── set ──
describe('set command', () => {
  let dir;
  before(() => { dir = createSandbox(); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('sets phase', () => {
    const r = run(dir, 'set', ['phase', 'implementation']);
    assert.match(r.output, /阶段已更新/);
    assert.equal(readMatrix(dir).meta.phase, 'implementation');
  });

  it('rejects invalid phase', () => {
    const r = run(dir, 'set', ['phase', 'bogus']);
    assert.match(r.output, /无效阶段/);
  });

  it('rejects non-TASK active-task', () => {
    const r = run(dir, 'set', ['active-task', 'REQ-001']);
    assert.match(r.output, /必须.*TASK/);
  });
});

// ── journal / history / traverse ──
describe('journal, history, traverse', () => {
  let dir;
  before(() => {
    dir = createSandbox();
    run(dir, 'add-req', ['查询测试']);
    run(dir, 'status', ['REQ-001', 'approved']);
    run(dir, 'add-task', ['任务']);
    run(dir, 'edge', ['add', 'REQ-001', 'TASK-001']);
  });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('journal lists changeLog entries', () => {
    const r = run(dir, 'journal', []);
    assert.match(r.output, /变更历史/);
  });

  it('history shows node changeLog', () => {
    const r = run(dir, 'history', ['REQ-001']);
    assert.match(r.output, /REQ-001/);
  });

  it('traverse validates node existence', () => {
    const r = run(dir, 'traverse', ['GHOST']);
    assert.match(r.output, /不存在/);
    assert.ok(r.exitCode !== 0);
  });

  it('traverse outputs blast radius JSON', () => {
    const r = run(dir, 'traverse', ['REQ-001']);
    assert.match(r.output, /blastRadius/);
  });
});

// ── compile / reconcile / validate / patch ──
describe('compile/reconcile/validate/patch', () => {
  let dir;
  before(() => {
    dir = createSandbox();
    run(dir, 'add-req', ['闭环测试']);
    run(dir, 'add-task', ['任务']);
    run(dir, 'status', ['REQ-001', 'approved']);
    run(dir, 'edge', ['add', 'REQ-001', 'TASK-001']);
  });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('compile generates docs', () => {
    const r = run(dir, 'compile', []);
    assert.match(r.output, /编译完成/);
    const docs = fs.readFileSync(path.join(dir, 'docs/01-requirements.md'), 'utf-8');
    assert.match(docs, /ASA-NODE: REQ-001/);
    assert.match(docs, /ASA-VERSION:/);
  });

  it('validate passes on consistent state', () => {
    const r = run(dir, 'validate', []);
    assert.match(r.output, /健康检查通过/);
    assert.equal(r.exitCode, 0);
  });

  it('validate detects node drift', () => {
    writeNode(dir, 'tasks', 'TASK-009', { id: 'TASK-009', title: '漂移', status: 'pending', version: 1 });
    const r = run(dir, 'validate', []);
    assert.match(r.output, /未重新 compile/);
    assert.ok(r.exitCode !== 0);
  });

  it('reconcile rebuilds summary from nodes', () => {
    run(dir, 'compile', []);
    const r = run(dir, 'reconcile', []);
    const m = readMatrix(dir);
    assert.ok(m.tasks['TASK-001']);
    assert.equal(m.tasks['TASK-001'].status, 'pending');
  });

  it('patch reverse-syncs criteria from docs', () => {
    run(dir, 'compile', []);
    const docsPath = path.join(dir, 'docs/01-requirements.md');
    let docs = fs.readFileSync(docsPath, 'utf-8');
    docs = docs.replace('<!-- ASA-FIELD: acceptanceCriteria -->', '<!-- ASA-FIELD: acceptanceCriteria -->\n- 新接受条件\n', 1);
    fs.writeFileSync(docsPath, docs);
    run(dir, 'reconcile', []);
    run(dir, 'patch', []);
    const node = readNode(dir, 'requirements', 'REQ-001');
    assert.ok(node.acceptanceCriteria.includes('新接受条件'));
  });
});

// ── reconcile migration / bootstrap ──
describe('reconcile migration and bootstrap', () => {
  it('migrates legacy pending REQ/ARCH to new states', () => {
    const d = createSandbox();
    // 模拟 v1 项目：无 schemaVersion + REQ status pending
    const m = readMatrix(d);
    delete m.meta.schemaVersion;
    const { stringifyAsaYaml } = require('../lib/yaml.js');
    fs.writeFileSync(path.join(d, '.asa/matrix.yaml'), stringifyAsaYaml(m));
    writeNode(d, 'requirements', 'REQ-100', { id: 'REQ-100', title: '旧需求', status: 'pending' });
    writeNode(d, 'architecture', 'ARCH-100', { id: 'ARCH-100', title: '旧架构', status: 'pending' });
    const r = run(d, 'reconcile', []);
    assert.equal(readNode(d, 'requirements', 'REQ-100').status, 'proposed');
    assert.equal(readNode(d, 'architecture', 'ARCH-100').status, 'draft');
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  });

  it('bootstraps from skeleton when matrix missing', () => {
    const d = createSandbox();
    fs.rmSync(path.join(d, '.asa/matrix.yaml'));
    const r = run(d, 'reconcile', []);
    assert.ok(fs.existsSync(path.join(d, '.asa/matrix.yaml')));
    const m = readMatrix(d);
    assert.equal(m.meta.schemaVersion, 2);
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  });
});

// ── set active-task clear ──
describe('set active-task clear', () => {
  it('clears active task', () => {
    const d = createSandbox();
    run(d, 'add-task', ['任务']);
    run(d, 'set', ['active-task', 'TASK-001']);
    const r = run(d, 'set', ['active-task', 'clear']);
    assert.match(r.output, /已清除/);
    assert.equal(readMatrix(d).meta.activeTask, '(none)');
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  });
});

// ── validate missing file check ──
describe('validate missing task file', () => {
  it('reports missing task file', () => {
    const d = createSandbox();
    run(d, 'add-task', ['任务']);
    // 在 matrix 中登记一个指向不存在文件的 task
    const m = readMatrix(d);
    m.tasks['TASK-999'] = { title: '幽灵', status: 'pending', file: '.asa/nodes/tasks/TASK-999.yaml' };
    const { stringifyAsaYaml } = require('../lib/yaml.js');
    fs.writeFileSync(path.join(d, '.asa/matrix.yaml'), stringifyAsaYaml(m));
    const r = run(d, 'validate', []);
    assert.match(r.output, /不存在/);
    assert.ok(r.exitCode !== 0);
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  });
});

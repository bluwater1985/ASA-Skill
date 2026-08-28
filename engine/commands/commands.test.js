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

  it('blocks transitions from awaiting-confirmation under generic status', () => {
    run(dir, 'add-task', ['测试Awaiting']); // TASK-001
    run(dir, 'status', ['TASK-001', 'in_progress']);
    run(dir, 'status', ['TASK-001', 'awaiting-confirmation']);

    const r = run(dir, 'status', ['TASK-001', 'completed']);
    assert.match(r.output, /不允许/);
    assert.notEqual(r.exitCode, 0);
  });

  it('prints waiting for confirmation prompt when entering awaiting-confirmation', () => {
    run(dir, 'add-task', ['测试提示']); // TASK-002
    run(dir, 'status', ['TASK-002', 'in_progress']);
    const r = run(dir, 'status', ['TASK-002', 'awaiting-confirmation']);
    assert.match(r.output, /等待用户确认/);
  });

  it('blocks transitions to final states (completed/verified) but allows cancelled for tasks under generic status', () => {
    run(dir, 'set', ['phase', 'implementation']);
    run(dir, 'add-task', ['测试状态旁路']); // TASK-003
    run(dir, 'set', ['active-task', 'TASK-003']);
    run(dir, 'status', ['TASK-003', 'in_progress']);

    // Attempt to directly set status to completed
    const rCompleted = run(dir, 'status', ['TASK-003', 'completed']);
    assert.notEqual(rCompleted.exitCode, 0);
    assert.match(rCompleted.output, /必须通过专用审核命令处理/);

    // Attempt to directly set status to verified
    const rVerified = run(dir, 'status', ['TASK-003', 'verified']);
    assert.notEqual(rVerified.exitCode, 0);
    assert.match(rVerified.output, /必须通过专用审核命令处理/);

    // Attempt to directly set status to cancelled (Now allowed!)
    const rCancelled = run(dir, 'status', ['TASK-003', 'cancelled']);
    assert.equal(rCancelled.exitCode, 0);
    assert.equal(readNode(dir, 'tasks', 'TASK-003').status, 'cancelled');
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
    run(dir, 'edge', ['add', 'ARCH-001', 'TASK-001', '--type', 'depends']);
    const r = run(dir, 'edge', ['add', 'TASK-001', 'REQ-001', '--type', 'depends']);
    assert.match(r.output, /循环依赖/);
    assert.ok(r.exitCode !== 0);
  });

  it('rejects unknown type', () => {
    const r = run(dir, 'edge', ['add', 'REQ-001', 'TASK-001', '--type', 'banana']);
    assert.match(r.output, /无效边类型/);
  });

  it('allows same from/to edges with different types', () => {
    const r1 = run(dir, 'edge', ['add', 'REQ-001', 'ARCH-001', '--type', 'extends']);
    assert.match(r1.output, /边已添加/);
    const r2 = run(dir, 'edge', ['add', 'REQ-001', 'ARCH-001', '--type', 'extends']);
    assert.match(r2.output, /已存在，跳过/);
  });

  it('does not create cycle for non-depends edges', () => {
    const localDir = createSandbox();
    run(localDir, 'add-req', ['边测试']); run(localDir, 'add-arch', ['架构']); run(localDir, 'add-task', ['任务']);
    run(localDir, 'edge', ['add', 'REQ-001', 'ARCH-001', '--type', 'depends']);
    
    // 即使 ARCH-001 -> TASK-001 构环（但其类型是 refines），在只过滤 depends 口径新环检测下，不应当被循环依赖拦截！
    run(localDir, 'edge', ['add', 'ARCH-001', 'TASK-001', '--type', 'refines']);
    const r = run(localDir, 'edge', ['add', 'TASK-001', 'REQ-001', '--type', 'depends']);
    assert.match(r.output, /边已添加/);
    try { fs.rmSync(localDir, { recursive: true, force: true }); } catch {}
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

  it('covers propagate action edge cases and invalid targets to harden coverage', () => {
    writeNode(dir, 'requirements', 'REQ-999', {
      id: 'REQ-999', title: '异常动作测试', status: 'proposed', version: 1,
      changeLog: [], pendingPropagation: [{
        changeVersion: 2, status: 'pending',
        affectedNodes: [
          { id: 'TASK-001', action: { type: 'set_status' } },
          { id: 'TASK-001', action: { type: 'append_to_array', value: 'xxx' } },
          { id: 'TASK-001', action: { type: 'append_to_array', target: 'id', value: 'xxx' } },
          { id: 'TASK-001', action: { type: 'set_field', value: 'xxx' } },
          { id: 'TASK-001', action: { type: 'replace_in_array', value: 'xxx' } },
          { id: 'TASK-001', action: { type: 'replace_in_array', target: 'title', value: { old: 'a', new: 'b' } } },
          { id: 'TASK-001', action: { type: 'unknown_action' } }
        ],
      }],
    });
    const r = run(dir, 'propagate', ['REQ-999']);
    assert.ok(r.exitCode !== 0);
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

  it('skips cascading TASK in awaiting-confirmation and prints tip', () => {
    writeNode(dir, 'requirements', 'REQ-012', { id: 'REQ-012', title: '级联跳过源', status: 'proposed', version: 1 });
    writeNode(dir, 'tasks', 'TASK-012', { id: 'TASK-012', title: '提审下游', status: 'awaiting-confirmation', version: 1 });
    run(dir, 'edge', ['add', 'REQ-012', 'TASK-012']);
    
    const r = run(dir, 'deprecate', ['REQ-012']);
    
    assert.equal(readNode(dir, 'tasks', 'TASK-012').status, 'awaiting-confirmation');
    assert.match(r.output, /处于 awaiting-confirmation 状态，已安全跳过级联取消/);
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

  it('validate blocks physical modification of requirements.md (DOCS_TAMPERED)', () => {
    // 1. 确保 docs 已 compile 生成，两端对齐
    run(dir, 'compile', []);
    
    // 2. 模拟手改 requirements.md 物理文件
    const reqMdPath = path.join(dir, 'docs/01-requirements.md');
    fs.appendFileSync(reqMdPath, '\n<!-- 手动加塞的小动作 -->\n');
    
    // 3. 运行 reconcile 以模拟篡改后对账 (Actual 会变，但 Expected 不变)
    run(dir, 'reconcile', []);
    
    // 4. 调用 validate，应该百分之百拦截并返回非零退出码，提示物理修改或未编译
    const r = run(dir, 'validate', []);
    assert.match(r.output, /被物理修改或未运行 compile/);
    assert.notEqual(r.exitCode, 0);
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
    assert.equal(readNode(d, 'requirements', 'REQ-100').status, 'pending');
    assert.equal(readNode(d, 'architecture', 'ARCH-100').status, 'pending');
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  });

  it('bootstraps from skeleton when matrix missing', () => {
    const d = createSandbox();
    fs.rmSync(path.join(d, '.asa/matrix.yaml'));
    const r = run(d, 'reconcile', []);
    assert.ok(fs.existsSync(path.join(d, '.asa/matrix.yaml')));
    const m = readMatrix(d);
    assert.equal(m.meta.schemaVersion, 4);
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

// ── cancel-task ──
describe('cancel-task command', () => {
  let dir;
  before(() => {
    dir = createSandbox();
    run(dir, 'add-task', ['要取消的任务']); // TASK-001
  });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('rejects cancel-task on non-awaiting-confirmation task', () => {
    const r = run(dir, 'cancel-task', ['TASK-001', '--by', 'tester', '--note', '理由']);
    assert.match(r.output, /当前状态不是 awaiting-confirmation/);
    assert.notEqual(r.exitCode, 0);
  });

  it('executes cancel-task and creates confirmation info', () => {
    run(dir, 'status', ['TASK-001', 'in_progress']);
    run(dir, 'set', ['active-task', 'TASK-001']);
    run(dir, 'status', ['TASK-001', 'awaiting-confirmation']);

    let matrixBefore = readMatrix(dir);
    assert.equal(matrixBefore.meta.activeTask, 'TASK-001');

    const r = run(dir, 'cancel-task', ['TASK-001', '--by', 'tester', '--note', '理由']);
    assert.equal(r.exitCode, 0);

    const node = readNode(dir, 'tasks', 'TASK-001');
    assert.equal(node.status, 'cancelled');
    assert.ok(node.confirmation);
    assert.equal(node.confirmation.status, 'cancelled');
    assert.equal(node.confirmation.by, 'tester');
    assert.equal(node.confirmation.note, '理由');
    assert.ok(node.confirmation.at);

    // Active task should be cleared since activeTask === targetTask
    const matrixAfter = readMatrix(dir);
    assert.equal(matrixAfter.meta.activeTask, '(none)');
  });

  it('supports idempotent cancel-task if already cancelled', () => {
    const r = run(dir, 'cancel-task', ['TASK-001', '--by', 'tester', '--note', '理由2']);
    assert.equal(r.exitCode, 0);
  });
});


// ── confirm-task & reject-task (Step 3) ──
describe('confirm-task and reject-task commands (Step 3)', () => {
  let dir;
  before(() => {
    dir = createSandbox();
    run(dir, 'add-task', ['测试任务']); // TASK-001
  });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('rejects set active-task if task is in awaiting-confirmation', () => {
    run(dir, 'status', ['TASK-001', 'in_progress']);
    run(dir, 'status', ['TASK-001', 'awaiting-confirmation']);

    const r = run(dir, 'set', ['active-task', 'TASK-001']);
    assert.match(r.output, /awaiting-confirmation/);
    assert.notEqual(r.exitCode, 0);
  });

  it('rejects confirm-task if task is not in awaiting-confirmation', () => {
    run(dir, 'add-task', ['未确认任务']); // TASK-002
    const r = run(dir, 'confirm-task', ['TASK-002', '--by', 'tester', '--note', '很好']);
    assert.match(r.output, /当前状态不是 awaiting-confirmation/);
    assert.notEqual(r.exitCode, 0);
  });

  it('rejects reject-task if task is not in awaiting-confirmation', () => {
    const r = run(dir, 'reject-task', ['TASK-002', '--by', 'tester', '--note', '不行']);
    assert.match(r.output, /当前状态不是 awaiting-confirmation/);
    assert.notEqual(r.exitCode, 0);
  });

  it('executes reject-task and moves status back to in_progress with changelog', () => {
    run(dir, 'status', ['TASK-002', 'in_progress']);
    run(dir, 'set', ['active-task', 'TASK-002']);
    run(dir, 'status', ['TASK-002', 'awaiting-confirmation']);

    const r = run(dir, 'reject-task', ['TASK-002', '--by', 'reviewer1', '--note', '重新修改代码']);
    assert.equal(r.exitCode, 0);

    const node = readNode(dir, 'tasks', 'TASK-002');
    assert.equal(node.status, 'in_progress');
    assert.ok(node.confirmation);
    assert.equal(node.confirmation.status, 'changes-requested');
    assert.equal(node.confirmation.by, 'reviewer1');
    assert.equal(node.confirmation.note, '重新修改代码');
    assert.ok(node.confirmation.at);

    const matrix = readMatrix(dir);
    assert.equal(matrix.meta.activeTask, 'TASK-002');
  });

  it('supports idempotent reject-task if already in_progress', () => {
    const r = run(dir, 'reject-task', ['TASK-002', '--by', 'reviewer1', '--note', '重新修改代码']);
    assert.equal(r.exitCode, 0);
  });

  it('executes confirm-task and moves status to completed with compile and clears activeTask', () => {
    // 先登记一个真实存在的工作树文件，满足「实现落地门禁」(D2)
    fs.writeFileSync(path.join(dir, 'impl.js'), '// implementation\n');
    run(dir, 'record-changes', ['TASK-002', 'impl.js']);
    run(dir, 'status', ['TASK-002', 'awaiting-confirmation']);

    const r = run(dir, 'confirm-task', ['TASK-002', '--by', 'reviewer2', '--note', '审核通过，发布']);
    assert.equal(r.exitCode, 0);

    const node = readNode(dir, 'tasks', 'TASK-002');
    assert.equal(node.status, 'completed');
    assert.ok(node.confirmation);
    assert.equal(node.confirmation.status, 'confirmed');
    assert.equal(node.confirmation.by, 'reviewer2');
    assert.equal(node.confirmation.note, '审核通过，发布');
    assert.ok(node.confirmation.at);

    const matrix = readMatrix(dir);
    assert.equal(matrix.meta.activeTask, '(none)');
  });

  it('supports idempotent confirm-task if already completed', () => {
    const r = run(dir, 'confirm-task', ['TASK-002', '--by', 'reviewer2', '--note', '重复确认']);
    assert.equal(r.exitCode, 0);
  });
});

// ── confirm/reject/cancel mandatory --by audit test ──
describe('confirm/reject/cancel mandatory --by audit test', () => {
  let dir;
  before(() => {
    dir = createSandbox();
    run(dir, 'add-task', ['测试审计任务']); // TASK-001
    run(dir, 'status', ['TASK-001', 'in_progress']);
    run(dir, 'set', ['active-task', 'TASK-001']);
    run(dir, 'status', ['TASK-001', 'awaiting-confirmation']);
  });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('rejects confirm-task if --by is missing', () => {
    const r = run(dir, 'confirm-task', ['TASK-001', '--note', '理由']);
    assert.match(r.output, /缺少 --by 审计参数/);
    assert.notEqual(r.exitCode, 0);
  });

  it('rejects reject-task if --by is missing', () => {
    const r = run(dir, 'reject-task', ['TASK-001', '--note', '理由']);
    assert.match(r.output, /缺少 --by 审计参数/);
    assert.notEqual(r.exitCode, 0);
  });

  it('rejects cancel-task if --by is missing', () => {
    const r = run(dir, 'cancel-task', ['TASK-001', '--note', '理由']);
    assert.match(r.output, /缺少 --by 审计参数/);
    assert.notEqual(r.exitCode, 0);
  });
});

// ── commands branch coverage hardening suite ──
describe('commands branch coverage hardening suite', () => {
  let dir;
  before(() => { dir = createSandbox(); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('covers set command missing args and invalid task blocks', () => {
    const rSet1 = run(dir, 'set');
    assert.notEqual(rSet1.exitCode, 0);

    const rSet2 = run(dir, 'set', ['active-task']);
    assert.notEqual(rSet2.exitCode, 0);
  });

  it('covers link-task command exceptions', () => {
    const rLink1 = run(dir, 'link-task');
    assert.notEqual(rLink1.exitCode, 0);

    const rLink2 = run(dir, 'link-task', ['TASK-999']);
    assert.notEqual(rLink2.exitCode, 0);
  });

  it('covers edge command invalid edge args', () => {
    const rEdge1 = run(dir, 'edge', ['add']);
    assert.notEqual(rEdge1.exitCode, 0);

    const rEdge2 = run(dir, 'edge', ['rm']);
    assert.notEqual(rEdge2.exitCode, 0);
    
    const rEdge3 = run(dir, 'edge', ['invalid-op']);
    assert.notEqual(rEdge3.exitCode, 0);
  });

  it('covers status.js missing argument error and blocks TASK status completed bypass (P1)', () => {
    const rStatus1 = run(dir, 'status');
    assert.notEqual(rStatus1.exitCode, 0);

    const rStatus2 = run(dir, 'status', ['TASK-001']);
    assert.notEqual(rStatus2.exitCode, 0);
    
    // 写入一个 in_progress 的 TASK-001 用于测试 P1 旁路阻断
    fs.mkdirSync(path.join(dir, '.asa/nodes/tasks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.asa/nodes/tasks/TASK-001.yaml'), 'id: TASK-001\ntitle: "TDD旁路测试"\nstatus: in_progress\nversion: 1\n');
    
    const rStatusBypass = run(dir, 'status', ['TASK-001', 'completed']);
    assert.match(rStatusBypass.output, /必须通过专用审核命令/);
    assert.notEqual(rStatusBypass.exitCode, 0);
  });

  it('verifies status TASK completed -> verified transition blocks without --by, and allows with --by (TDD 2)', () => {
    // 1. 写入一个 status 为 completed 的 TASK-002
    fs.mkdirSync(path.join(dir, '.asa/nodes/tasks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.asa/nodes/tasks/TASK-002.yaml'), 'id: TASK-002\ntitle: "TDD已完成任务"\nstatus: completed\nversion: 1\n');

    // 2. 用 status 流转完成 -> 验证 (没有 --by 参数)，断言拦截并报错
    const rNoBy = run(dir, 'status', ['TASK-002', 'verified']);
    assert.match(rNoBy.output, /缺少 --by 审计参数/);
    assert.notEqual(rNoBy.exitCode, 0);

    // 3. 用 status 流转完成 -> 验证 (带 --by 参数)，断言成功
    const rWithBy = run(dir, 'status', ['TASK-002', 'verified', '--by', 'reviewer1']);
    assert.equal(rWithBy.exitCode, 0);

    // 4. 读取节点并验证其状态已更新为 verified
    const node = readNode(dir, 'tasks', 'TASK-002');
    assert.equal(node.status, 'verified');
  });
});

// ── TDD cancelled to pending transition ──
describe('TDD cancelled to pending transition', () => {
  let dir;
  before(() => { dir = createSandbox(); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('rejects status cancelled -> pending transition without --by and keeps status cancelled', () => {
    writeNode(dir, 'tasks', 'TASK-301', {
      id: 'TASK-301',
      title: '已取消任务1',
      status: 'cancelled',
      version: 1,
      changeLog: []
    });

    const r = run(dir, 'status', ['TASK-301', 'pending']);
    assert.notEqual(r.exitCode, 0);
    assert.match(r.output, /缺少 --by 审计参数/);

    const node = readNode(dir, 'tasks', 'TASK-301');
    assert.equal(node.status, 'cancelled');
  });

  it('allows status cancelled -> pending transition with --by and writes audit record', () => {
    writeNode(dir, 'tasks', 'TASK-302', {
      id: 'TASK-302',
      title: '已取消任务2',
      status: 'cancelled',
      version: 1,
      changeLog: []
    });

    const r = run(dir, 'status', ['TASK-302', 'pending', '--by', '大鹏']);
    assert.equal(r.exitCode, 0);

    const node = readNode(dir, 'tasks', 'TASK-302');
    assert.equal(node.status, 'pending');

    // 校验 changeLog 写入了带有 {by: "大鹏", text: "从已取消状态恢复"} 的审计记录
    const auditRecord = node.changeLog.find(entry => entry.by === '大鹏' && entry.text === '从已取消状态恢复');
    assert.ok(auditRecord, '应当找到 {by: "大鹏", text: "从已取消状态恢复"} 的审计记录');
  });

  it('rejects propagate set_status: pending when target is cancelled without --by and marks failed', () => {
    writeNode(dir, 'tasks', 'TASK-303', {
      id: 'TASK-303',
      title: '已取消目标任务',
      status: 'cancelled',
      version: 1,
      changeLog: []
    });

    writeNode(dir, 'requirements', 'REQ-303', {
      id: 'REQ-303',
      title: '传播源需求',
      status: 'approved',
      version: 1,
      changeLog: [],
      pendingPropagation: [{
        changeVersion: 2,
        status: 'pending',
        affectedNodes: [{
          id: 'TASK-303',
          action: { type: 'set_status', value: 'pending' }
        }]
      }]
    });

    const r = run(dir, 'propagate', ['REQ-303']);
    assert.notEqual(r.exitCode, 0);

    // 目标状态依然保持为 cancelled 绝对不变
    const targetNode = readNode(dir, 'tasks', 'TASK-303');
    assert.equal(targetNode.status, 'cancelled');

    // changeLog 记录审计失败
    const hasAuditFail = targetNode.changeLog.some(entry => entry.summary.includes('从已取消状态恢复失败'));
    assert.ok(hasAuditFail, '目标任务的 changeLog 应当记录审计失败');

    // action 执行结果状态标记为 failed (在源节点的 pendingPropagation 表现为 partial)
    const sourceNode = readNode(dir, 'requirements', 'REQ-303');
    assert.equal(sourceNode.pendingPropagation[0].status, 'partial');
  });

  it('allows propagate set_status: pending when target is cancelled with --by and succeeds', () => {
    writeNode(dir, 'tasks', 'TASK-304', {
      id: 'TASK-304',
      title: '另一个已取消任务',
      status: 'cancelled',
      version: 1,
      changeLog: []
    });

    writeNode(dir, 'requirements', 'REQ-304', {
      id: 'REQ-304',
      title: '传播源需求2',
      status: 'approved',
      version: 1,
      changeLog: [],
      pendingPropagation: [{
        changeVersion: 2,
        status: 'pending',
        affectedNodes: [{
          id: 'TASK-304',
          action: { type: 'set_status', value: 'pending' }
        }]
      }]
    });

    const r = run(dir, 'propagate', ['REQ-304', '--by', '大鹏']);
    assert.equal(r.exitCode, 0);

    const targetNode = readNode(dir, 'tasks', 'TASK-304');
    assert.equal(targetNode.status, 'pending');

    const sourceNode = readNode(dir, 'requirements', 'REQ-304');
    assert.deepEqual(sourceNode.pendingPropagation, []); // 全部成功后清除 pendingPropagation

    const auditRecord = targetNode.changeLog.find(entry => entry.by === '大鹏' && entry.summary === '从已取消状态恢复');
    assert.ok(auditRecord, '应当找到 {by: "大鹏", summary: "从已取消状态恢复"} 的审计记录');
  });

  it('rejects propagate TASK completed to verified without --by and allows with --by', () => {
    writeNode(dir, 'tasks', 'TASK-305', {
      id: 'TASK-305',
      title: '已完成任务',
      status: 'completed',
      version: 1,
      changeLog: []
    });

    writeNode(dir, 'requirements', 'REQ-305', {
      id: 'REQ-305',
      title: '传播源需求3',
      status: 'approved',
      version: 1,
      changeLog: [],
      pendingPropagation: [{
        changeVersion: 2,
        status: 'pending',
        affectedNodes: [{
          id: 'TASK-305',
          action: { type: 'set_status', value: 'verified' }
        }]
      }]
    });

    const r1 = run(dir, 'propagate', ['REQ-305']);
    const targetNode1 = readNode(dir, 'tasks', 'TASK-305');
    assert.equal(targetNode1.status, 'completed', 'status must stay completed without --by');

    const r2 = run(dir, 'propagate', ['REQ-305', '--by', '大鹏']);
    assert.equal(r2.exitCode, 0);

    const targetNode2 = readNode(dir, 'tasks', 'TASK-305');
    assert.equal(targetNode2.status, 'verified', 'status must transition to verified with --by');
    const auditRecord = targetNode2.changeLog.find(entry => entry.by === '大鹏' && entry.summary.includes('set_status verified'));
    assert.ok(auditRecord, '应当找到带 --by 大鹏 的 verified 审计记录');
  });
});

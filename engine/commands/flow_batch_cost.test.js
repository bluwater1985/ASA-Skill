// engine/commands/flow_batch_cost.test.js — 组合命令 / 批处理 / 成本观测 / validate 去重门禁 单测
// 依赖 helpers.js 的子进程方式执行引擎（在正常环境 / CI 下运行）。
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createSandbox, run, readNode, readMatrix } = require('./helpers.js');

// 构造 batch 的 JSON 输入（execFileSync 直传 argv，无 shell 引号问题）
const batchJson = (ops) =>
  JSON.stringify({ ops });

describe('flow add —— 一次调用建需求+任务+边+排序', () => {
  let dir;
  before(() => { dir = createSandbox(); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('创建 REQ-001 与 TASK-001，任务关联需求，边 depends 立起', () => {
    const res = run(dir, 'flow', ['add', '用户登录', '实现登录接口']);
    assert.equal(res.exitCode, 0, res.output);

    const req = readNode(dir, 'requirements', 'REQ-001');
    assert.ok(req, 'REQ-001 应存在');
    assert.equal(req.title, '用户登录');

    const task = readNode(dir, 'tasks', 'TASK-001');
    assert.ok(task, 'TASK-001 应存在');
    assert.equal(task.title, '实现登录接口');
    assert.ok(task.linkedReqs.includes('REQ-001'), 'TASK 应关联 REQ');

    const matrix = readMatrix(dir);
    const edge = (matrix.edges || []).find(e => e.from === 'REQ-001' && e.to === 'TASK-001');
    assert.ok(edge, '应存在 REQ-001 → TASK-001 depends 边');
    assert.equal(edge.type || 'depends', 'depends');
  });
});

describe('flow begin —— 进阶段+激活+置 in_progress', () => {
  let dir;
  before(() => {
    dir = createSandbox();
    run(dir, 'flow', ['add', '登录', '实现登录']);
  });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('设置 phase=implementation、activeTask=TASK-001、任务 in_progress', () => {
    const res = run(dir, 'flow', ['begin', 'TASK-001']);
    assert.equal(res.exitCode, 0, res.output);

    const matrix = readMatrix(dir);
    assert.equal(matrix.meta.phase, 'implementation');
    assert.equal(matrix.meta.activeTask, 'TASK-001');
    const task = readNode(dir, 'tasks', 'TASK-001');
    assert.equal(task.status, 'in_progress');
  });
});

describe('flow ship —— 收尾一次到位 + 原子 validate', () => {
  let dir;
  before(() => {
    dir = createSandbox();
    run(dir, 'flow', ['add', '登录', '实现登录']);
    run(dir, 'flow', ['begin', 'TASK-001']);
  });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('记录文件+置 awaiting-confirmation+清除活跃任务+门禁通过', () => {
    const res = run(dir, 'flow', ['ship', 'TASK-001', 'login.js']);
    assert.equal(res.exitCode, 0, res.output);

    const task = readNode(dir, 'tasks', 'TASK-001');
    assert.equal(task.status, 'awaiting-confirmation');
    assert.ok(task.changedFiles.includes('login.js'), 'changedFiles 应包含 login.js');

    const matrix = readMatrix(dir);
    assert.equal(matrix.meta.activeTask, '(none)', '活跃任务应已清除');

    // ship 末步跑过 validate；再单独跑 validate --skip-if-fresh 应命中去重门禁（复用刚 stamp 的通过时间戳）
    const skip = run(dir, 'validate', ['--skip-if-fresh']);
    assert.equal(skip.exitCode, 0, skip.output);
    assert.ok(skip.output.includes('跳过重复校验'), skip.output);
  });
});

describe('flow sync-docs —— 编译+校验一次完成', () => {
  let dir;
  before(() => { dir = createSandbox(); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('退出码 0，docs 完成编译', () => {
    const res = run(dir, 'flow', ['sync-docs']);
    assert.equal(res.exitCode, 0, res.output);
  });
});

describe('batch —— 单进程顺序执行多条操作', () => {
  let dir;
  before(() => { dir = createSandbox(); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('一次调用完成 add-req + add-task + edge', () => {
    const ops = [
      { command: 'add-req', args: ['批量需求'] },
      { command: 'add-task', args: ['批量任务', '--req', 'REQ-001'] },
      { command: 'edge', args: ['add', 'REQ-001', 'TASK-001', '--type', 'depends'] },
    ];
    const res = run(dir, 'batch', [batchJson(ops)]);
    assert.equal(res.exitCode, 0, res.output);

    assert.ok(readNode(dir, 'requirements', 'REQ-001'), 'REQ-001 应存在');
    const task = readNode(dir, 'tasks', 'TASK-001');
    assert.ok(task, 'TASK-001 应存在');
    assert.ok(task.linkedReqs.includes('REQ-001'), 'TASK 应关联 REQ');

    const matrix = readMatrix(dir);
    assert.ok((matrix.edges || []).some(e => e.from === 'REQ-001' && e.to === 'TASK-001'), '应存在依赖边');
  });

  it('未知操作报错并失败', () => {
    const res = run(dir, 'batch', [batchJson([{ command: 'not-a-command', args: [] }])]);
    assert.notEqual(res.exitCode, 0);
  });
});

describe('cost —— 只读成本观测', () => {
  let dir;
  before(() => {
    dir = createSandbox();
    run(dir, 'flow', ['add', '登录', '实现登录']);
    run(dir, 'flow', ['begin', 'TASK-001']);
    run(dir, 'flow', ['ship', 'TASK-001', 'login.js']);
  });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('输出 JSON，写操作数 ≥ 节点数', () => {
    const res = run(dir, 'cost', ['--json']);
    assert.equal(res.exitCode, 0, res.output);
    const lines = res.output.split('\n').filter(Boolean);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.mode, 'estimate');
    assert.ok(parsed.nodeWriteOps >= 2, `nodeWriteOps 应>=2，实际 ${parsed.nodeWriteOps}`);
    assert.ok(parsed.estimateModelCalls >= parsed.nodeWriteOps);
  });
});

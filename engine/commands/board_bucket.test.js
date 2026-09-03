// engine/commands/board_bucket.test.js — 分桶查看层：compile 分组 / list 分桶 / board 看板 / getBucket 口径
// 目标：把「未完成任务」与「已完成/已归档」分开，让人集中注意力到未完成。
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createSandbox, run, writeNode } = require('./helpers.js');
const { getBucket } = require('../lib/state-machine.js');

describe('getBucket 唯一口径', () => {
  it('TASK: 未完成四态 → active', () => {
    for (const s of ['pending', 'in_progress', 'blocked', 'awaiting-confirmation']) {
      assert.equal(getBucket('TASK', s), 'active');
    }
  });
  it('TASK: completed/verified → done; cancelled → archived', () => {
    assert.equal(getBucket('TASK', 'completed'), 'done');
    assert.equal(getBucket('TASK', 'verified'), 'done');
    assert.equal(getBucket('TASK', 'cancelled'), 'archived');
  });
  it('REQ / ISSUE 语义正确', () => {
    assert.equal(getBucket('REQ', 'approved'), 'active');
    assert.equal(getBucket('REQ', 'implemented'), 'done');
    assert.equal(getBucket('REQ', 'deprecated'), 'archived');
    assert.equal(getBucket('ISSUE', 'resolved'), 'done');
    assert.equal(getBucket('ISSUE', 'wontfix'), 'archived');
  });
  it('未知状态默认 active（宁多勿藏）', () => {
    assert.equal(getBucket('TASK', 'mystery'), 'active');
    assert.equal(getBucket('TASK', undefined), 'active');
    assert.equal(getBucket('BOGUS', 'x'), 'active');
  });
});

function seed(dir) {
  writeNode(dir, 'requirements', 'REQ-001', { id: 'REQ-001', title: '需求1', status: 'approved', priority: 'P1', version: 1 });
  writeNode(dir, 'tasks', 'TASK-001', { id: 'TASK-001', title: '做A', status: 'pending', version: 1, linkedReqs: ['REQ-001'] });
  writeNode(dir, 'tasks', 'TASK-002', { id: 'TASK-002', title: '做B', status: 'in_progress', version: 1 });
  writeNode(dir, 'tasks', 'TASK-003', { id: 'TASK-003', title: '做C', status: 'blocked', version: 1 });
  writeNode(dir, 'tasks', 'TASK-004', { id: 'TASK-004', title: '完D', status: 'completed', version: 1 });
  writeNode(dir, 'tasks', 'TASK-005', { id: 'TASK-005', title: '验E', status: 'verified', version: 1 });
  writeNode(dir, 'tasks', 'TASK-006', { id: 'TASK-006', title: '取F', status: 'cancelled', version: 1 });
}

describe('list-task 分桶', () => {
  let dir;
  before(() => { dir = createSandbox(); seed(dir); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('默认只列未完成(active)，done/archived 不显示', () => {
    const r = run(dir, 'list-task');
    assert.match(r.output, /做A/); assert.match(r.output, /做B/); assert.match(r.output, /做C/);
    assert.ok(!r.output.includes('完D'), 'completed 不应出现');
    assert.ok(!r.output.includes('取F'), 'cancelled 不应出现');
    assert.match(r.output, /未完成 3/);
  });
  it('--done 只列已完成', () => {
    const r = run(dir, 'list-task', ['--done']);
    assert.match(r.output, /完D/); assert.match(r.output, /验E/);
    assert.ok(!r.output.includes('做A'));
  });
  it('--all 列出全部含归档', () => {
    const r = run(dir, 'list-task', ['--all']);
    assert.match(r.output, /取F/);
  });
});

describe('board 看板', () => {
  let dir;
  before(() => { dir = createSandbox(); seed(dir); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('只展示未完成，按状态分组，计入 done/archived 计数', () => {
    const r = run(dir, 'board');
    assert.match(r.output, /聚焦看板/);
    assert.match(r.output, /⏳ 待办/); assert.match(r.output, /🔨 进行中/); assert.match(r.output, /⛔ 阻塞/);
    assert.match(r.output, /做A/); assert.match(r.output, /做C/);
    assert.ok(!r.output.includes('完D'), 'done 不应出现在看板');
    assert.match(r.output, /未完成 3 · 已完成 2 · 已归档 1/);
  });
});

describe('compile 分组归档 + 幂等', () => {
  let dir;
  before(() => { dir = createSandbox(); seed(dir); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('docs/03-tasks.md 分两区，done 沉底，archived 不渲染', () => {
    run(dir, 'compile');
    const doc = fs.readFileSync(path.join(dir, 'docs/03-tasks.md'), 'utf-8');
    assert.match(doc, /ASA-BUCKET: active/);
    assert.match(doc, /## 🟢 未完成任务/);
    assert.match(doc, /## ✅ 已完成任务/);
    assert.match(doc, /未完成 3 · 已完成 2 · 已归档 1/);
    const act = doc.indexOf('🟢 未完成'), done = doc.indexOf('✅ 已完成');
    assert.ok(act >= 0 && done > act, '未完成区应排在已完成区之前');
    assert.ok(!doc.includes('TASK-006'), 'cancelled 节点不应渲染进主文件');
  });

  it('连续 compile 幂等（不抖动）', () => {
    run(dir, 'compile');
    const a = fs.readFileSync(path.join(dir, 'docs/03-tasks.md'), 'utf-8');
    run(dir, 'compile');
    const b = fs.readFileSync(path.join(dir, 'docs/03-tasks.md'), 'utf-8');
    assert.equal(a, b);
  });

  it('手写批注跨分区存活', () => {
    run(dir, 'compile');
    const p = path.join(dir, 'docs/03-tasks.md');
    const doc = fs.readFileSync(p, 'utf-8');
    const note = '[ASA] 手写批注优先跟进';
    fs.writeFileSync(p, doc.replace('<!-- ASA-NODE: TASK-003 -->', `${note}\n\n<!-- ASA-NODE: TASK-003 -->`));
    run(dir, 'compile');
    const after = fs.readFileSync(p, 'utf-8');
    assert.ok(after.includes(note), '批注应存活');
  });
});

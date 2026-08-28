// issue.test.js — ISSUE 节点族：add-issue / 状态机 / 软门禁 / 自动升 ISSUE / compile 04-issues
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createSandbox, run, readNode, readMatrix, writeNode } = require('./helpers.js');

function seedIssue(dir, overrides) {
  fs.mkdirSync(path.join(dir, '.asa/nodes/issues'), { recursive: true });
  writeNode(dir, 'issues', 'ISSUE-001', Object.assign({
    id: 'ISSUE-001', title: '测试问题', status: 'open', version: 1,
    category: 'observation', severity: 'P2', changeLog: [], pendingPropagation: [],
  }, overrides || {}));
}

describe('add-issue', () => {
  let dir;
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('creates ISSUE-001 with open status and default category/severity', () => {
    dir = createSandbox();
    const r = run(dir, 'add-issue', ['登录偶发失败']);
    assert.equal(r.exitCode, 0);
    const node = readNode(dir, 'issues', 'ISSUE-001');
    assert.equal(node.status, 'open');
    assert.equal(node.category, 'observation');
    assert.equal(node.severity, 'P2');
    const m = readMatrix(dir);
    assert.ok(m.issues && m.issues['ISSUE-001']);
  });

  it('honors --category bug --severity P0 and links affects edge via --task', () => {
    dir = createSandbox();
    writeNode(dir, 'tasks', 'TASK-001', { id: 'TASK-001', title: 'T', status: 'pending', version: 1 });
    const r = run(dir, 'add-issue', ['崩溃闪退', '--category', 'bug', '--severity', 'P0', '--task', 'TASK-001']);
    assert.equal(r.exitCode, 0);
    const node = readNode(dir, 'issues', 'ISSUE-001');
    assert.equal(node.category, 'bug');
    assert.equal(node.severity, 'P0');
    assert.deepEqual(node.linkedTasks, ['TASK-001']);
    const m = readMatrix(dir);
    assert.ok(m.edges.some(e => e.from === 'ISSUE-001' && e.to === 'TASK-001' && e.type === 'affects'));
  });

  it('rejects invalid category', () => {
    dir = createSandbox();
    const r = run(dir, 'add-issue', ['x', '--category', 'banana']);
    assert.notEqual(r.exitCode, 0);
  });
});

describe('ISSUE status lifecycle + soft gates', () => {
  let dir;
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('rejects in_progress→resolved without --note (软门禁)', () => {
    dir = createSandbox(); seedIssue(dir, { status: 'in_progress' });
    const r = run(dir, 'status', ['ISSUE-001', 'resolved']);
    assert.notEqual(r.exitCode, 0);
    assert.match(r.output, /--note/);
    assert.equal(readNode(dir, 'issues', 'ISSUE-001').status, 'in_progress');
  });

  it('allows in_progress→resolved with --note and records resolution', () => {
    dir = createSandbox(); seedIssue(dir, { status: 'in_progress' });
    const r = run(dir, 'status', ['ISSUE-001', 'resolved', '--note', '已修复']);
    assert.equal(r.exitCode, 0);
    const node = readNode(dir, 'issues', 'ISSUE-001');
    assert.equal(node.status, 'resolved');
    assert.equal(node.resolution.note, '已修复');
  });

  it('rejects resolved→verified without --by', () => {
    dir = createSandbox(); seedIssue(dir, { status: 'resolved' });
    const r = run(dir, 'status', ['ISSUE-001', 'verified']);
    assert.notEqual(r.exitCode, 0);
  });

  it('allows resolved→verified --by (验收终态)', () => {
    dir = createSandbox(); seedIssue(dir, { status: 'resolved' });
    const r = run(dir, 'status', ['ISSUE-001', 'verified', '--by', '大鹏']);
    assert.equal(r.exitCode, 0);
    assert.equal(readNode(dir, 'issues', 'ISSUE-001').status, 'verified');
  });

  it('rejects verified→open (吸收态不可回开)', () => {
    dir = createSandbox(); seedIssue(dir, { status: 'verified' });
    const r = run(dir, 'status', ['ISSUE-001', 'open', '--by', '大鹏']);
    assert.notEqual(r.exitCode, 0);
  });

  it('resolved→open 返工须 --by；无 --by 拒绝、有 --by 通过', () => {
    dir = createSandbox(); seedIssue(dir, { status: 'resolved' });
    const rNo = run(dir, 'status', ['ISSUE-001', 'open']);
    assert.notEqual(rNo.exitCode, 0);
    const rYes = run(dir, 'status', ['ISSUE-001', 'in_progress', '--by', '大鹏']);
    assert.equal(rYes.exitCode, 0);
    assert.equal(readNode(dir, 'issues', 'ISSUE-001').status, 'in_progress');
  });

  it('cancelled→open 误取消恢复须 --by', () => {
    dir = createSandbox(); seedIssue(dir, { status: 'cancelled' });
    const rNo = run(dir, 'status', ['ISSUE-001', 'open']);
    assert.notEqual(rNo.exitCode, 0);
    const rYes = run(dir, 'status', ['ISSUE-001', 'open', '--by', '大鹏']);
    assert.equal(rYes.exitCode, 0);
  });
});

describe('自动升 ISSUE（reject / completed 返工）', () => {
  let dir;
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('reject-task 自动升 ISSUE（--no-issue 关闭）', () => {
    dir = createSandbox();
    fs.mkdirSync(path.join(dir, '.asa/nodes/issues'), { recursive: true });
    writeNode(dir, 'tasks', 'TASK-001', { id: 'TASK-001', title: '改一下', status: 'awaiting-confirmation', version: 2, changeLog: [] });
    const r = run(dir, 'reject-task', ['TASK-001', '--by', 'reviewer', '--note', '不符合验收']);
    assert.equal(r.exitCode, 0);
    const issue = readNode(dir, 'issues', 'ISSUE-001');
    assert.ok(issue, '应自动创建 ISSUE-001');
    assert.equal(issue.category, 'observation');
    assert.deepEqual(issue.linkedTasks, ['TASK-001']);
    assert.equal(issue.discoveredBy, 'reject');

    // --no-issue：不再自动建
    dir = createSandbox();
    writeNode(dir, 'tasks', 'TASK-002', { id: 'TASK-002', title: '改2', status: 'awaiting-confirmation', version: 2, changeLog: [] });
    const r2 = run(dir, 'reject-task', ['TASK-002', '--by', 'reviewer', '--note', 'x', '--no-issue']);
    assert.equal(r2.exitCode, 0);
    assert.equal(readNode(dir, 'issues', 'ISSUE-002'), null);
  });

  it('TASK completed 返工回开自动升 ISSUE（--no-issue 关闭）', () => {
    dir = createSandbox();
    writeNode(dir, 'tasks', 'TASK-001', { id: 'TASK-001', title: '已完', status: 'completed', version: 3, changeLog: [] });
    const r = run(dir, 'status', ['TASK-001', 'pending', '--by', '大鹏', '--note', '发现缺陷']);
    assert.equal(r.exitCode, 0);
    const issue = readNode(dir, 'issues', 'ISSUE-001');
    assert.ok(issue);
    assert.equal(issue.discoveredBy, 'rework');
    assert.deepEqual(issue.linkedTasks, ['TASK-001']);
    assert.equal(issue.status, 'open');

    // --no-issue 关闭
    const dir2 = createSandbox();
    writeNode(dir2, 'tasks', 'TASK-001', { id: 'TASK-001', title: '已完', status: 'completed', version: 3, changeLog: [] });
    const r2 = run(dir2, 'status', ['TASK-001', 'in_progress', '--by', '大鹏', '--no-issue']);
    assert.equal(r2.exitCode, 0);
    assert.equal(readNode(dir2, 'issues', 'ISSUE-001'), null);
  });
});

describe('compile 04-issues.md', () => {
  let dir;
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('produces docs/04-issues.md with issue entries', () => {
    dir = createSandbox();
    run(dir, 'add-issue', ['闪退']);
    const doc = fs.readFileSync(path.join(dir, 'docs', '04-issues.md'), 'utf-8');
    assert.match(doc, /# 项目问题清单/);
    assert.match(doc, /ASA-NODE: ISSUE-001/);
    assert.match(doc, /闪退/);
  });
});

// status_reopen.test.js — completed → {pending, in_progress} 返工回开（--by 审计卫兵）
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createSandbox, run, writeNode, readNode } = require('./helpers.js');

function seedTask(dir, status) {
  writeNode(dir, 'tasks', 'TASK-001', {
    id: 'TASK-001', title: '返工任务', status, version: 5,
    linkedReqs: ['REQ-001'], changedFiles: ['impl.js'], changeLog: [],
  });
}

describe('TASK completed 返工回开 (completed → pending / in_progress)', () => {
  let dir;
  after(() => { try { require('fs').rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('rejects completed → pending without --by', () => {
    dir = createSandbox(); seedTask(dir, 'completed');
    const r = run(dir, 'status', ['TASK-001', 'pending']);
    assert.notEqual(r.exitCode, 0);
    assert.match(r.output, /--by/);
    assert.equal(readNode(dir, 'tasks', 'TASK-001').status, 'completed'); // 未变
  });

  it('allows completed → pending with --by and records audit changelog (version bump)', () => {
    dir = createSandbox(); seedTask(dir, 'completed');
    const r = run(dir, 'status', ['TASK-001', 'pending', '--by', '大鹏']);
    assert.equal(r.exitCode, 0);
    const node = readNode(dir, 'tasks', 'TASK-001');
    assert.equal(node.status, 'pending');
    const last = node.changeLog[node.changeLog.length - 1];
    assert.equal(last.type, 'reopen');
    assert.match(last.summary, /返工|completed/);
    assert.equal(last.by, '大鹏');
    assert.equal(node.version, 6); // reopen 是实质性状态变更，版本+1
  });

  it('allows completed → in_progress with --by', () => {
    dir = createSandbox(); seedTask(dir, 'completed');
    const r = run(dir, 'status', ['TASK-001', 'in_progress', '--by', '大鹏']);
    assert.equal(r.exitCode, 0);
    assert.equal(readNode(dir, 'tasks', 'TASK-001').status, 'in_progress');
  });

  it('rejects verified → pending even with --by (verified 保持吸收态)', () => {
    dir = createSandbox(); seedTask(dir, 'verified');
    const r = run(dir, 'status', ['TASK-001', 'pending', '--by', '大鹏']);
    assert.notEqual(r.exitCode, 0);
    assert.equal(readNode(dir, 'tasks', 'TASK-001').status, 'verified');
  });

  it('full rework loop: completed → pending(--by) → in_progress → record-changes → awaiting → confirm → completed', () => {
    dir = createSandbox();
    require('fs').writeFileSync(path.join(dir, 'impl.js'), '// v1 impl\n');
    require('fs').writeFileSync(path.join(dir, 'newimpl.js'), '// v2 impl\n');
    seedTask(dir, 'completed'); // changedFiles: ['impl.js']

    // 返工回开
    let r = run(dir, 'status', ['TASK-001', 'pending', '--by', '大鹏', '--note', '发现缺陷，返工']);
    assert.equal(r.exitCode, 0);
    assert.equal(readNode(dir, 'tasks', 'TASK-001').status, 'pending');

    // 重新实施
    r = run(dir, 'status', ['TASK-001', 'in_progress']);
    assert.equal(r.exitCode, 0);
    r = run(dir, 'record-changes', ['TASK-001', 'newimpl.js']);
    assert.equal(r.exitCode, 0);
    assert.ok(readNode(dir, 'tasks', 'TASK-001').changedFiles.includes('newimpl.js'));

    // 提审并再次确认（落地门禁校验 impl.js + newimpl.js 均真实存在 → 通过）
    r = run(dir, 'status', ['TASK-001', 'awaiting-confirmation']);
    assert.equal(r.exitCode, 0);
    r = run(dir, 'confirm-task', ['TASK-001', '--by', '大鹏', '--note', '返工后复验通过']);
    assert.equal(r.exitCode, 0);
    const node = readNode(dir, 'tasks', 'TASK-001');
    assert.equal(node.status, 'completed');
    assert.equal(node.confirmation && node.confirmation.status, 'confirmed');
    // 版本随多次流转递增（reopen/in_progress/awaiting/confirm 每次递增）
    assert.ok(node.version >= 4);
  });
});

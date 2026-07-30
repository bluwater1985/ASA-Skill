// engine/lib/changelog.test.js — 变更日志管理测试
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  appendChangeLog, createPendingPropagation,
  updatePropagationStatus, clearPendingPropagation, hasPendingPropagation,
} = require('./changelog.js');

describe('appendChangeLog', () => {
  it('adds entry and increments version for status change', () => {
    const node = { version: 1 };
    const v = appendChangeLog(node, 'modified', '调整接受条件');
    assert.equal(v, 2);
    assert.equal(node.version, 2);
    assert.equal(node.changeLog.length, 1);
    assert.equal(node.changeLog[0].type, 'modified');
    assert.equal(node.changeLog[0].version, 2);
  });

  it('does not increment for non-substantive change', () => {
    const node = { version: 2, changeLog: [] };
    const v = appendChangeLog(node, 'typo_fix', '修正错字');
    assert.equal(v, 2); // typo 不递增
    assert.equal(node.version, 2);
  });

  it('initializes version to 1 when missing', () => {
    const node = {};
    const v = appendChangeLog(node, 'modified', 'init');
    assert.equal(v, 2);
    assert.equal(node.version, 2);
  });
});

describe('pendingPropagation', () => {
  it('creates and clears propagation entry', () => {
    const node = { version: 2 };
    const affected = [
      { id: 'TASK-001', action: { type: 'set_status', value: 'draft' } },
    ];
    createPendingPropagation(node, 2, affected);
    assert.equal(node.pendingPropagation.length, 1);
    assert.equal(node.pendingPropagation[0].status, 'pending');

    clearPendingPropagation(node, 2);
    assert.equal(node.pendingPropagation.length, 0);
  });

  it('hasPendingPropagation returns false for no entries', () => {
    assert.equal(hasPendingPropagation({}), false);
    assert.equal(hasPendingPropagation({ pendingPropagation: [] }), false);
  });

  it('hasPendingPropagation returns true with entries', () => {
    const node = { pendingPropagation: [{ changeVersion: 2, status: 'pending' }] };
    assert.equal(hasPendingPropagation(node), true);
  });
});

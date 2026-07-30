// engine/lib/state-machine.test.js — 状态机测试
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateTransition, getAllowedTransitions } = require('./state-machine.js');

describe('REQ state machine', () => {
  it('allows proposed → approved', () => {
    const r = validateTransition('REQ-001', 'proposed', 'approved');
    assert.equal(r.valid, true);
  });

  it('allows proposed → rejected', () => {
    const r = validateTransition('REQ-001', 'proposed', 'rejected');
    assert.equal(r.valid, true);
  });

  it('allows approved → modified', () => {
    const r = validateTransition('REQ-001', 'approved', 'modified');
    assert.equal(r.valid, true);
  });

  it('rejects pending → verified (direct jump)', () => {
    const r = validateTransition('REQ-001', 'pending', 'verified');
    assert.equal(r.valid, false);
  });

  it('rejects completed → in_progress', () => {
    const r = validateTransition('REQ-001', 'completed', 'in_progress');
    assert.equal(r.valid, false);
  });
});

describe('ARCH state machine', () => {
  it('allows draft → reviewed', () => {
    assert.equal(validateTransition('ARCH-001', 'draft', 'reviewed').valid, true);
  });

  it('allows approved → draft (reopen)', () => {
    assert.equal(validateTransition('ARCH-001', 'approved', 'draft').valid, true);
  });
});

describe('TASK state machine', () => {
  it('allows pending → in_progress', () => {
    assert.equal(validateTransition('TASK-001', 'pending', 'in_progress').valid, true);
  });

  it('allows in_progress → cancelled (for deprecate)', () => {
    const r = validateTransition('TASK-001', 'in_progress', 'cancelled');
    assert.equal(r.valid, true);
  });

  it('allows cancelled → pending (restore)', () => {
    const r = validateTransition('TASK-001', 'cancelled', 'pending');
    assert.equal(r.valid, true);
  });

  it('rejects pending → verified', () => {
    assert.equal(validateTransition('TASK-001', 'pending', 'verified').valid, false);
  });
});

describe('getAllowedTransitions', () => {
  it('returns correct options for REQ proposed', () => {
    const opts = getAllowedTransitions('REQ-001', 'proposed');
    assert.deepEqual(opts, ['approved', 'rejected']);
  });

  it('returns empty for terminal state', () => {
    assert.deepEqual(getAllowedTransitions('REQ-001', 'deprecated'), []);
  });
});

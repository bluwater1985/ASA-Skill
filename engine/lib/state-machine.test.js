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

  it('allows proposed → deprecated', () => {
    const r = validateTransition('REQ-001', 'proposed', 'deprecated');
    assert.equal(r.valid, true);
  });

  it('allows modified → deprecated', () => {
    const r = validateTransition('REQ-001', 'modified', 'deprecated');
    assert.equal(r.valid, true);
  });

  it('allows rejected → proposed (resubmit)', () => {
    const r = validateTransition('REQ-001', 'rejected', 'proposed');
    assert.equal(r.valid, true);
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

  it('allows draft → superseded (deprecate)', () => {
    assert.equal(validateTransition('ARCH-001', 'draft', 'superseded').valid, true);
  });

  it('allows reviewed → superseded (deprecate)', () => {
    assert.equal(validateTransition('ARCH-001', 'reviewed', 'superseded').valid, true);
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

  it('allows in_progress → awaiting-confirmation', () => {
    assert.equal(validateTransition('TASK-001', 'in_progress', 'awaiting-confirmation').valid, true);
  });

  it('allows awaiting-confirmation → completed', () => {
    assert.equal(validateTransition('TASK-001', 'awaiting-confirmation', 'completed').valid, true);
  });

  it('allows awaiting-confirmation → in_progress', () => {
    assert.equal(validateTransition('TASK-001', 'awaiting-confirmation', 'in_progress').valid, true);
  });

  it('allows awaiting-confirmation → cancelled', () => {
    assert.equal(validateTransition('TASK-001', 'awaiting-confirmation', 'cancelled').valid, true);
  });

  it('rejects pending → awaiting-confirmation', () => {
    assert.equal(validateTransition('TASK-001', 'pending', 'awaiting-confirmation').valid, false);
  });

  it('allows completed → pending (返工 reopen)', () => {
    assert.equal(validateTransition('TASK-001', 'completed', 'pending').valid, true);
  });

  it('allows completed → in_progress (返工 reopen)', () => {
    assert.equal(validateTransition('TASK-001', 'completed', 'in_progress').valid, true);
  });

  it('still allows completed → verified', () => {
    assert.equal(validateTransition('TASK-001', 'completed', 'verified').valid, true);
  });

  it('rejects completed → blocked (reopen 仅限返工目标)', () => {
    assert.equal(validateTransition('TASK-001', 'completed', 'blocked').valid, false);
  });

  it('rejects verified → pending (verified 保持吸收态)', () => {
    assert.equal(validateTransition('TASK-001', 'verified', 'pending').valid, false);
  });
});

describe('getAllowedTransitions', () => {
  it('returns correct options for REQ proposed', () => {
    const opts = getAllowedTransitions('REQ-001', 'proposed');
    assert.deepEqual(opts, ['approved', 'rejected', 'deprecated']);
  });

  it('returns empty for terminal state', () => {
    assert.deepEqual(getAllowedTransitions('REQ-001', 'deprecated'), []);
  });

  it('returns verified/pending/in_progress for TASK completed (rework)', () => {
    assert.deepEqual(getAllowedTransitions('TASK-001', 'completed'), ['verified', 'pending', 'in_progress']);
  });
});

describe('ISSUE state machine', () => {
  it('allows open → triaged', () => {
    assert.equal(validateTransition('ISSUE-001', 'open', 'triaged').valid, true);
  });

  it('allows open → wontfix / cancelled', () => {
    assert.equal(validateTransition('ISSUE-001', 'open', 'wontfix').valid, true);
    assert.equal(validateTransition('ISSUE-001', 'open', 'cancelled').valid, true);
  });

  it('rejects open → resolved (必须先 triaged/in_progress)', () => {
    assert.equal(validateTransition('ISSUE-001', 'open', 'resolved').valid, false);
  });

  it('rejects open → verified (跳过全链路)', () => {
    assert.equal(validateTransition('ISSUE-001', 'open', 'verified').valid, false);
  });

  it('allows triaged → in_progress', () => {
    assert.equal(validateTransition('ISSUE-001', 'triaged', 'in_progress').valid, true);
  });

  it('allows in_progress → resolved / blocked', () => {
    assert.equal(validateTransition('ISSUE-001', 'in_progress', 'resolved').valid, true);
    assert.equal(validateTransition('ISSUE-001', 'in_progress', 'blocked').valid, true);
  });

  it('allows resolved → verified (验收终态)', () => {
    assert.equal(validateTransition('ISSUE-001', 'resolved', 'verified').valid, true);
  });

  it('allows resolved → open / in_progress (返工回开，对齐 TASK completed)', () => {
    assert.equal(validateTransition('ISSUE-001', 'resolved', 'open').valid, true);
    assert.equal(validateTransition('ISSUE-001', 'resolved', 'in_progress').valid, true);
  });

  it('rejects verified → open (verified 吸收态不可回开)', () => {
    assert.equal(validateTransition('ISSUE-001', 'verified', 'open').valid, false);
  });

  it('rejects wontfix → any (吸收态)', () => {
    assert.equal(validateTransition('ISSUE-001', 'wontfix', 'open').valid, false);
  });

  it('allows cancelled → open (误取消可恢复)', () => {
    assert.equal(validateTransition('ISSUE-001', 'cancelled', 'open').valid, true);
  });

  it('getAllowedTransitions(ISSUE resolved) = verified/open/in_progress', () => {
    assert.deepEqual(getAllowedTransitions('ISSUE-001', 'resolved'), ['verified', 'open', 'in_progress']);
  });
});

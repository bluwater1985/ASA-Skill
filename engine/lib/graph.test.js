// engine/lib/graph.test.js — 图遍历测试
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { bfsForward, bfsReverse, wouldCreateCycle } = require('./graph.js');

const sampleEdges = [
  { from: 'REQ-001', to: 'ARCH-001', type: 'depends' },
  { from: 'REQ-001', to: 'REQ-002', type: 'depends' },
  { from: 'ARCH-001', to: 'TASK-001', type: 'refines' },
  { from: 'ARCH-001', to: 'TASK-002', type: 'refines' },
  { from: 'REQ-002', to: 'ARCH-002', type: 'depends' },
];

describe('bfsForward', () => {
  it('finds all downstream nodes', () => {
    const result = bfsForward(sampleEdges, 'REQ-001');
    const ids = result.map(n => n.id);
    assert.ok(ids.includes('ARCH-001'));
    assert.ok(ids.includes('REQ-002'));
    assert.ok(ids.includes('TASK-001'));
    assert.ok(ids.includes('TASK-002'));
    assert.ok(ids.includes('ARCH-002'));
    assert.equal(result.length, 5);
  });

  it('returns empty for leaf node', () => {
    const result = bfsForward(sampleEdges, 'TASK-001');
    assert.equal(result.length, 0);
  });

  it('handles empty edges', () => {
    const result = bfsForward([], 'REQ-001');
    assert.deepEqual(result, []);
  });
});

describe('bfsReverse', () => {
  it('finds all upstream nodes', () => {
    const result = bfsReverse(sampleEdges, 'TASK-001');
    const ids = result.map(n => n.id);
    assert.ok(ids.includes('ARCH-001'));
    assert.ok(ids.includes('REQ-001'));
    assert.equal(ids.includes('REQ-002'), false); // REQ-002 是下游, 非上游
  });
});

describe('wouldCreateCycle', () => {
  it('detects cycle in linear chain', () => {
    const edges = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
    ];
    assert.equal(wouldCreateCycle(edges, 'C', 'A'), true);
  });

  it('allows safe edge', () => {
    const edges = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
    ];
    assert.equal(wouldCreateCycle(edges, 'A', 'D'), false);
  });

  it('handles self-loop', () => {
    assert.equal(wouldCreateCycle([], 'A', 'A'), true);
  });
});

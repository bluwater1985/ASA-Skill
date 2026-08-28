// engine/commands/step4.test.js — Step 4 确定性检索与查重拦截集成测试
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createSandbox, run, readNode } = require('./helpers.js');

describe('Step 4 — Similarity & Search & List & Intercept', () => {
  let dir;
  before(() => { dir = createSandbox(); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('allows adding a requirement first', () => {
    const res = run(dir, 'add-req', ['编写自动化测试用例']);
    assert.match(res.output, /REQ-001 已创建/);
  });

  it('intercepts highly similar requirement (similarity > 0.9)', () => {
    // 再次添加几乎一样的需求：'编写自动化测试用例！' (符号差异不影响 similarity)
    const res = run(dir, 'add-req', ['编写自动化测试用例！']);
    assert.match(res.output, /发现相似度极高的存量需求/);
    assert.equal(res.exitCode, 1);
  });

  it('allows similar requirement addition if escape parameter is provided', () => {
    const res = run(dir, 'add-req', ['编写自动化测试用例！', '--allow-similar', 'REQ-001', '--reason', '为了细化特定场景的测试', '--by', 'tester']);
    assert.match(res.output, /REQ-002 已创建/);

    const node = readNode(dir, 'requirements', 'REQ-002');
    assert.ok(node.allowSimilar);
    assert.equal(node.allowSimilar.id, 'REQ-001');
    assert.equal(node.allowSimilar.reason, '为了细化特定场景的测试');
  });

  it('supports search-req command', () => {
    const res = run(dir, 'search-req', ['自动化测试']);
    assert.match(res.output, /模糊检索结果/);
    assert.match(res.output, /REQ-001/);
  });

  it('supports list-req / list-arch / list-task commands', () => {
    const listReq = run(dir, 'list-req');
    assert.match(listReq.output, /需求 列表/);
    assert.match(listReq.output, /REQ-001/);

    const listArch = run(dir, 'list-arch');
    assert.match(listArch.output, /列表为空/);

    const listTask = run(dir, 'list-task');
    assert.match(listTask.output, /列表为空/);
  });
});

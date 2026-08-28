// confirm_gate.test.js — confirm-task「实现落地门禁」(D2)
//   D2 定义：changedFiles 非空 + 每个路径在工作树真实存在。
//   豁免：--allow-no-files "<理由>" 显式放行并留痕（防误伤非代码交付）。
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createSandbox, writeNode, readNode } = require('./helpers.js');

// 捕获 stdout/stderr，并把 process.exit 记录为 exitCode 后中断（不杀死测试进程）
function capture(runFn) {
  const logs = [];
  const errs = [];
  let exitCode = 0;
  const origLog = console.log;
  const origErr = console.error;
  const origExit = process.exit;
  console.log = (m) => logs.push(String(m));
  console.error = (m) => errs.push(String(m));
  process.exit = (code) => { exitCode = code; throw new Error('__PROCESS_EXIT__'); };
  try {
    runFn();
  } catch (e) {
    if (!String(e && e.message).includes('__PROCESS_EXIT__')) throw e;
  } finally {
    console.log = origLog;
    console.error = origErr;
    process.exit = origExit;
  }
  return { exitCode, err: errs.join('\n'), all: logs.join('\n') + '\n' + errs.join('\n') };
}

describe('confirm-task 实现落地门禁 (D2)', () => {
  let dir;
  function seed(node) {
    dir = createSandbox();
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/app.js'), 'export {};\n'); // 真实存在的实施文件
    const base = {
      id: 'TASK-001', title: '实施 A', status: 'awaiting-confirmation',
      linkedReqs: ['REQ-001'], changedFiles: ['src/app.js'], changeLog: [],
    };
    writeNode(dir, 'tasks', 'TASK-001', Object.assign(base, node || {}));
  }
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('拒绝：changedFiles 为空且无豁免，保持 awaiting-confirmation', () => {
    seed({ changedFiles: [] });
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const r = capture(() => require('./confirm.js').run(['TASK-001', '--by', '大鹏']));
      assert.equal(r.exitCode, 1);
      assert.match(r.err, /changedFiles|变更文件/);
      assert.equal(readNode(dir, 'tasks', 'TASK-001').status, 'awaiting-confirmation');
    } finally { process.chdir(prev); }
  });

  it('拒绝：changedFiles 指向不存在的文件，保持 awaiting-confirmation', () => {
    seed({ changedFiles: ['src/ghost.ts'] });
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const r = capture(() => require('./confirm.js').run(['TASK-001', '--by', '大鹏']));
      assert.equal(r.exitCode, 1);
      assert.match(r.err, /不存在/);
      assert.equal(readNode(dir, 'tasks', 'TASK-001').status, 'awaiting-confirmation');
    } finally { process.chdir(prev); }
  });

  it('通过：changedFiles 指向存在文件 → completed', () => {
    seed({});
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const r = capture(() => require('./confirm.js').run(['TASK-001', '--by', '大鹏']));
      assert.equal(r.exitCode, 0);
      assert.equal(readNode(dir, 'tasks', 'TASK-001').status, 'completed');
    } finally { process.chdir(prev); }
  });

  it('通过：空 changedFiles + --allow-no-files 豁免并留痕 overrideReason', () => {
    seed({ changedFiles: [] });
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const r = capture(() => require('./confirm.js').run(['TASK-001', '--by', '大鹏', '--allow-no-files', '纯文档交付']));
      assert.equal(r.exitCode, 0);
      const node = readNode(dir, 'tasks', 'TASK-001');
      assert.equal(node.status, 'completed');
      assert.equal(node.confirmation && node.confirmation.overrideReason, '纯文档交付');
    } finally { process.chdir(prev); }
  });

  it('幂等：已 completed 不改动', () => {
    seed({ status: 'completed', changedFiles: [] });
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const r = capture(() => require('./confirm.js').run(['TASK-001', '--by', '大鹏']));
      assert.equal(r.exitCode, 0);
      assert.match(r.all, /已是 completed/);
    } finally { process.chdir(prev); }
  });
});

// engine/commands/add_fidelity.test.js
// 覆盖 to-spec / to-tickets 忠实落盘（Layer B + D）：add-req --spec 逐字落盘、AC 解析、
// 已有节点不被覆盖、add-task 全量字段一次写入。
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createSandbox } = require('./helpers.js');
const { run } = require('./add.js');
const { parseAsaYaml } = require('../lib/yaml.js');

let dir;
let specs;
let prevCwd;

before(() => {
  prevCwd = process.cwd();
  dir = createSandbox();
  process.chdir(dir);
  specs = path.join(dir, '.asa/specs');
  fs.mkdirSync(specs, { recursive: true });
});
after(() => process.chdir(prevCwd));

describe('add-req --spec 忠实落盘 (Layer D)', () => {
  it('正文逐字写入 spec，AC 章节逐字解析为 acceptanceCriteria，并归档源文件', () => {
    const src = path.join(specs, 'req-src.md');
    fs.writeFileSync(src, [
      '## Problem Statement',
      '高频交互时重绘竞争剧烈。这是',
      '要保留的完整痛点描述。',
      '',
      '## Solution',
      '1. onDraw 桥接 rAF 锁帧（保留1）',
      '3. shape_type 作为矢量标量传参（保留3）',
      '',
      '## Further Notes',
      '- 详细备注内容A',
      '- 详细备注内容B',
      '',
      '## Acceptance Criteria',
      '- 拖拽缩放测量在16.6ms内最多执行一次',
      '- 重绘热路径0次新堆分配与0次深拷贝',
      ''
    ].join('\n'), 'utf-8');

    run('req', ['VSync硬件帧合并', '--spec', src, '--priority', 'P1', '--by', 'x']);

    const node = parseAsaYaml(fs.readFileSync(path.join(dir, '.asa/nodes/requirements/REQ-001.yaml'), 'utf-8'));
    assert.equal(node.id, 'REQ-001');
    assert.ok(node.spec.includes('## Problem Statement'));
    assert.ok(node.spec.includes('shape_type 作为矢量标量传参（保留3）'), 'spec 应逐字保留 Solution 细节');
    assert.ok(node.spec.includes('详细备注内容B'), 'spec 应逐字保留 Further Notes 全部');
    assert.ok(!node.spec.includes('## Acceptance Criteria'), 'spec 不应含 AC 章节头');
    assert.deepEqual(node.acceptanceCriteria, [
      '拖拽缩放测量在16.6ms内最多执行一次',
      '重绘热路径0次新堆分配与0次深拷贝'
    ]);
    assert.ok(fs.existsSync(path.join(specs, 'REQ-001.md')), '应归档 .asa/specs/REQ-001.md');
  });
});

describe('add-req 不覆盖已有节点 (Layer B)', () => {
  it('--id 认领既有节点时保留其 spec/acceptanceCriteria，只叠盖 title', () => {
    const pre = path.join(dir, '.asa/nodes/requirements/REQ-002.yaml');
    const preYaml = [
      'id: REQ-002',
      'title: "已手写"',
      'status: proposed',
      'version: 1',
      'priority: P2',
      'acceptanceCriteria:',
      '  - "手写验收1"',
      '  - "手写验收2"',
      'spec: "## 手写完整spec\\n多行内容"',
      'changeLog: []',
      'pendingPropagation: []',
      ''
    ].join('\n');
    fs.writeFileSync(pre, preYaml, 'utf-8');

    run('req', ['新标题', '--id', 'REQ-002']);

    const node = parseAsaYaml(fs.readFileSync(pre, 'utf-8'));
    assert.equal(node.title, '新标题');
    assert.equal(node.spec, '## 手写完整spec\n多行内容');
    assert.deepEqual(node.acceptanceCriteria, ['手写验收1', '手写验收2']);
  });
});

describe('add-task 一次全量落盘 (Layer D)', () => {
  it('--desc/--inputs/--outputs/--req 一次写入 description/inputs/outputs/linkedReqs', () => {
    const descP = path.join(specs, 't1.md');
    fs.writeFileSync(descP, '端到端：从拖拽输入到绘制到 HUD，单帧 16.6ms 内完成。\n垂直切片完整描述。');
    const outP = path.join(specs, 't1.out');
    fs.writeFileSync(outP, '渲染就绪的帧\nGC 计数器归零');

    run('task', ['实现VSync帧合并', '--req', 'REQ-001', '--desc', descP, '--inputs', 'interaction事件,rawShape', '--outputs', outP]);

    const node = parseAsaYaml(fs.readFileSync(path.join(dir, '.asa/nodes/tasks/TASK-001.yaml'), 'utf-8'));
    assert.equal(node.id, 'TASK-001');
    assert.ok(node.description.includes('垂直切片完整描述'), 'description 应逐字');
    assert.deepEqual(node.inputs, ['interaction事件', 'rawShape']);
    assert.deepEqual(node.outputs, ['渲染就绪的帧', 'GC 计数器归零']);
    assert.deepEqual(node.linkedReqs, ['REQ-001']);
  });
});

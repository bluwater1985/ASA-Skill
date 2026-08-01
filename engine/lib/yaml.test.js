// engine/lib/yaml.test.js — ASA YAML 解析器测试（node:test, 零外部依赖）
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseAsaYaml, stringifyAsaYaml } = require('./yaml.js');

// ── 辅助函数：测试 round-trip ──
function roundTrip(yaml) {
  const parsed = parseAsaYaml(yaml);
  const serialized = stringifyAsaYaml(parsed);
  return parseAsaYaml(serialized);
}

// ── 1. 标量值 ──
describe('scalars', () => {
  it('parses string value', () => {
    const result = parseAsaYaml('key: hello');
    assert.equal(result.key, 'hello');
  });

  it('parses quoted string', () => {
    const result = parseAsaYaml('key: "hello world"');
    assert.equal(result.key, 'hello world');
  });

  it('parses numeric value', () => {
    const result = parseAsaYaml('count: 42');
    assert.equal(result.count, 42);
  });

  it('parses boolean true', () => {
    const result = parseAsaYaml('flag: true');
    assert.equal(result.flag, true);
  });

  it('parses boolean false', () => {
    const result = parseAsaYaml('flag: false');
    assert.equal(result.flag, false);
  });

  it('parses null', () => {
    const result = parseAsaYaml('val: null');
    assert.equal(result.val, null);
  });

  it('parses inline array', () => {
    const result = parseAsaYaml('items: [a, b, c]');
    assert.deepEqual(result.items, ['a', 'b', 'c']);
  });
});

// ── 2. 嵌套对象 ──
describe('nested objects', () => {
  it('parses single level nested', () => {
    const yaml = 'parent:\n  child: val';
    const result = parseAsaYaml(yaml);
    assert.deepEqual(result, { parent: { child: 'val' } });
  });

  it('parses multi-level nested', () => {
    const yaml = 'a:\n  b:\n    c: deep';
    const result = parseAsaYaml(yaml);
    assert.deepEqual(result, { a: { b: { c: 'deep' } } });
  });
});

// ── 3. 数组 ──
describe('arrays', () => {
  it('parses empty array', () => {
    const result = parseAsaYaml('items: []');
    assert.deepEqual(result.items, []);
  });

  it('parses scalar array', () => {
    const yaml = 'items:\n  - a\n  - b\n  - c';
    const result = parseAsaYaml(yaml);
    assert.deepEqual(result.items, ['a', 'b', 'c']);
  });

  it('parses single-key object array', () => {
    const yaml = 'items:\n  - key1: val1\n  - key2: val2';
    const result = parseAsaYaml(yaml);
    assert.deepEqual(result.items, [{ key1: 'val1' }, { key2: 'val2' }]);
  });

  it('parses multi-key object array', () => {
    const yaml = 'items:\n  - id: "REQ-003"\n    title: "规则检查引擎"\n    status: "modified"';
    const result = parseAsaYaml(yaml);
    assert.deepEqual(result, {
      items: [{
        id: 'REQ-003',
        title: '规则检查引擎',
        status: 'modified'
      }]
    });
  });

  it('parses mixed scalar and object array', () => {
    const yaml = 'items:\n  - simple\n  - id: obj\n    name: object';
    const result = parseAsaYaml(yaml);
    assert.deepEqual(result.items, ['simple', { id: 'obj', name: 'object' }]);
  });

  it('parses empty array items', () => {
    const yaml = 'items:\n  -\n  -\n  -';
    const result = parseAsaYaml(yaml);
    assert.deepEqual(result.items, [{}, {}, {}]);
  });

  it('parses deeply nested object array', () => {
    const yaml = 'items:\n  - name: outer\n    inner:\n      key: val';
    const result = parseAsaYaml(yaml);
    assert.deepEqual(result, {
      items: [{
        name: 'outer',
        inner: { key: 'val' }
      }]
    });
  });
});

// ── 4. 注释 ──
describe('comments', () => {
  it('skips comment lines', () => {
    const yaml = '# this is a comment\nkey: val\n# another comment';
    const result = parseAsaYaml(yaml);
    assert.deepEqual(result, { key: 'val' });
  });
});

// ── 5. 中文支持 ──
describe('chinese characters', () => {
  it('parses Chinese string values', () => {
    const yaml = 'title: "规则检查引擎"\nsummary: 增加爬电距离检查能力';
    const result = parseAsaYaml(yaml);
    assert.equal(result.title, '规则检查引擎');
    assert.equal(result.summary, '增加爬电距离检查能力');
  });
});

// ── 6. 字符串中的特殊字符 ──
describe('special characters', () => {
  it('quotes strings containing colon-space', () => {
    const yaml = 'summary: "modified: done"';
    const result = parseAsaYaml(yaml);
    assert.equal(result.summary, 'modified: done');
  });

  it('handles strings starting with dash', () => {
    const yaml = 'val: "- something"';
    const result = parseAsaYaml(yaml);
    assert.equal(result.val, '- something');
  });
});

// ── 7. Round-trip 一致性 ──
describe('round-trip', () => {
  it('scalars survive round-trip', () => {
    const yaml = 'str: hello\nnum: 42\nflag: true\nnil: null';
    const result = roundTrip(yaml);
    assert.equal(result.str, 'hello');
    assert.equal(result.num, 42);
    assert.equal(result.flag, true);
    assert.equal(result.nil, null);
  });

  it('nested objects survive round-trip', () => {
    const yaml = 'outer:\n  inner:\n    value: deep';
    const result = roundTrip(yaml);
    assert.deepEqual(result, { outer: { inner: { value: 'deep' } } });
  });

  it('object arrays survive round-trip', () => {
    const yaml = 'list:\n  - id: "A"\n    name: alpha\n  - id: "B"\n    name: beta';
    const result = roundTrip(yaml);
    assert.deepEqual(result.list, [
      { id: 'A', name: 'alpha' },
      { id: 'B', name: 'beta' }
    ]);
  });

  it('scalar arrays survive round-trip', () => {
    const yaml = 'tags:\n  - a\n  - b\n  - c';
    const result = roundTrip(yaml);
    assert.deepEqual(result.tags, ['a', 'b', 'c']);
  });

  it('complex nested structure survives round-trip', () => {
    const yaml = `meta:
  phase: "architecture"
  version: 1
nodes:
  - id: "REQ-001"
    title: "设计文档驱动"
    status: "proposed"
    version: 2
    changeLog:
      - date: "2026-07-30"
        type: "modified"
        version: 2
        summary: "增加了接受条件"
        by: "user"
    pendingPropagation:
      - changeVersion: 2
        status: "pending"
        affectedNodes:
          - id: "TASK-001"
            action:
              type: append_to_array
              target: "outputs"
              value: "新原子函数"`;
    const result = roundTrip(yaml);
    // 验证深层嵌套的对象数组
    assert.equal(result.meta.phase, 'architecture');
    assert.equal(result.nodes[0].id, 'REQ-001');
    assert.equal(result.nodes[0].version, 2);
    assert.equal(result.nodes[0].changeLog[0].type, 'modified');
    assert.equal(result.nodes[0].pendingPropagation[0].changeVersion, 2);
    assert.equal(result.nodes[0].pendingPropagation[0].affectedNodes[0].id, 'TASK-001');
    assert.equal(result.nodes[0].pendingPropagation[0].affectedNodes[0].action.type, 'append_to_array');
    assert.equal(result.nodes[0].pendingPropagation[0].affectedNodes[0].action.target, 'outputs');
  });
});

// ── 8. 真实示例：设计文档中的示例 ──
describe('design document examples', () => {
  it('parses the changeLog example', () => {
    const yaml = `id: "REQ-003"
title: "规则检查引擎"
status: "modified"
version: 2
changeLog:
  - date: "2026-07-30"
    type: "modified"
    version: 2
    summary: "增加爬电距离检查能力"
    by: "user"`;
    const result = parseAsaYaml(yaml);
    assert.equal(result.id, 'REQ-003');
    assert.equal(result.version, 2);
    assert.equal(result.changeLog.length, 1);
    assert.equal(result.changeLog[0].by, 'user');
    assert.equal(result.changeLog[0].summary, '增加爬电距离检查能力');
  });

  it('parses pendingPropagation with structured actions', () => {
    const yaml = `pendingPropagation:
  - changeVersion: 2
    status: "pending"
    affectedNodes:
      - id: "ARCH-003"
        action:
          type: set_status
          value: "draft"
      - id: "TASK-005"
        action:
          type: append_to_array
          target: "outputs"
          value: "爬电距离原子函数"`;
    const result = parseAsaYaml(yaml);
    const entry = result.pendingPropagation[0];
    assert.equal(entry.changeVersion, 2);
    assert.equal(entry.affectedNodes[0].id, 'ARCH-003');
    assert.equal(entry.affectedNodes[0].action.type, 'set_status');
    assert.equal(entry.affectedNodes[1].id, 'TASK-005');
    assert.equal(entry.affectedNodes[1].action.type, 'append_to_array');
    assert.equal(entry.affectedNodes[1].action.target, 'outputs');
  });
});

// ── 9. 存量兼容 ──
describe('backward compatibility', () => {
  it('parses current skeleton matrix.yaml', () => {
    const yaml = `meta:
  phase: "discovery"
  docsExpectedDigest: "sha256:empty"
  docsActualDigest: "sha256:empty"

risks: []
requirements: {}
architecture: {}
tasks: {}
edges: []`;
    const result = parseAsaYaml(yaml);
    assert.equal(result.meta.phase, 'discovery');
    assert.deepEqual(result.risks, []);
    assert.deepEqual(result.requirements, {});
    assert.deepEqual(result.edges, []);
    // Round-trip
    const result2 = roundTrip(yaml);
    assert.equal(result2.meta.phase, 'discovery');
  });

  it('parses edges with from/to/type', () => {
    const yaml = `edges:
  - from: "REQ-001"
    to: "ARCH-001"
    type: "depends"
  - from: "ARCH-001"
    to: "TASK-001"
    type: "refines"`;
    const result = parseAsaYaml(yaml);
    assert.equal(result.edges.length, 2);
    assert.equal(result.edges[0].from, 'REQ-001');
    assert.equal(result.edges[0].to, 'ARCH-001');
    assert.equal(result.edges[0].type, 'depends');
    assert.equal(result.edges[1].from, 'ARCH-001');
    assert.equal(result.edges[1].to, 'TASK-001');
  });
});

// ── 10. 空输入 ──
describe('review findings', () => {
  it('quoted number survives round-trip as string', () => {
    // stringifyScalar 应保留 "42" 为字符串，而非转为数字 42
    const yaml = 'val: "42"';
    const parsed = parseAsaYaml(yaml);
    assert.equal(parsed.val, '42');
    const serialized = stringifyAsaYaml(parsed);
    const reparsed = parseAsaYaml(serialized);
    assert.equal(reparsed.val, '42');
  });

  it('quoted boolean survives round-trip as string', () => {
    const yaml = 'val: "true"';
    const parsed = parseAsaYaml(yaml);
    assert.equal(parsed.val, 'true');
    const serialized = stringifyAsaYaml(parsed);
    const reparsed = parseAsaYaml(serialized);
    assert.equal(reparsed.val, 'true');
  });

  it('quoted null survives round-trip as string', () => {
    const yaml = 'val: "null"';
    const parsed = parseAsaYaml(yaml);
    assert.equal(parsed.val, 'null');
    const serialized = stringifyAsaYaml(parsed);
    const reparsed = parseAsaYaml(serialized);
    assert.equal(reparsed.val, 'null');
  });

  it('quoted colon-space in array item treated as scalar', () => {
    // 不应把 "key: value" 解析为对象 {key: value}
    const yaml = 'items:\n  - "key: value"';
    const parsed = parseAsaYaml(yaml);
    assert.equal(Array.isArray(parsed.items), true);
    assert.equal(parsed.items[0], 'key: value');
  });

  it('single-quoted array item treated as scalar', () => {
    const yaml = 'items:\n  - \'key: value\'';
    const parsed = parseAsaYaml(yaml);
    assert.equal(parsed.items[0], 'key: value');
  });

  it('tilde null shorthand', () => {
    const result = parseAsaYaml('key: ~');
    assert.equal(result.key, null);
  });

  it('empty quoted string value', () => {
    const result = parseAsaYaml('key: ""');
    assert.equal(result.key, '');
  });

  it('nested array as non-first key survives round-trip', () => {
    const obj = {
      pendingPropagation: [{
        changeVersion: 2,
        status: 'pending',
        affectedNodes: [
          { id: 'TASK-001', action: { type: 'set_status', value: 'draft' } }
        ]
      }]
    };
    const s = stringifyAsaYaml(obj);
    const back = parseAsaYaml(s);
    assert.equal(Array.isArray(back.pendingPropagation[0].affectedNodes), true);
    assert.equal(back.pendingPropagation[0].affectedNodes[0].id, 'TASK-001');
    assert.equal(back.pendingPropagation[0].affectedNodes[0].action.type, 'set_status');
  });

  it('inline array with quoted commas', () => {
    const result = parseAsaYaml('items: [a, "b, c", d]');
    assert.deepEqual(result.items, ['a', 'b, c', 'd']);
  });

  it('string containing inner double quotes serializes safely', () => {
    const obj = { text: 'it\'s "done" now' };
    const s = stringifyAsaYaml(obj);
    const reparsed = parseAsaYaml(s);
    assert.equal(reparsed.text, 'it\'s "done" now');
  });
});

// ── 11. 空输入 ──
describe('edge cases', () => {
  it('handles empty string', () => {
    const result = parseAsaYaml('');
    assert.deepEqual(result, {});
  });

  it('handles only comments', () => {
    const result = parseAsaYaml('# just a comment\n# another');
    assert.deepEqual(result, {});
  });
});

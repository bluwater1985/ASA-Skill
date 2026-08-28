// engine/lib/similarity.test.js — 确定性文本检索与查重相似度测试
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalize, bigrams, dice, topCandidates } = require('./similarity.js');

describe('similarity - normalize', () => {
  it('should downcase and strip special characters', () => {
    assert.equal(normalize('Hello, World! 123'), 'helloworld123');
  });

  it('should handle Chinese characters and strip Chinese punctuation', () => {
    assert.equal(normalize('大鹏，你好！【测试】'), '大鹏你好测试');
  });

  it('should handle empty input gracefully', () => {
    assert.equal(normalize(''), '');
    assert.equal(normalize(null), '');
  });
});

describe('similarity - bigrams', () => {
  it('should generate set of bigrams for English', () => {
    const b = bigrams('abc');
    assert.deepEqual(Array.from(b).sort((a, b) => a[0].localeCompare(b[0])), [ [ 'ab', 1 ], [ 'bc', 1 ] ]);
  });

  it('should handle single character string', () => {
    const b = bigrams('a');
    assert.deepEqual(Array.from(b), [ [ 'a', 1 ] ]);
  });

  it('should generate set of bigrams for Chinese', () => {
    const b = bigrams('你好世界');
    const actual = Array.from(b).sort((a, b) => a[0].localeCompare(b[0]));
    const expected = [ [ '世界', 1 ], [ '你好', 1 ], [ '好世', 1 ] ].sort((a, b) => a[0].localeCompare(b[0]));
    assert.deepEqual(actual, expected);
  });
});

describe('similarity - dice & topCandidates', () => {
  it('should calculate 1.0 for identical strings', () => {
    assert.equal(dice('hello', 'hello'), 1.0);
  });

  it('should calculate 0.0 for totally different strings', () => {
    assert.equal(dice('abc', 'xyz'), 0.0);
  });

  it('should calculate correct dice coefficient for overlaps', () => {
    // 'abc' bigrams: ['ab', 'bc'] (2)
    // 'abd' bigrams: ['ab', 'bd'] (2)
    // intersection: ['ab'] (1)
    // dice: 2 * 1 / (2 + 2) = 0.5
    assert.equal(dice('abc', 'abd'), 0.5);
  });

  it('should find top candidates sorted by score', () => {
    const existing = [
      { id: 'REQ-001', title: '编写自动化测试用例' },
      { id: 'REQ-002', title: '编写自动化部署脚本' },
      { id: 'REQ-003', title: '无关内容开发描述' }
    ];
    const results = topCandidates('编写自动化测试', existing, 0.1);
    assert.equal(results.length, 2);
    assert.equal(results[0].id, 'REQ-001');
    assert.ok(results[0].score > results[1].score);
  });
});

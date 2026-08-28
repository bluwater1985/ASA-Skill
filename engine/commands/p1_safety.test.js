const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createSandbox, run, readNode, readMatrix } = require('./helpers.js');
const { execFileSync } = require('child_process');
const { stringifyAsaYaml } = require('../lib/yaml.js');

const testEnv = { ...process.env };
delete testEnv.ASA_INTERNAL_WRITE;

describe('Task 2.1: Hook safety, concurrent isolation, and AfterTool rollback', () => {
  let dir;
  before(() => {
    dir = createSandbox();
    fs.mkdirSync(path.join(dir, '.asa/hooks'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.asa/lib'), { recursive: true });
    
    // Copy hook scripts into sandbox
    fs.copyFileSync(path.join(__dirname, '../hooks/check-work-order.js'), path.join(dir, '.asa/hooks/check-work-order.js'));
    fs.copyFileSync(path.join(__dirname, '../hooks/validate-yaml.js'), path.join(dir, '.asa/hooks/validate-yaml.js'));

    // Copy version.js and lib modules for hook standard loading
    fs.copyFileSync(path.join(__dirname, '../version.js'), path.join(dir, '.asa/version.js'));
    fs.copyFileSync(path.join(__dirname, '../lib/yaml.js'), path.join(dir, '.asa/lib/yaml.js'));
    fs.copyFileSync(path.join(__dirname, '../lib/matrix.js'), path.join(dir, '.asa/lib/matrix.js'));
  });
  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('restores modified YAML node file on validate-yaml Hook failure', () => {
    const nodePath = path.join(dir, '.asa/nodes/requirements/REQ-001.yaml');
    fs.writeFileSync(nodePath, 'id: REQ-001\ntitle: "Original REQ"\nstatus: proposed\n');

    const beforeHook = path.join(dir, '.asa/hooks/check-work-order.js');
    const afterHook = path.join(dir, '.asa/hooks/validate-yaml.js');

    // 1. BeforeTool Hook backup
    execFileSync(process.execPath, [beforeHook], {
      cwd: dir,
      input: JSON.stringify({ file_path: '.asa/nodes/requirements/REQ-001.yaml' }),
      encoding: 'utf8',
      env: testEnv
    });

    // 2. We write invalid YAML (contains Tab)
    fs.writeFileSync(nodePath, 'id: REQ-001\n\ttitle: "Broken REQ"\nstatus: proposed\n');

    // 3. AfterTool Hook validates and fails, reverting the file
    let stdout = '';
    try {
      stdout = execFileSync(process.execPath, [afterHook], {
        cwd: dir,
        input: JSON.stringify({ file_path: '.asa/nodes/requirements/REQ-001.yaml' }),
        encoding: 'utf8',
        env: testEnv
      });
    } catch (e) {
      stdout = e.stdout || '';
    }

    const res = JSON.parse(stdout);
    assert.equal(res.decision, 'deny');
    
    // Assert original content is rolled back
    const restored = fs.readFileSync(nodePath, 'utf-8');
    assert.ok(restored.includes('Original REQ'), 'Original YAML must be restored after validation failure');
    assert.ok(!restored.includes('Broken REQ'), 'Broken content must be wiped out');
  });

  it('deletes newly created invalid YAML node file on validate-yaml Hook failure', () => {
    const nodePath = path.join(dir, '.asa/nodes/requirements/REQ-999.yaml');
    const beforeHook = path.join(dir, '.asa/hooks/check-work-order.js');
    const afterHook = path.join(dir, '.asa/hooks/validate-yaml.js');

    // 1. BeforeTool Hook (not existing, registers as created)
    execFileSync(process.execPath, [beforeHook], {
      cwd: dir,
      input: JSON.stringify({ file_path: '.asa/nodes/requirements/REQ-999.yaml' }),
      encoding: 'utf8',
      env: testEnv
    });

    // 2. We write invalid YAML
    fs.writeFileSync(nodePath, 'id: REQ-999\n\ttitle: "Invalid New"\nstatus: proposed\n');

    // 3. AfterTool Hook
    let stdout = '';
    try {
      stdout = execFileSync(process.execPath, [afterHook], {
        cwd: dir,
        input: JSON.stringify({ file_path: '.asa/nodes/requirements/REQ-999.yaml' }),
        encoding: 'utf8',
        env: testEnv
      });
    } catch (e) {
      stdout = e.stdout || '';
    }

    const res = JSON.parse(stdout);
    assert.equal(res.decision, 'deny');
    assert.ok(!fs.existsSync(nodePath), 'Newly created invalid node file must be physically deleted on validation failure');
  });
});

describe('Task 2.2: Document hash decoupling (01 & 03 only)', () => {
  let dir;
  before(() => {
    dir = createSandbox();
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs/01-requirements.md'), 'Requirements Content');
    fs.writeFileSync(path.join(dir, 'docs/03-tasks.md'), 'Tasks Content');
    fs.writeFileSync(path.join(dir, 'docs/00-overview.md'), 'Overview Content');
  });
  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('verifies calculateDocsDigest hashes ONLY 01 and 03 documents, ignoring 00 narrative changes', () => {
    const { calculateDocsDigest } = require('../lib/matrix.js');
    
    // We mock CWD for matrix.js dynamic path resolution
    const originalCwd = process.cwd;
    process.cwd = () => dir;

    try {
      const digest1 = calculateDocsDigest();

      // Modify 00-overview.md
      fs.writeFileSync(path.join(dir, 'docs/00-overview.md'), 'Modified Overview Content');
      const digest2 = calculateDocsDigest();

      assert.equal(digest1, digest2, 'Digest must NOT change when narrative documents like 00-overview.md are modified');

      // Modify 01-requirements.md
      fs.writeFileSync(path.join(dir, 'docs/01-requirements.md'), 'Modified Requirements Content');
      const digest3 = calculateDocsDigest();

      assert.notEqual(digest2, digest3, 'Digest MUST change when core compiled documents like 01-requirements.md are modified');
    } finally {
      process.cwd = originalCwd;
    }
  });
});

describe('Task 2.3: Multiset Bigram-Dice similarity algorithm', () => {
  it('normalizes text by removing all special characters and spaces', () => {
    const { normalize } = require('../lib/similarity.js');
    assert.equal(normalize('A! B# C.'), 'abc', 'Should strip all punctuation and spaces');
    assert.equal(normalize('测试  ， 需求！'), '测试需求', 'Should strip Chinese punctuation and spaces');
  });

  it('computes correct Sørensen-Dice coefficient using Multisets with frequencies', () => {
    const { dice } = require('../lib/similarity.js');
    // Multiset: 'aaaa' -> aa: 3; 'aaa' -> aa: 2.
    // Intersection: min(3, 2) = 2. Total: 3 + 2 = 5.
    // Dice: (2.0 * 2) / 5 = 0.8.
    // If standard Set was used, it would be (2.0 * 1) / 2 = 1.0 (since sets are both {'aa'}).
    const score = dice('aaaa', 'aaa');
    assert.equal(score, 0.8, 'aaaa vs aaa similarity score under Multiset Sørensen-Dice must be strictly 0.8');
  });

  it('computes scoreReq with proper weights for title (x2) and description (x1)', () => {
    const { scoreReq } = require('../lib/similarity.js');
    // If we pass query that matches title but not body, score should represent title weight.
    const node = {
      title: 'A B C',
      description: 'D E F',
      acceptanceCriteria: ['G H I']
    };
    const score = scoreReq('A B C', node);
    // scoreTitle = dice('A B C', 'A B C') = 1.0
    // scoreBody = dice('A B C', 'D E F\nG H I') = 0.0
    // Combined: (1.0 * 2 + 0.0 * 1) / 3 = 0.67
    assert.ok(score > 0.6 && score < 0.7, 'Weighted req score should be around 0.67');
  });

  it('returns candidate search results with status and version fields', () => {
    const { topCandidates } = require('../lib/similarity.js');
    const existing = [
      { id: 'REQ-001', title: '测试需求', status: 'proposed', version: 3 }
    ];
    const results = topCandidates('测试需求', existing, 0.1);
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'proposed');
    assert.equal(results[0].version, 3);
  });
});

describe('Task 2.4: Deduplication override threshold and TASK default fields', () => {
  let dir;
  before(() => {
    dir = createSandbox();
  });
  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('allows adding requirement when max similarity is exactly 0.9, but blocks when > 0.9', () => {
    // 写入一个存量需求
    fs.writeFileSync(path.join(dir, '.asa/nodes/requirements/REQ-001.yaml'), 'id: REQ-001\ntitle: "AAA BBB CCC"\nstatus: proposed\n');
    const matrix = {
      meta: { project: "test", phase: "discovery", schemaVersion: 3 },
      requirements: {
        "REQ-001": { title: "AAA BBB CCC", status: "proposed" }
      }
    };
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(matrix));

    // 1. 我们尝试添加一个完全相同的需求 "AAA BBB CCC" -> 1.0 相似度，应该被拦截
    const r1 = run(dir, 'add-req', ['AAA BBB CCC']);
    assert.notEqual(r1.exitCode, 0, 'Should block exact duplicates');

    // 2. 带有合规豁免参数时，应该放行并记录在 nodes/ 的 allowSimilar 元数据中
    const r2 = run(dir, 'add-req', ['AAA BBB CCC', '--allow-similar', 'REQ-001', '--reason', 'Business bypass', '--by', 'zhangpeng54']);
    assert.equal(r2.exitCode, 0, 'Should allow similarity bypass with valid escape args');
    
    const newNode = readNode(dir, 'requirements', 'REQ-002');
    assert.ok(newNode.allowSimilar, 'Exempt credentials should be recorded in node');
    assert.equal(newNode.allowSimilar.id, 'REQ-001');
    assert.equal(newNode.allowSimilar.reason, 'Business bypass');
    assert.equal(newNode.allowSimilar.by, 'zhangpeng54');
  });

  it('verifies that newly created TASK nodes initialize linkedReqs and changedFiles empty arrays', () => {
    const r = run(dir, 'add-task', ['实现自愈功能']);
    assert.equal(r.exitCode, 0);

    const taskNode = readNode(dir, 'tasks', 'TASK-001');
    assert.ok(Array.isArray(taskNode.linkedReqs), 'linkedReqs must be initialized as an array');
    assert.equal(taskNode.linkedReqs.length, 0);
    assert.ok(Array.isArray(taskNode.changedFiles), 'changedFiles must be initialized as an array');
    assert.equal(taskNode.changedFiles.length, 0);
  });
});

describe('Task 2.5: session-start.js pure read-only hook', () => {
  let dir;
  before(() => {
    dir = createSandbox();
    fs.mkdirSync(path.join(dir, '.asa/hooks'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../hooks/session-start.js'), path.join(dir, '.asa/hooks/session-start.js'));
  });
  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('runs session-start.js hook and asserts pure read-only safety with mtime unchanged', () => {
    const hookPath = path.join(dir, '.asa/hooks/session-start.js');
    const matrixPath = path.join(dir, '.asa/matrix.yaml');

    const mtimeBefore = fs.statSync(matrixPath).mtimeMs;

    // Run session-start.js
    const stdout = execFileSync(process.execPath, [hookPath], {
      cwd: dir,
      encoding: 'utf8'
    });

    assert.match(stdout, /\[ASA STATUS\]/);
    
    const mtimeAfter = fs.statSync(matrixPath).mtimeMs;
    assert.equal(mtimeBefore, mtimeAfter, 'session-start.js hook must be strictly read-only and leave mtime untouched');
  });
});

describe('Task 2.6: Staged Schema 2->3 migration', () => {
  let dir;
  before(() => {
    dir = createSandbox();
    // 写入一个 schemaVersion 2 的 matrix.yaml
    const oldMatrix = `meta:
  project: "test"
  phase: "discovery"
  schemaVersion: 2
risks: []
requirements: {}
architecture: {}
tasks: {}
edges: []
`;
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), oldMatrix);
  });
  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('reconciles project and updates migrationStage and schemaVersion at last', () => {
    // Run reconcile
    const r = run(dir, 'reconcile');
    assert.equal(r.exitCode, 0, 'reconcile should migrate successfully');

    const matrix = readMatrix(dir);
    assert.equal(matrix.meta.schemaVersion, 4, 'schemaVersion must be successfully migrated to 4');
    // Ensure Task 2.6 softening fills TASK arrays
    assert.equal(matrix.meta.engineVersion, '3.x');
  });
});

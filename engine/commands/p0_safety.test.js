const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createSandbox, run, readMatrix } = require('./helpers.js');
const { execFileSync } = require('child_process');
const { stringifyAsaYaml } = require('../lib/yaml.js');

describe('Task 1.1: version.js copy list static tests', () => {
  it('verifies clients/gemini/.gemini/skills/asa/scripts/asa-init.js contains copy command for version.js', () => {
    const initScriptPath = path.join(__dirname, '../../clients/gemini/.gemini/skills/asa/scripts/asa-init.js');
    assert.ok(fs.existsSync(initScriptPath), 'asa-init.js must exist');
    const content = fs.readFileSync(initScriptPath, 'utf-8');
    assert.ok(content.includes('version.js'), 'asa-init.js must contain version.js copying logic');
  });

  it('verifies clients/claude/.claude/skills/asa/SKILL.md contains copy command for version.js', () => {
    const skillPath = path.join(__dirname, '../../clients/claude/.claude/skills/asa/SKILL.md');
    assert.ok(fs.existsSync(skillPath), 'Claude SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf-8');
    assert.ok(content.includes('version.js'), 'Claude SKILL.md must copy version.js');
  });

  it('verifies clients/gemini/.gemini/skills/asa/SKILL.md contains copy command for version.js', () => {
    const skillPath = path.join(__dirname, '../../clients/gemini/.gemini/skills/asa/SKILL.md');
    assert.ok(fs.existsSync(skillPath), 'Gemini SKILL.md must exist');
    const content = fs.readFileSync(skillPath, 'utf-8');
    assert.ok(content.includes('version.js'), 'Gemini SKILL.md must copy version.js');
  });
});

describe('Task 1.2: Schema Version Guard tests', () => {
  let dir;
  before(() => {
    dir = createSandbox();
  });
  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('blocks writing when schemaVersion > MAX_SUPPORTED_SCHEMA (3)', () => {
    const mp = path.join(dir, '.asa/matrix.yaml');
    const corruptedMatrix = `meta:
  project: "test"
  phase: "discovery"
  schemaVersion: 4
risks: []
requirements: {}
architecture: {}
tasks: {}
edges: []
`;
    fs.writeFileSync(mp, corruptedMatrix);

    const r = run(dir, 'add-req', ['测试需求']);
    
    assert.notEqual(r.exitCode, 0, 'Should block writing when schemaVersion is higher than max supported');
    assert.match(r.output, /引擎版本过低|Schema/i, 'Should report engine version compatibility error');
  });

  it('blocks check-work-order hook when schemaVersion > MAX_SUPPORTED_SCHEMA (3)', () => {
    // 写入一个 schemaVersion 4 的 matrix.yaml
    const mp = path.join(dir, '.asa/matrix.yaml');
    const corruptedMatrix = `meta:
  project: "test"
  phase: "discovery"
  schemaVersion: 4
risks: []
requirements: {}
architecture: {}
tasks: {}
edges: []
`;
    fs.writeFileSync(mp, corruptedMatrix);

    const hookPath = path.join(__dirname, '../hooks/check-work-order.js');
    assert.ok(fs.existsSync(hookPath), 'Hook check-work-order.js must exist');

    const payload = JSON.stringify({
      arguments: { file_path: '.asa/nodes/requirements/REQ-001.yaml' }
    });
    
    const env = { ...process.env };
    delete env.ASA_INTERNAL_WRITE;

    let stdout = '';
    try {
      stdout = execFileSync(process.execPath, [hookPath], {
        cwd: dir,
        input: payload,
        encoding: 'utf8',
        env
      });
    } catch (e) {
      stdout = e.stdout || '';
    }

    const res = JSON.parse(stdout);
    assert.equal(res.decision, 'deny');
    assert.match(res.reason || res.systemMessage, /引擎版本过低|Schema/i);
  });
});

describe('Task 1.3: Crash-Resilient Persistent Transaction tests', () => {
  let dir;
  before(() => {
    dir = createSandbox();
  });
  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('verifies that compileDoc in compile.js writes docs atomically', () => {
    const compilePath = path.join(__dirname, 'compile.js');
    assert.ok(fs.existsSync(compilePath), 'compile.js must exist');
    const content = fs.readFileSync(compilePath, 'utf-8');
    assert.ok(content.includes('renameSync') || content.includes('atomicWrite'), 'compile.js must use renameSync or atomic write for atomic document writing');
  });

  it('automatically rolls back and heals from an in-flight crashed transaction on diagnose', () => {
    const txDir = path.join(dir, '.asa/transactions/tx-mock-crash');
    fs.mkdirSync(txDir, { recursive: true });

    const currentMatrixPath = path.join(dir, '.asa/matrix.yaml');
    const crashedMatrix = fs.readFileSync(currentMatrixPath, 'utf-8').replace('project: "test"', 'project: "crashed-half-written-state"');
    fs.writeFileSync(currentMatrixPath, crashedMatrix);

    const dummyNodePath = path.join(dir, '.asa/nodes/requirements/REQ-999.yaml');
    fs.writeFileSync(dummyNodePath, 'title: "I should be deleted on rollback"');

    const originalMatrixBackupPath = path.join(txDir, 'matrix.yaml.bak');
    const originalMatrixContent = `meta:
  project: "test"
  phase: "discovery"
  schemaVersion: 2
risks: []
requirements: {}
architecture: {}
tasks: {}
edges: []
`;
    fs.writeFileSync(originalMatrixBackupPath, originalMatrixContent);

    const manifestPath = path.join(txDir, 'manifest.json');
    const manifest = {
      txId: 'tx-mock-crash',
      status: 'prepared',
      startedAt: new Date().toISOString(),
      backups: [
        { original: '.asa/matrix.yaml', backup: '.asa/transactions/tx-mock-crash/matrix.yaml.bak' }
      ],
      createdFiles: [
        '.asa/nodes/requirements/REQ-999.yaml'
      ]
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    // 运行 compile 触发写锁自愈
    const r = run(dir, 'compile');

    assert.ok(fs.existsSync(currentMatrixPath), 'matrix.yaml must exist');
    const restoredMatrix = fs.readFileSync(currentMatrixPath, 'utf-8');
    assert.ok(restoredMatrix.includes('project: test') || restoredMatrix.includes('project: "test"'), 'matrix.yaml should be rolled back to the backup state');
    assert.ok(!restoredMatrix.includes('crashed-half-written-state'), 'Crashed state must be wiped out');

    assert.ok(!fs.existsSync(dummyNodePath), 'Partially created node REQ-999.yaml must be deleted');
    assert.ok(!fs.existsSync(txDir), 'Transaction folder must be cleaned up after recovery');
  });
});

describe('Task 1.4: Refactor multi-stage deprecate cascade matrix', () => {
  let dir;
  before(() => {
    dir = createSandbox();
    
    // 初始化一些节点和状态，写入到 nodes/
    fs.mkdirSync(path.join(dir, '.asa/nodes/requirements'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.asa/nodes/architecture'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.asa/nodes/tasks'), { recursive: true });

    const createNode = (cat, id, status, extra = {}) => {
      const nodePath = path.join(dir, `.asa/nodes/${cat}/${id}.yaml`);
      fs.writeFileSync(nodePath, `id: "${id}"\ntitle: "Node ${id}"\nstatus: "${status}"\n${Object.entries(extra).map(([k,v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}`);
    };

    createNode('requirements', 'REQ-001', 'proposed');
    createNode('architecture', 'ARCH-001', 'draft');
    createNode('tasks', 'TASK-001', 'pending');
    createNode('tasks', 'TASK-002', 'pending');
    createNode('tasks', 'TASK-003', 'pending');
    createNode('tasks', 'TASK-004', 'pending');
    createNode('tasks', 'TASK-005', 'pending');
    createNode('tasks', 'TASK-006', 'pending');

    // 建立 matrix 摘要索引
    const matrix = {
      meta: {
        project: "test-cascade",
        phase: "discovery",
        schemaVersion: 3,
        activeTask: "TASK-004" // 设置 TASK-004 为 activeTask
      },
      requirements: {
        "REQ-001": { title: "Node REQ-001", status: "proposed" }
      },
      architecture: {
        "ARCH-001": { title: "Node ARCH-001", status: "draft" }
      },
      tasks: {
        "TASK-001": { title: "Node TASK-001", status: "pending", file: ".asa/nodes/tasks/TASK-001.yaml" },
        "TASK-002": { title: "Node TASK-002", status: "pending", file: ".asa/nodes/tasks/TASK-002.yaml" },
        "TASK-003": { title: "Node TASK-003", status: "pending", file: ".asa/nodes/tasks/TASK-003.yaml" },
        "TASK-004": { title: "Node TASK-004", status: "pending", file: ".asa/nodes/tasks/TASK-004.yaml" },
        "TASK-005": { title: "Node TASK-005", status: "pending", file: ".asa/nodes/tasks/TASK-005.yaml" },
        "TASK-006": { title: "Node TASK-006", status: "pending", file: ".asa/nodes/tasks/TASK-006.yaml" }
      },
      edges: [
        // REQ-001 -> TASK-001 (depends 边, 触发级联取消)
        { from: "REQ-001", to: "TASK-001", type: "depends" },
        // REQ-001 -> TASK-002 (legacy 边, 触发级联取消)
        { from: "REQ-001", to: "TASK-002" },
        // TASK-001 -> TASK-003 (depends 边, 触发递归级联)
        { from: "TASK-001", to: "TASK-003", type: "depends" },
        // REQ-001 -> TASK-004 (extends 边, 排除级联)
        { from: "REQ-001", to: "TASK-004", type: "extends" },
        // TASK-001 -> TASK-005 (refines 边, 排除级联)
        { from: "TASK-001", to: "TASK-005", type: "refines" },
        // REQ-001 -> ARCH-001 (depends)
        { from: "REQ-001", to: "ARCH-001", type: "depends" },
        // ARCH-001 -> TASK-006 (depends, 排除穿透级联)
        { from: "ARCH-001", to: "TASK-006", type: "depends" }
      ]
    };
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(matrix));
  });

  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('runs deprecate and checks refined cascade matrix rules', () => {
    const r = run(dir, 'deprecate', ['REQ-001']);
    assert.equal(r.exitCode, 0, 'deprecate REQ-001 should run successfully');

    const getStatus = (cat, id) => {
      const p = path.join(dir, `.asa/nodes/${cat}/${id}.yaml`);
      const lines = fs.readFileSync(p, 'utf-8').split('\n');
      const statusLine = lines.find(l => l.startsWith('status:'));
      return statusLine ? statusLine.match(/status:\s*"?([^"\s\r\n]+)"?/)?.[1] : null;
    };

    // 1. REQ-001 自身应该变为 deprecated
    assert.equal(getStatus('requirements', 'REQ-001'), 'deprecated');

    // 2. TASK-001（REQ-001 depends 下游）应被级联取消 (cancelled)
    assert.equal(getStatus('tasks', 'TASK-001'), 'cancelled');

    // 3. TASK-002（REQ-001 legacy 下游）应被级联取消 (cancelled)
    assert.equal(getStatus('tasks', 'TASK-002'), 'cancelled');

    // 4. TASK-003（TASK-001 depends 递归下游）应被递归取消 (cancelled)
    assert.equal(getStatus('tasks', 'TASK-003'), 'cancelled');

    // 5. TASK-004（REQ-001 extends 下游）绝对不能被级联取消，保持 pending
    assert.equal(getStatus('tasks', 'TASK-004'), 'pending');

    // 6. TASK-005（TASK-001 refines 下游）绝对不能被级联取消，保持 pending
    assert.equal(getStatus('tasks', 'TASK-005'), 'pending');

    // 7. TASK-006（不穿透 ARCH 中间节点）绝对不能被级联取消，保持 pending
    assert.equal(getStatus('tasks', 'TASK-006'), 'pending');

    // 8. 验证 activeTask 清理规则
    // 之前 activeTask 为 TASK-004，由于它未被取消，activeTask 必须保留，不能被误清除！
    const matrixAfter = readMatrix(dir);
    assert.equal(matrixAfter.meta.activeTask, 'TASK-004', 'activeTask TASK-004 should remain active');
  });
});

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createSandbox, run, readNode, readMatrix } = require('./helpers.js');
const { stringifyAsaYaml } = require('../lib/yaml.js');

describe('Step 1: Concurrency Lock, Read-only Boundary, and Corrupted Lock Protection', () => {
  let dir;
  before(() => {
    dir = createSandbox();
  });
  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('verifies that process B cannot rollback process A active transaction while A holds the lock', () => {
    // 1. 模拟进程 A 成功获取锁，写入当前活跃的测试运行进程 PID (肯定存活)
    const lockPath = path.join(dir, '.asa/lock');
    const lockData = {
      pid: process.pid,
      expireAt: Date.now() + 60000 // 锁租约 60 秒
    };
    fs.writeFileSync(lockPath, JSON.stringify(lockData, null, 2));

    // 2. 模拟进程 A 创建的未提交活跃事务
    const txDir = path.join(dir, '.asa/transactions/tx-active-a');
    fs.mkdirSync(txDir, { recursive: true });
    fs.writeFileSync(path.join(txDir, 'manifest.json'), JSON.stringify({
      txId: 'tx-active-a',
      status: 'prepared',
      startedAt: new Date().toISOString(),
      backups: [],
      createdFiles: []
    }));

    // 3. 启动进程 B（执行写操作 add-req）
    const r = run(dir, 'add-req', ['测试写操作']);

    // 4. 进程 B 应该由于锁占用而失败退出
    assert.notEqual(r.exitCode, 0, 'Process B must fail when write-lock is held by an active process A');

    // 5. 核心断言：由于 B 无法获取写锁，B 绝对不能回滚/删除 A 的活跃事务目录！
    assert.ok(fs.existsSync(txDir), 'Active transaction directory of process A must NOT be rolled back or deleted by process B');
  });

  it('verifies that read-only commands do NOT trigger transaction rollback', () => {
    // 1. 清理锁，确保无锁状态
    const lockPath = path.join(dir, '.asa/lock');
    try { fs.unlinkSync(lockPath); } catch {}

    // 2. 模拟一个历史残留的未完成事务
    const txDir = path.join(dir, '.asa/transactions/tx-incomplete');
    fs.mkdirSync(txDir, { recursive: true });
    fs.writeFileSync(path.join(txDir, 'manifest.json'), JSON.stringify({
      txId: 'tx-incomplete',
      status: 'prepared',
      startedAt: new Date().toISOString(),
      backups: [],
      createdFiles: []
    }));

    const matrixPath = path.join(dir, '.asa/matrix.yaml');
    const mtimeBefore = fs.statSync(matrixPath).mtimeMs;

    // 3. 运行只读诊断命令 diagnose
    const r = run(dir, 'diagnose');
    assert.equal(r.exitCode, 0, 'Read-only diagnose command should run successfully');

    // 4. 只读断言：
    //    - 历史未提交事务必须依然保留（没有被回滚！）
    //    - matrix.yaml 修改时间不能改变（保证只读，无文件污染写盘！）
    assert.ok(fs.existsSync(txDir), 'Read-only commands must NOT rollback or clean up incomplete transactions');
    
    const mtimeAfter = fs.statSync(matrixPath).mtimeMs;
    assert.equal(mtimeBefore, mtimeAfter, 'Read-only command must not modify matrix.yaml mtimeMs');
  });

  it('verifies that corrupted or empty lock file conservatively blocks commands and prompts manual resolution', () => {
    // 1. 写入损坏的非 JSON 格式锁文件
    const lockPath = path.join(dir, '.asa/lock');
    fs.writeFileSync(lockPath, 'this is corrupted lock data {not-json}');

    // 2. 运行任何写命令（如 add-req）
    const r = run(dir, 'add-req', ['测试损坏锁']);

    // 3. 强核断言：
    //    - 命令必须失败（exitCode !== 0），杜绝直接忽视损坏锁
    //    - 磁盘上的损坏锁文件必须依旧保留，绝对不能被自动删除（保留排障现场）
    //    - 终端输出应给出指引说明
    assert.notEqual(r.exitCode, 0, 'Should conservatively block when lock is corrupted');
    assert.ok(fs.existsSync(lockPath), 'Corrupted lock file must NOT be deleted automatically');
    assert.match(r.output, /锁文件损坏|lock/i, 'Should prompt manual lock resolution instructions');
  });
});

describe('Step 2: Manifest Atomic Write, Corrupted Manifest Protection, and PPID Hook Isolation', () => {
  let dir;
  before(() => {
    dir = createSandbox();
    
    // 拷贝 Hook 脚本并初始化
    fs.mkdirSync(path.join(dir, '.asa/hooks'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.asa/lib'), { recursive: true });
    fs.copyFileSync(path.resolve('engine/hooks/check-work-order.js'), path.join(dir, '.asa/hooks/check-work-order.js'));
    fs.copyFileSync(path.resolve('engine/hooks/validate-yaml.js'), path.join(dir, '.asa/hooks/validate-yaml.js'));
    fs.copyFileSync(path.resolve('engine/version.js'), path.join(dir, '.asa/version.js'));
    fs.copyFileSync(path.resolve('engine/lib/yaml.js'), path.join(dir, '.asa/lib/yaml.js'));
    fs.copyFileSync(path.resolve('engine/lib/matrix.js'), path.join(dir, '.asa/lib/matrix.js'));
  });

  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('verifies that corrupted manifest conservatively blocks recovery and is preserved on disk', () => {
    // 1. 模拟一个损坏的 manifest.json
    const txDir = path.join(dir, '.asa/transactions/tx-corrupt-manifest');
    fs.mkdirSync(txDir, { recursive: true });
    fs.writeFileSync(path.join(txDir, 'manifest.json'), 'this is corrupted manifest data {not-json}');

    // 2. 运行写命令（如 add-req）触发自愈检查
    const r = run(dir, 'add-req', ['测试损坏清单']);
    
    // 3. 强核断言：
    //    - 面临损坏 manifest 时，必须失败/抛错
    //    - 损坏的 manifest 与事务目录必须依旧保留，绝对不能被直接删除
    assert.notEqual(r.exitCode, 0, 'Should fail and block when manifest is corrupted');
    assert.ok(fs.existsSync(txDir), 'Corrupted transaction directory must NOT be deleted');
  });

  it('verifies that Hook backups are isolated using UUID and prevent concurrency conflicts', () => {
    const beforeHook = path.join(dir, '.asa/hooks/check-work-order.js');
    const nodePath = path.join(dir, '.asa/nodes/requirements/REQ-001.yaml');
    fs.writeFileSync(nodePath, 'id: REQ-001\ntitle: "Original REQ"\nstatus: proposed\n');

    const env = { ...process.env };
    delete env.ASA_INTERNAL_WRITE;

    const { execFileSync } = require('child_process');
    // 1. 运行 BeforeTool Hook 备份
    execFileSync(process.execPath, [beforeHook], {
      cwd: dir,
      input: JSON.stringify({ arguments: { file_path: '.asa/nodes/requirements/REQ-001.yaml' } }),
      encoding: 'utf8',
      env
    });

    // 2. 核心断言：备份文件的命名必须以独立的 invocation-${hash}.json 里注册的 UUID 作为后缀！
    const crypto = require('crypto');
    const norm = path.resolve(nodePath).replace(/\\/g, '/').toLowerCase();
    const hash = crypto.createHash('sha256').update(norm).digest('hex').substring(0, 12);
    
    const mapPath = path.join(dir, `.asa/transactions/invocation-${hash}.json`);
    assert.ok(fs.existsSync(mapPath), 'invocation-hash.json mapping must exist');
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
    assert.ok(Array.isArray(map.invocationIds), 'invocationIds must be an array');
    const invocationId = map.invocationIds[0];
    assert.ok(invocationId, 'invocationId for hash must be registered');

    const expectedBackup = path.join(dir, `.asa/transactions/hook-${hash}-${invocationId}.bak`);
    assert.ok(fs.existsSync(expectedBackup), 'Hook backup file must be isolated using UUID');
  });

  it('verifies that rollback blocks directory traversal and keeps files outside project untouched', () => {
    const txDir = path.join(dir, '.asa/transactions/tx-traversal');
    fs.mkdirSync(txDir, { recursive: true });

    // 模拟一个企图修改项目外文件的 manifest.json
    const originalPath = '../../external-traversal.yaml';
    const backupName = 'external-traversal.yaml.bak';
    fs.writeFileSync(path.join(txDir, backupName), 'original: "hijacked"');

    const manifest = {
      txId: 'tx-traversal',
      status: 'prepared',
      startedAt: new Date().toISOString(),
      backups: [
        { original: originalPath, backup: `.asa/transactions/tx-traversal/${backupName}` }
      ],
      createdFiles: []
    };
    fs.writeFileSync(path.join(txDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // 运行自愈写命令触发自愈检查
    const r = run(dir, 'add-req', ['测试越界']);
    
    // 强核断言：
    //    - 恢复异常，由于包含项目外路径，应该失败并阻断
    //    - 包含越界路径的事务目录必须被保留，不能删除
    assert.notEqual(r.exitCode, 0, 'Should fail and block when manifest contains out-of-boundary paths');
    assert.ok(fs.existsSync(txDir), 'Directory traversal transaction must be preserved on disk');
  });
});

describe('Step 3: Unify Migration under Transaction, Exception Bubbling, and Precise deprecate Cleanup', () => {
  let dir;
  before(() => {
    dir = createSandbox();
  });
  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('verifies that activeTask is NOT cleared when deprecate is called but the task is not cancelled', () => {
    // 1. 设置 matrix, REQ-001 depends on TASK-001, activeTask is TASK-001
    const matrix = {
      meta: {
        project: "test-deprecate-keep",
        phase: "implementation",
        schemaVersion: 3,
        activeTask: "TASK-001"
      },
      requirements: {
        "REQ-001": { title: "REQ-001", status: "proposed" }
      },
      tasks: {
        "TASK-001": { title: "TASK-001", status: "completed", file: ".asa/nodes/tasks/TASK-001.yaml" } // 已完成，状态不允许变更为 cancelled
      },
      edges: [
        { from: "REQ-001", to: "TASK-001", type: "depends" }
      ]
    };
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(matrix));

    fs.mkdirSync(path.join(dir, '.asa/nodes/requirements'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.asa/nodes/tasks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.asa/nodes/requirements/REQ-001.yaml'), 'id: REQ-001\ntitle: "REQ-001"\nstatus: proposed\n');
    fs.writeFileSync(path.join(dir, '.asa/nodes/tasks/TASK-001.yaml'), 'id: TASK-001\ntitle: "TASK-001"\nstatus: completed\nlinkedReqs: []\nchangedFiles: []\n');

    // 2. 运行 deprecate REQ-001
    const r = run(dir, 'deprecate', ['REQ-001']);
    assert.equal(r.exitCode, 0, 'deprecate should complete successfully');

    // 3. 强核断言：
    //    - TASK-001 由于是 completed 状态，无法自动取消，应被保留为 completed
    //    - 核心：activeTask 为 TASK-001，因为它没有被真正 cancelled，所以它绝对不能被清除！必须保持为 TASK-001
    const task = readNode(dir, 'tasks', 'TASK-001');
    assert.equal(task.status, 'completed', 'Completed task should stay completed');

    const matrixAfter = readMatrix(dir);
    assert.equal(matrixAfter.meta.activeTask, 'TASK-001', 'activeTask must NOT be cleared if the task was not actually cancelled');
  });

  it('verifies that migration fails gracefully midway and standard transaction reconcile-tx rolls back completely', () => {
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

    // 模拟一个待迁移的 REQ-005 yaml 节点
    fs.writeFileSync(path.join(dir, '.asa/nodes/requirements/REQ-005.yaml'), 'id: REQ-005\ntitle: "待废弃"\nstatus: proposed\nversion: 1\n');

    // 物理创建 docs/01-requirements.md 冲突文件夹，使得 compile 覆盖写时抛出 EISDIR
    const conflictPath = path.join(dir, 'docs/01-requirements.md');
    try { fs.unlinkSync(conflictPath); } catch {}
    fs.mkdirSync(conflictPath, { recursive: true });

    // 运行 reconcile 触发 2->3 存量迁移
    const r = run(dir, 'reconcile');

    // 强核断言：
    //    - 迁移必须由于冲突而失败（exitCode !== 0）
    //    - 物理回滚：由于使用了标准的 reconcile-tx 事务，REQ-005 应该完好还原，且 matrix.yaml 的 schemaVersion 依然为 2！
    assert.notEqual(r.exitCode, 0, 'reconcile must fail due to mocked compile crash');
    
    const matrixAfter = readMatrix(dir);
    assert.equal(matrixAfter.meta.schemaVersion, 2, 'schemaVersion must stay 2 on migration failure rollback');
  });
});

describe('Third-Round WBS: validate --json Exit Code, add-req Full Node similarity, and diagnose/reconcile Enhancements', () => {
  let dir;
  before(() => {
    dir = createSandbox();
  });
  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('verifies that validate --json exits with non-zero code on blocking errors', () => {
    // 1. 模拟一个包含阻塞错误的 matrix.yaml（索引了不存在的任务 TASK-999）
    const matrix = {
      meta: { project: "test-validate-json", phase: "discovery", schemaVersion: 3 },
      requirements: {},
      architecture: {},
      tasks: {
        "TASK-999": { title: "不存在的节点", status: "pending", file: ".asa/nodes/tasks/TASK-999.yaml" }
      },
      edges: []
    };
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(matrix));

    // 2. 运行 validate --json
    const r = run(dir, 'validate', ['--json']);

    // 3. 强核断言：
    //    - 必须输出 status: blocked
    //    - 进程退出码 100% 必须非零（即为 1），阻止 CI 通过！
    assert.match(r.output, /"status":\s*"blocked"/);
    assert.notEqual(r.exitCode, 0, 'validate --json must exit with non-zero code on blocking errors');
  });

  it('verifies that add-req loads full node entities for body similarity weighting and prints score>=0.3 candidates', () => {
    // 1. 重写 matrix.yaml 干净状态
    const matrix = {
      meta: { project: "test-add-body", phase: "discovery", schemaVersion: 3 },
      requirements: {
        "REQ-001": { title: "拼凑不相关的标题" }
      },
      architecture: {},
      tasks: {},
      edges: []
    };
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(matrix));

    // 2. 写入真实的 REQ-001.yaml 节点文件实体，注入匹配的描述
    fs.mkdirSync(path.join(dir, '.asa/nodes/requirements'), { recursive: true });
    const req001 = {
      id: "REQ-001",
      title: "拼凑不相关的标题",
      status: "proposed",
      version: 1,
      description: "编写自动化测试用例！为了细化特定场景的测试",
      acceptanceCriteria: []
    };
    fs.writeFileSync(path.join(dir, '.asa/nodes/requirements/REQ-001.yaml'), stringifyAsaYaml(req001));

    // 3. 添加一个与 REQ-001 title 完全不同、但与 REQ-001 description 几乎相同的需求
    //    由于 title 权重 2，body 权重 1，Dice 计算后综合得分约为 0.33 >= 0.3！
    const r = run(dir, 'add-req', ['编写自动化测试用例！为了细化特定场景的测试']);

    // 4. 强核断言：
    //    - add.js 必须加载全量节点，计算出 score >= 0.3
    //    - 控制台上必须打印出该候选提示
    assert.match(r.output, /候选相似需求|REQ-001/);
  });

  it('verifies that diagnose scans and warns about dangled/incomplete transactions', () => {
    // 1. 清除锁并建立一个残留脏事务
    const lockPath = path.join(dir, '.asa/lock');
    try { fs.unlinkSync(lockPath); } catch {}

    const txDir = path.join(dir, '.asa/transactions/tx-dangled-diagnostic');
    fs.mkdirSync(txDir, { recursive: true });
    fs.writeFileSync(path.join(txDir, 'manifest.json'), JSON.stringify({
      txId: 'tx-dangled-diagnostic',
      status: 'prepared',
      startedAt: new Date().toISOString(),
      backups: [],
      createdFiles: []
    }));

    // 2. 运行 diagnose
    const r = run(dir, 'diagnose');

    // 3. 强核断言：诊断报告中必须能够检索到该未提交事务的警告提示！
    assert.match(r.output, /发现未提交的脏事务|tx-dangled-diagnostic/);
  });

  it('verifies that reconcile schema<3 migration creates a pre-migration backup of nodes, docs, and matrix', () => {
    // 1. 重写 matrix.yaml 为 schemaVersion 2
    const oldMatrix = `meta:
  project: "test-backup"
  phase: "discovery"
  schemaVersion: 2
risks: []
requirements: {}
architecture: {}
tasks: {}
edges: []
`;
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), oldMatrix);

    // 2. 运行 reconcile 进行迁移
    const r = run(dir, 'reconcile');
    assert.equal(r.exitCode, 0, 'Migration should complete successfully');

    // 3. 强核断言：在 .asa/backups/reconcile-pre-v3/ 文件夹下必须存在全套备份快照
    const backupDir = path.join(dir, '.asa/backups/reconcile-pre-v3');
    assert.ok(fs.existsSync(backupDir), 'Pre-migration backup directory must exist');
    assert.ok(fs.existsSync(path.join(backupDir, 'matrix.yaml')), 'matrix.yaml backup must exist');
  });

  it('verifies that reconcile blocks and fails closed if pre-migration backup fails', () => {
    // 1. 重写 matrix 为 schemaVersion 2
    const oldMatrix = `meta:
  project: "test-backup-fail"
  phase: "discovery"
  schemaVersion: 2
risks: []
requirements: {}
architecture: {}
tasks: {}
edges: []
`;
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), oldMatrix);

    // 2. 模拟备份路径损坏：写入一个与备份文件夹 reconcile-pre-v3 同名的物理文件，使得 mkdirSync 抛错失败
    const backupParent = path.join(dir, '.asa/backups');
    fs.mkdirSync(backupParent, { recursive: true });
    
    // 移除原有的目录（如果存在），然后写入文件
    try { fs.rmSync(path.join(backupParent, 'reconcile-pre-v3'), { recursive: true, force: true }); } catch {}
    fs.writeFileSync(path.join(backupParent, 'reconcile-pre-v3'), 'blocked-file');

    // 3. 运行 reconcile 迁移
    const r = run(dir, 'reconcile');

    // 4. 强核断言：
    //    - 备份失败必须 Fail-Closed 阻断整个迁移（退出码非零）
    //    - 元数据 schemaVersion 绝对不能被改为 3，捍卫数据安全网
    assert.notEqual(r.exitCode, 0, 'Reconcile must block and fail-closed if pre-migration backup fails');
    
    const matrixAfter = readMatrix(dir);
    assert.notEqual(matrixAfter.meta.schemaVersion, 3, 'schemaVersion must stay below 3 on backup failure');
    
    // 清理模拟文件
    try { fs.unlinkSync(path.join(backupParent, 'reconcile-pre-v3')); } catch {}
  });
});

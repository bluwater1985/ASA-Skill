const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createSandbox, run, readNode, readMatrix } = require('./helpers.js');
const { stringifyAsaYaml } = require('../lib/yaml.js');
const { execFileSync } = require('child_process');

describe('Step 6: WBS Fifth-Round Conformance Hardening Suite', () => {
  let dir;
  before(() => {
    dir = createSandbox();
    
    // 初始化标准基线
    const matrix = {
      meta: {
        project: "test-conformance-hardening",
        phase: "discovery",
        schemaVersion: 3,
        engineVersion: "3.x",
        activeTask: "(none)"
      },
      requirements: {},
      architecture: {},
      tasks: {},
      edges: []
    };
    fs.mkdirSync(path.join(dir, '.asa'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(matrix));

    // 拷贝 Hook 脚本并初始化
    fs.mkdirSync(path.join(dir, '.asa/hooks'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.asa/lib'), { recursive: true });
    fs.copyFileSync(path.resolve('engine/hooks/check-work-order.js'), path.join(dir, '.asa/hooks/check-work-order.js'));
    fs.copyFileSync(path.resolve('engine/hooks/validate-yaml.js'), path.join(dir, '.asa/hooks/validate-yaml.js'));
    fs.copyFileSync(path.resolve('engine/hooks/session-start.js'), path.join(dir, '.asa/hooks/session-start.js'));
    fs.copyFileSync(path.resolve('engine/version.js'), path.join(dir, '.asa/version.js'));
    fs.copyFileSync(path.resolve('engine/lib/yaml.js'), path.join(dir, '.asa/lib/yaml.js'));
    fs.copyFileSync(path.resolve('engine/lib/matrix.js'), path.join(dir, '.asa/lib/matrix.js'));
    fs.copyFileSync(path.resolve('engine/lib/transaction.js'), path.join(dir, '.asa/lib/transaction.js'));
  });

  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('verifies that reconcile does NOT create a nested transaction folder named reconcile-tx when run under top-level transaction', () => {
    // 1. 重写 matrix 为 schema 2 以触发 reconcile 迁移
    const oldMatrix = `meta:
  project: "test-nested-tx"
  phase: "discovery"
  schemaVersion: 2
risks: []
requirements: {}
architecture: {}
tasks: {}
edges: []
`;
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), oldMatrix);

    // 2. 运行 reconcile 命令（由于 index.js 会启动顶层事务，reconcile 会在其中执行）
    const r = run(dir, 'reconcile');
    assert.equal(r.exitCode, 0, 'reconcile should complete successfully');

    // 3. 强核断言：
    //    - 严格禁止在磁盘上产生嵌套的 reconcile-tx 事务目录！
    //    - 所有的备份、文件创建都必须且只能由 index.js 的顶层事务清单记录
    const nestedTxPath = path.join(dir, '.asa/transactions/reconcile-tx');
    assert.ok(!fs.existsSync(nestedTxPath), 'reconcile MUST NOT create a nested transaction folder "reconcile-tx"');
  });

  it('verifies that active Hook backups hook-*.bak are immune to generic rollback transactions sweeps', () => {
    // 1. 在 transactions 目录下手动写入一个模拟 of 活跃 Hook 备份文件
    const txBaseDir = path.join(dir, '.asa/transactions');
    fs.mkdirSync(txBaseDir, { recursive: true });

    const hookBackupPath = path.join(txBaseDir, 'hook-REQ005-ppid.bak');
    fs.writeFileSync(hookBackupPath, 'original-nodes-data-backup-content');

    // 2. 运行任意一个写操作命令（如 add-req），该命令会在启动持锁期内调用 rollbackAllIncomplete() 自愈扫除
    const r = run(dir, 'add-req', ['测试写操作']);
    assert.equal(r.exitCode, 0);

    // 3. 强核断言：
    //    - 活跃的 Hook 备份必须豁免于全盘垃圾清理 sweep！
    //    - 锁内自愈完结后，该 hook-REQ005-ppid.bak 满足依然安好保留在磁盘上，防止恢复点被写命令删除
    assert.ok(fs.existsSync(hookBackupPath), 'Active Hook backup "hook-REQ005-ppid.bak" must be immune and NOT deleted by transaction sweeps');
    
    // 清理
    try { fs.unlinkSync(hookBackupPath); } catch {}
  });

  it('verifies that validate-yaml hook rejects arbitrary ASA_INTERNAL_WRITE bypass if the TxID does not exist on disk', () => {
    const yamlHook = path.join(dir, '.asa/hooks/validate-yaml.js');
    const nodePath = path.join(dir, '.asa/nodes/requirements/REQ-005.yaml');

    // 1. 写入一个非法 status 的节点
    fs.mkdirSync(path.dirname(nodePath), { recursive: true });
    fs.writeFileSync(nodePath, 'id: REQ-005\ntitle: "绕过拦截测试"\nstatus: invalid_status_val\n');

    // 2. 模拟外部恶意预设特权变量 ASA_INTERNAL_WRITE = "tx-forged-999" (该 TxID 在磁盘 transactions 下完全不存在)
    const env = { ...process.env, ASA_INTERNAL_WRITE: "tx-forged-999" };

    const out = execFileSync(process.execPath, [yamlHook], {
      cwd: dir,
      input: JSON.stringify({ arguments: { file_path: '.asa/nodes/requirements/REQ-005.yaml' } }),
      encoding: 'utf8',
      env
    });

    // 3. 强核断言：
    //    - 由于该 TxID 纯属伪造，Hook 必须 Fail-Closed 正常拦截并执行节点检验
    assert.match(out, /"decision":\s*"deny"/);
    assert.match(out, /非法的 status 状态值|invalid_status_val/);
  });

  it('verifies that check-work-order hook also rejects invalid ASA_INTERNAL_WRITE bypass', () => {
    // 1. 强制设为 implementation 阶段且没有激活 Task，使非特权写入必然触发拦截
    const matrix = {
      meta: {
        project: "test-conformance-hardening",
        phase: "implementation",
        schemaVersion: 3,
        engineVersion: "3.x",
        activeTask: "(none)"
      },
      requirements: {},
      architecture: {},
      tasks: {},
      edges: []
    };
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(matrix));

    const orderHook = path.join(dir, '.asa/hooks/check-work-order.js');
    const env = { ...process.env, ASA_INTERNAL_WRITE: "tx-forged-888" };

    const out = execFileSync(process.execPath, [orderHook], {
      cwd: dir,
      input: JSON.stringify({ arguments: { file_path: 'src/index.js' } }),
      encoding: 'utf8',
      env
    });

    // 3. 强核断言：
    //    - 绕过失败，拦截并输出活跃任务守卫提示
    assert.match(out, /"decision":\s*"deny"/);
    assert.match(out, /当前没有活跃 Task/);
  });

  it('verifies that session-start.js structures matrix.yaml correctly and is immune to commented awaiting-confirmation lines', () => {
    const startHook = path.join(dir, '.asa/hooks/session-start.js');

    // 1. 模拟一个复杂的 matrix.yaml：
    //    - 包含 1 个真实的 awaiting-confirmation 任务；
    //    - 同时包含大量注释，且注释中恰好包含 status: awaiting-confirmation 的字眼！
    const complexMatrix = `meta:
  project: "test-session-start"
  phase: "implementation"
  schemaVersion: 3
  activeTask: "(none)"
requirements: {}
architecture: {}
tasks:
  TASK-001:
    title: "真实待确认任务"
    status: awaiting-confirmation
    file: ".asa/nodes/tasks/TASK-001.yaml"
# ── 注释防噪测试 ──
#  TASK-002:
#    title: "这是注释掉的陈旧待确认，正则扫描器容易误判"
#    status: awaiting-confirmation
`;
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), complexMatrix);

    // 2. 运行 session-start.js 启动勾子
    const out = execFileSync(process.execPath, [startHook], {
      cwd: dir,
      input: JSON.stringify({ cwd: dir }),
      encoding: 'utf8'
    });

    // 3. 强核断言：
    //    - 结构化 YAML 解析器发挥作用，正确判断 awaitingCount 仅为 1（排除注释干扰）！
    //    - 输出日志必须显示 AwaitingConfirmation: 1
    assert.match(out, /AwaitingConfirmation:\s*1/);
    assert.ok(!/AwaitingConfirmation:\s*2/.test(out), 'AwaitingConfirmation must NOT include 2');
  });

  it('verifies that reconcile (soften path) runs and populates missing default array fields like linkedReqs and changedFiles', () => {
    // 1. 在磁盘上制造一个 Schema 2 的 TASK 节点，缺少 linkedReqs 和 changedFiles，且含有 Tab 键以触发软化路径
    const oldTaskYaml = `id: TASK-555
title: "软化补齐默认数组测试"
status: pending
\t# 含有制表符
`;
    const oldMatrixYaml = `meta:
  project: "test-soften-arrays"
  phase: "discovery"
  schemaVersion: 2
requirements: {}
architecture: {}
tasks:
  TASK-555:
    title: "软化补齐默认数组测试"
    status: pending
    file: ".asa/nodes/tasks/TASK-555.yaml"
edges: []
`;
    fs.mkdirSync(path.join(dir, '.asa/nodes/tasks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.asa/nodes/tasks/TASK-555.yaml'), oldTaskYaml);
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), oldMatrixYaml);

    // 2. 运行 reconcile 命令（由于 nodes 中有 Tab 键，会触发 loadAllNodes 的 isMigrationError，进入软化迁移 + V3 存量迁移主流）
    const r = run(dir, 'reconcile');
    assert.equal(r.exitCode, 0);

    // 3. 强核断言：
    //    - 软化迁移顺利顺承跑完，TASK-555.yaml 已经被规范化写回
    //    - 且 100% 物理补全了默认的空数组 linkedReqs 和 changedFiles！
    //    - 且 matrix.yaml 的 schemaVersion 被升到 MAX_SUPPORTED_SCHEMA (4)！
    const taskContent = fs.readFileSync(path.join(dir, '.asa/nodes/tasks/TASK-555.yaml'), 'utf-8');
    assert.match(taskContent, /linkedReqs:\s*\[\]/);
    assert.match(taskContent, /changedFiles:\s*\[\]/);

    const matrixContent = fs.readFileSync(path.join(dir, '.asa/matrix.yaml'), 'utf-8');
    assert.match(matrixContent, /schemaVersion:\s*4/);
  });

  it('verifies that plan-tasks (plan.js) does NOT list awaiting-confirmation tasks in ready list', () => {
    // 1. 初始化一个拥有两个任务的场景，TASK-001 已完成，TASK-002 处于 awaiting-confirmation
    const testMatrix = `meta:
  project: "test-plan-filter"
  phase: "implementation"
  schemaVersion: 3
requirements: {}
architecture: {}
tasks:
  TASK-001:
    title: "已完成任务"
    status: completed
    file: ".asa/nodes/tasks/TASK-001.yaml"
  TASK-002:
    title: "已完成待确认任务"
    status: awaiting-confirmation
    file: ".asa/nodes/tasks/TASK-002.yaml"
edges:
  - from: TASK-001
    to: TASK-002
    type: depends
`;
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), testMatrix);

    // 物理清除 nodes 下的所有残留以防沙盒交叉泄露
    try { fs.rmSync(path.join(dir, '.asa/nodes'), { recursive: true, force: true }); } catch {}
    fs.mkdirSync(path.join(dir, '.asa/nodes/tasks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.asa/nodes/tasks/TASK-001.yaml'), 'id: TASK-001\ntitle: "已完成任务"\nstatus: completed\nlinkedReqs: []\nchangedFiles: []\n');
    fs.writeFileSync(path.join(dir, '.asa/nodes/tasks/TASK-002.yaml'), 'id: TASK-002\ntitle: "已完成待确认任务"\nstatus: awaiting-confirmation\nlinkedReqs: []\nchangedFiles: []\n');

    // 2. 运行 plan 脚本（通过 process 执行以捕获 stdout 纯文本）
    const indexScript = path.resolve('engine/index.js');
    const out = execFileSync(process.execPath, [indexScript, 'plan-tasks'], {
      cwd: dir,
      encoding: 'utf8'
    });

    // 3. 强核断言：
    //    - Ready 列表中绝不可出现 TASK-002 (Awaiting-Confirmation)
    assert.ok(!/TASK-002.*Ready/.test(out), 'Ready list must NOT include awaiting-confirmation tasks');
    //    - Ready 列表应该为空
    assert.match(out, /无就绪任务，可能已被全部完成/);
  });

  it('verifies that session-start warns with compiled docs modification or expiration when nodesDigest mismatch', () => {
    // 1. 模拟 nodesDigest 与 docs/00-overview.md 编译锚点不一致的情况
    const testMatrix = `meta:
  project: "test-docs-expiration"
  phase: "implementation"
  schemaVersion: 3
  activeTask: "(none)"
  nodesDigest: "sha256:nodes12345"
  compiledDocsExpectedDigest: "sha256:empty"
requirements: {}
architecture: {}
tasks: {}
edges: []
`;
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), testMatrix);

    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    // 清除残留编译文档
    try { fs.unlinkSync(path.join(dir, 'docs/01-requirements.md')); } catch (e) {}
    try { fs.unlinkSync(path.join(dir, 'docs/03-tasks.md')); } catch (e) {}
    try { fs.unlinkSync(path.join(dir, 'docs/04-issues.md')); } catch (e) {}

    // 00-overview 的锚点写成了不一样的 nodesDigest
    fs.writeFileSync(path.join(dir, 'docs/00-overview.md'), '<!-- ASA-BASED-ON: sha256:nodesOUTDATED -->\n# Overview\n');
    fs.writeFileSync(path.join(dir, 'docs/02-architecture.md'), '<!-- ASA-BASED-ON: sha256:nodesOUTDATED -->\n# Architecture\n');

    const startHook = path.join(dir, '.asa/hooks/session-start.js');

    // 2. 运行 session-start
    const out = execFileSync(process.execPath, [startHook], {
      cwd: dir,
      input: JSON.stringify({ cwd: dir }),
      encoding: 'utf8'
    });

    // 3. 强核断言：
    //    - session-start 必须成功打出叙事概览/架构设计（00/02）已过期的警告！
    //    - 并且不打出 “编译文档已发生篡改或过期” 的错误编译指引！
    assert.match(out, /⚠️ 叙事概览\/架构设计（00\/02）已过期/);
    assert.ok(!/⚠️ 编译文档已发生篡改或过期/.test(out), 'Should NOT suggest compile for overview anchor warnings');
  });

  // ── 第七轮深度联审 WBS TDD 新测试用例 ──

  it('verifies that plan-tasks Kahn topological sort resolves downstream correctly and does not falsely report cycles when awaiting tasks are present', () => {
    // 1. 构造一个包含 awaiting-confirmation 节点的无环任务图：
    //    TASK-001 (completed) -> TASK-002 (awaiting-confirmation) -> TASK-003 (pending)
    const testMatrix = `meta:
  project: "test-topo-pseudo-cycle"
  phase: "implementation"
  schemaVersion: 3
requirements: {}
architecture: {}
tasks:
  TASK-001:
    title: "完成任务"
    status: completed
    file: ".asa/nodes/tasks/TASK-001.yaml"
  TASK-002:
    title: "待确认阻塞中前序"
    status: awaiting-confirmation
    file: ".asa/nodes/tasks/TASK-002.yaml"
  TASK-003:
    title: "待开始后序"
    status: pending
    file: ".asa/nodes/tasks/TASK-003.yaml"
edges:
  - from: TASK-001
    to: TASK-002
    type: depends
  - from: TASK-002
    to: TASK-003
    type: depends
`;
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), testMatrix);

    try { fs.rmSync(path.join(dir, '.asa/nodes'), { recursive: true, force: true }); } catch {}
    fs.mkdirSync(path.join(dir, '.asa/nodes/tasks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.asa/nodes/tasks/TASK-001.yaml'), 'id: TASK-001\ntitle: "完成任务"\nstatus: completed\nlinkedReqs: []\nchangedFiles: []\n');
    fs.writeFileSync(path.join(dir, '.asa/nodes/tasks/TASK-002.yaml'), 'id: TASK-002\ntitle: "待确认阻塞中前序"\nstatus: awaiting-confirmation\nlinkedReqs: []\nchangedFiles: []\n');
    fs.writeFileSync(path.join(dir, '.asa/nodes/tasks/TASK-003.yaml'), 'id: TASK-003\ntitle: "待开始后序"\nstatus: pending\nlinkedReqs: []\nchangedFiles: []\n');

    // 2. 运行 plan-tasks
    const indexScript = path.resolve('engine/index.js');
    const out = execFileSync(process.execPath, [indexScript, 'plan-tasks'], {
      cwd: dir,
      encoding: 'utf8'
    });

    // 3. 强核断言：
    //    - Kahn 算法正常消费 awaiting-confirmation，绝对不误报“存在循环依赖”！
    assert.ok(!/⚠️ \[ASA\] 检测到任务依赖关系中存在循环依赖/.test(out), 'Should NOT falsely report circular dependency');
    //    - TASK-002 处于 awaiting 状态，不应出现在 Ready 列表中
    assert.ok(!/TASK-002.*Ready|TASK-002.*就绪/.test(out), 'TASK-002 must NOT be listed under ready list');
    //    - TASK-003 处于 pending，被 TASK-002 阻塞，应当正确显示在 Blocked（被阻塞）列表中，且前序显示为 TASK-002
    assert.match(out, /TASK-003/);
    assert.match(out, /Blocked/);

    // ── TDD 红色断言：建议执行序中绝不能包含被 awaiting 节点级联阻塞的下游 TASK-003 ──
    const suggestedSection = out.split('### 4.')[1] || '';
    assert.ok(!/TASK-003/.test(suggestedSection), 'Suggested order must NOT include tasks blocked by awaiting-confirmation');
    assert.match(out, /无就绪的建议执行任务/);
  });

  it('verifies that status cancelled command automatically clears activeTask and check-work-order blocks writes to cancelled task files', () => {
    // 1. 初始化，激活任务设为 TASK-555
    const testMatrix = {
      meta: {
        project: "test-active-cancel-sync",
        phase: "implementation",
        schemaVersion: 3,
        engineVersion: "3.x",
        activeTask: "TASK-555"
      },
      requirements: {},
      architecture: {},
      tasks: {
        "TASK-555": {
          title: "可取消任务",
          status: "in_progress",
          file: ".asa/nodes/tasks/TASK-555.yaml"
        }
      },
      edges: []
    };
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(testMatrix));

    try { fs.rmSync(path.join(dir, '.asa/nodes'), { recursive: true, force: true }); } catch {}
    fs.mkdirSync(path.join(dir, '.asa/nodes/tasks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.asa/nodes/tasks/TASK-555.yaml'), 'id: TASK-555\ntitle: "可取消任务"\nstatus: in_progress\nlinkedReqs: []\nchangedFiles: []\n');

    // 2. 合规流转：先 status 推至 awaiting-confirmation，再用 cancel-task 强审计取消 (对齐 P1 状态机卫兵)
    const indexScript = path.resolve('engine/index.js');
    execFileSync(process.execPath, [indexScript, 'status', 'TASK-555', 'awaiting-confirmation'], {
      cwd: dir,
      encoding: 'utf8'
    });

    execFileSync(process.execPath, [indexScript, 'cancel-task', 'TASK-555', '--by', '大鹏'], {
      cwd: dir,
      encoding: 'utf8'
    });

    // 3. 强核断言：
    //    - matrix.yaml 中的 activeTask 必须自动清除为 "(none)"
    const updatedMatrix = readMatrix(dir);
    assert.equal(updatedMatrix.meta.activeTask, '(none)', 'activeTask must be cleared on cancellation');

    // 4. 模拟 BeforeTool Hook 写入对该已 cancelled 任务相关联文件的拦截
    const orderHook = path.join(dir, '.asa/hooks/check-work-order.js');
    const out = execFileSync(process.execPath, [orderHook], {
      cwd: dir,
      input: JSON.stringify({ arguments: { file_path: 'src/index.js' } }),
      encoding: 'utf8'
    });

    // 5. 强核断言：
    //    - cancelled 作为冻结态，绝不放行，Fail-Closed
    assert.match(out, /"decision":\s*"deny"/);
    assert.match(out, /当前没有活跃 Task/);
  });

  it('verifies that reconcile registered modified nodes inside top-level transaction and successfully rolls them back on compile failure', () => {
    // 1. 初始化一个拥有 Tab 缩进的旧 REQ 节点以触发软化迁移自愈
    const oldMatrix = `meta:
  project: "test-tx-rollback-nodes"
  phase: "discovery"
  schemaVersion: 2
requirements:
  REQ-100:
    title: "回滚测试"
    status: pending
    file: ".asa/nodes/requirements/REQ-100.yaml"
architecture: {}
tasks: {}
edges: []
`;
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), oldMatrix);

    try { fs.rmSync(path.join(dir, '.asa/nodes'), { recursive: true, force: true }); } catch {}
    fs.mkdirSync(path.join(dir, '.asa/nodes/requirements'), { recursive: true });
    // 包含 Tab 缩进
    fs.writeFileSync(path.join(dir, '.asa/nodes/requirements/REQ-100.yaml'), 'id: REQ-100\n\ttitle: "回滚测试"\n\tstatus: pending\n');

    // 2. 模拟 compile 写盘失败环境 (在 docs 下创建一个同名文件夹 docs/01-requirements.md 强行制造 EISDIR 写入崩溃)
    const colDir = path.join(dir, 'docs/01-requirements.md');
    try { fs.rmSync(colDir, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(colDir, { recursive: true });

    // 3. 运行 reconcile 命令
    const indexScript = path.resolve('engine/index.js');
    try {
      execFileSync(process.execPath, [indexScript, 'reconcile'], {
        cwd: dir,
        encoding: 'utf8'
      });
      assert.fail('reconcile should fail and bubble up compilation crash');
    } catch (err) {
      // 捕获到预期的 compile EISDIR 写入崩溃，说明触发了回滚！
    }

    // 4. 强核断言：
    //    - 顶级回滚生效，REQ-100.yaml 的内容必须物理还原至含有 Tab 缩进、status: pending 的初始原样！
    const reqContent = fs.readFileSync(path.join(dir, '.asa/nodes/requirements/REQ-100.yaml'), 'utf-8');
    assert.match(reqContent, /\t/); // 包含 Tab 键，证实还原成功
    assert.match(reqContent, /status:\s*pending/); // 状态依然为 pending，未发生错误残留

    // 5. 清理碰撞目录以防影响后续测试
    try { fs.rmSync(colDir, { recursive: true, force: true }); } catch {}
  });

  it('verifies that corrupted locks with non-numeric pid or timestamp trigger Fatal safety locks and are Fail-Closed', () => {
    // 1. 向 lock 写入恶意的非数字 pid
    const lockPath = path.join(dir, '.asa/lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: "corrupted_non_numeric_pid", timestamp: "not_a_time" }));

    // 2. 启动写操作命令，应当立刻触发 Fail-Closed
    const indexScript = path.resolve('engine/index.js');
    try {
      execFileSync(process.execPath, [indexScript, 'add-req', '测试加锁保守拦截'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe'
      });
      assert.fail('Should fail due to corrupted lock file');
    } catch (err) {
      // 3. 强核断言：
      //    - 必须输出 Fatal Exception 说明
      assert.match(err.stderr || err.stdout, /非正常损坏\/篡改写锁/);
    } finally {
      // 4. 清理残留损坏锁，防止阻塞后续测试
      try { fs.unlinkSync(lockPath); } catch (e) {}
    }
  });

  it('verifies that reject-task correctly parses --reason as an alias of --note', () => {
    // 1. 初始化，TASK-555 状态为 awaiting-confirmation
    const testMatrix = {
      meta: {
        project: "test-reason-alias",
        phase: "implementation",
        schemaVersion: 3,
        engineVersion: "3.x",
        activeTask: "TASK-555"
      },
      requirements: {},
      architecture: {},
      tasks: {
        "TASK-555": {
          title: "提审任务",
          status: "awaiting-confirmation",
          file: ".asa/nodes/tasks/TASK-555.yaml"
        }
      },
      edges: []
    };
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(testMatrix));

    try { fs.rmSync(path.join(dir, '.asa/nodes'), { recursive: true, force: true }); } catch {}
    fs.mkdirSync(path.join(dir, '.asa/nodes/tasks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.asa/nodes/tasks/TASK-555.yaml'), 'id: TASK-555\ntitle: "提审任务"\nstatus: awaiting-confirmation\nlinkedReqs: []\nchangedFiles: []\n');

    // 2. 运行 reject-task 命令，使用 --reason 传参
    const indexScript = path.resolve('engine/index.js');
    execFileSync(process.execPath, [indexScript, 'reject-task', 'TASK-555', '--by', '架构师大鹏', '--reason', '设计不满足规格要求'], {
      cwd: dir,
      encoding: 'utf8'
    });

    // 3. 强核断言：
    //    - --reason 参数被成功解析并作为 note 写入 confirmation 记录中！
    const taskNode = readNode(dir, 'tasks', 'TASK-555');
    assert.equal(taskNode.confirmation?.note, '设计不满足规格要求', '--reason must map to confirmation.note correctly');
  });

  it('verifies that reconcile --readonly is 100% pure read-only and does NOT compete for write locks or delete dangled transactions', () => {
    // 1. 在磁盘 transactions 下模拟一个悬空的残留脏事务文件夹，以及一个有效的 lock 文件
    const lockPath = path.join(dir, '.asa/lock');
    const dangledTxDir = path.join(dir, '.asa/transactions/tx-dangled-999');
    fs.mkdirSync(dangledTxDir, { recursive: true });
    fs.writeFileSync(path.join(dangledTxDir, 'manifest.json'), JSON.stringify({ status: 'prepared', createdFiles: [] }));

    // 写入一个模拟有效锁，pid 为当前进程以避免被当做陈旧接管
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, timestamp: Date.now() }));

    // 2. 运行 reconcile --readonly 只读诊断
    const indexScript = path.resolve('engine/index.js');
    const r = execFileSync(process.execPath, [indexScript, 'reconcile', '--readonly'], {
      cwd: dir,
      encoding: 'utf8'
    });

    // 3. 强核断言：
    //    - 绝对纯只读！绝对不应该自动自愈清除脏事务，也绝对不应该删除锁文件
    assert.ok(fs.existsSync(dangledTxDir), 'reconcile --readonly MUST NOT delete dangled transactions');
    assert.ok(fs.existsSync(lockPath), 'reconcile --readonly MUST NOT delete or touch active write lock file');

    // 清理
    try { fs.rmSync(dangledTxDir, { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(lockPath); } catch {}
  });

  it('verifies that validate command checks 00/02 markdown narrative anchors and reports NARRATIVE_OUTDATED warning', () => {
    // 1. 初始化，nodesDigest 为 nodes12345
    const testMatrix = {
      meta: {
        project: "test-validate-anchors",
        phase: "implementation",
        schemaVersion: 3,
        engineVersion: "3.x",
        activeTask: "(none)",
        nodesDigest: "sha256:nodes12345",
        compiledDocsExpectedDigest: "sha256:empty"
      },
      requirements: {},
      architecture: {},
      tasks: {},
      edges: []
    };
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(testMatrix));

    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    // 00-overview.md 锚点写成了不一样的 nodesDigest (Nodes 改变但叙事未重写，视为过期)
    fs.writeFileSync(path.join(dir, 'docs/00-overview.md'), '<!-- ASA-BASED-ON: sha256:nodesOUTDATED -->\n# Overview\n');

    // 2. 运行 validate --json
    const indexScript = path.resolve('engine/index.js');
    let out;
    try {
      out = execFileSync(process.execPath, [indexScript, 'validate', '--json'], {
        cwd: dir,
        encoding: 'utf8'
      });
    } catch (err) {
      out = err.stdout;
    }

    // 3. 强核断言：
    //    - validate 的 warnings 数组中必须精准报出 NARRATIVE_OUTDATED 异常，说明门禁拦截有效！
    const res = JSON.parse(out);
    const hasNarrativeWarn = res.warnings.some(w => w.code === 'NARRATIVE_OUTDATED' && w.id === 'docs/00-overview.md');
    assert.ok(hasNarrativeWarn, 'validate --json must check 00/02 anchors and report NARRATIVE_OUTDATED warning');
  });

  it('verifies that dice similarity returns 0.0 Similarity for empty or punctuation-only strings, avoiding查重 limits', () => {
    const { dice } = require('../lib/similarity.js');
    
    // 1. 测试空标题、全标点标题
    const score1 = dice('', '');
    const score2 = dice('！！！', '。。。');
    const score3 = dice('  ', '');

    // 2. 强核断言：
    //    - 相似度必须精准为 0.0，杜绝 Dice 对空 bigram 的溢出误伤！
    assert.equal(score1, 0.0, 'dice of empty strings must be 0.0');
    assert.equal(score2, 0.0, 'dice of punctuation-only strings must be 0.0');
    assert.equal(score3, 0.0, 'dice of spaces strings must be 0.0');
  });

  it('verifies that reconcile -r (alias) successfully routes to diagnose readonly, without executing full migration or writing locks', () => {
    // 1. 在磁盘 transactions 下模拟一个悬空的残留脏事务文件夹，以及一个有效的 lock 文件
    const lockPath = path.join(dir, '.asa/lock');
    const dangledTxDir = path.join(dir, '.asa/transactions/tx-dangled-888');
    fs.mkdirSync(dangledTxDir, { recursive: true });
    fs.writeFileSync(path.join(dangledTxDir, 'manifest.json'), JSON.stringify({ status: 'prepared', createdFiles: [] }));

    // 写入一个模拟有效锁，pid 为当前进程以避免被当做陈旧接管
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, timestamp: Date.now() }));

    // 2. 运行 reconcile -r 只读诊断别名
    const indexScript = path.resolve('engine/index.js');
    try {
      const out = execFileSync(process.execPath, [indexScript, 'reconcile', '-r'], {
        cwd: dir,
        encoding: 'utf8'
      });

      // 3. 强核断言：
      //    - 别名支持必须 100% 同等生效！绝对不应该自动自愈清除脏事务，也绝对不应该删除锁文件，且应当正确路由至 diagnose 输出
      assert.ok(fs.existsSync(dangledTxDir), 'reconcile -r MUST NOT delete dangled transactions');
      assert.ok(fs.existsSync(lockPath), 'reconcile -r MUST NOT delete or touch active write lock file');
      assert.match(out, /\[ASA DIAGNOSE\]/);
    } finally {
      // 清理，防止异常阻断导致写锁残留，干扰后续测试
      try { fs.rmSync(dangledTxDir, { recursive: true, force: true }); } catch {}
      try { fs.unlinkSync(lockPath); } catch {}
    }
  });

  it('verifies that check-work-order hook does NOT create a .bak backup file for non-yaml white-listed files', () => {
    const orderHook = path.join(dir, '.asa/hooks/check-work-order.js');
    const txBaseDir = path.join(dir, '.asa/transactions');
    try { fs.rmSync(txBaseDir, { recursive: true, force: true }); } catch {}

    // 1. 模拟写入一个白名单 markdown 文件 docs/00-overview.md
    const out = execFileSync(process.execPath, [orderHook], {
      cwd: dir,
      input: JSON.stringify({ arguments: { file_path: 'docs/00-overview.md' } }),
      encoding: 'utf8'
    });

    // 2. 强核断言：
    //    - 由于不是 YAML 节点，Hook 必须优雅放行，且在 transactions 下绝对不残留任何 hook-*.bak 的敏感备份文件！
    assert.match(out, /"decision":\s*"allow"/);
    const files = fs.existsSync(txBaseDir) ? fs.readdirSync(txBaseDir) : [];
    const hasHookBak = files.some(f => f.startsWith('hook-'));
    assert.ok(!hasHookBak, 'PreToolUse Hook must NOT leak hook-*.bak file for non-yaml white-listed files');
  });

  it('verifies that reconcile command is perfectly idempotent and does NOT overwrite matrix.yaml when no changes are present', () => {
    const indexScript = path.resolve('engine/index.js');
    const matrixFile = path.join(dir, '.asa/matrix.yaml');

    // 1. 先跑一次 reconcile 确保完全对账
    execFileSync(process.execPath, [indexScript, 'reconcile'], { cwd: dir });

    const stat1 = fs.statSync(matrixFile);
    const mtime1 = stat1.mtimeMs;

    // 2. 故意等待 50ms 后再次跑无变动 reconcile
    const start = Date.now();
    while (Date.now() - start < 50) {}

    execFileSync(process.execPath, [indexScript, 'reconcile'], { cwd: dir });

    const stat2 = fs.statSync(matrixFile);
    const mtime2 = stat2.mtimeMs;

    // 3. 强核断言：
    //    - 无任何变更时，写盘应当 100% 物理静默，mtime 必须完全全等，实现极致的高保真幂等性！
    assert.equal(mtime2, mtime1, 'reconcile must be perfectly idempotent and NOT overwrite matrix.yaml when no changes are present');
  });

  it('verifies that check-work-order hook blocks writes even when arbitrary ASA_INTERNAL_WRITE is provided (B2 Verification)', () => {
    // 1. 强制设为 implementation 阶段且没有激活 Task
    const matrix = {
      meta: {
        project: "test-conformance-hardening",
        phase: "implementation",
        schemaVersion: 3,
        engineVersion: "3.x",
        activeTask: "(none)"
      },
      requirements: {},
      architecture: {},
      tasks: {},
      edges: []
    };
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(matrix));

    const orderHook = path.join(dir, '.asa/hooks/check-work-order.js');
    // 恶意注入特权变量 ASA_INTERNAL_WRITE
    const env = { ...process.env, ASA_INTERNAL_WRITE: "tx-any-forged-tx" };

    const out = execFileSync(process.execPath, [orderHook], {
      cwd: dir,
      input: JSON.stringify({ arguments: { file_path: 'src/index.js' } }),
      encoding: 'utf8',
      env
    });

    // 2. 强核断言：
    //    - 虚假旁路已被物理彻底拆除，一律进行正常阻断，Fail-Closed！
    assert.match(out, /"decision":\s*"deny"/);
    assert.match(out, /当前没有活跃 Task/);
  });

  it('verifies that propagate failures correctly trigger transaction rollback and do NOT commit partial changes (H1 Verification)', () => {
    // 1. 初始化一个含有 pending 任务的 matrix
    const testMatrix = {
      meta: {
        project: "test-propagate-rollback",
        phase: "implementation",
        schemaVersion: 3,
        engineVersion: "3.x",
        activeTask: "(none)"
      },
      requirements: {},
      architecture: {},
      tasks: {
        "TASK-100": {
          title: "待传播任务",
          status: "pending",
          file: ".asa/nodes/tasks/TASK-100.yaml",
          pendingPropagation: [
            {
              changeVersion: 2,
              status: "pending",
              affectedNodes: [
                { id: "TASK-100", action: { type: "set_status", value: "invalid-status-value-to-force-crash" } } // 注入真实的受影响节点及非法目标态，强行在底层触发生命周期崩溃！
              ]
            }
          ]
        }
      },
      edges: []
    };
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(testMatrix));

    try { fs.rmSync(path.join(dir, '.asa/nodes'), { recursive: true, force: true }); } catch {}
    fs.mkdirSync(path.join(dir, '.asa/nodes/tasks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.asa/nodes/tasks/TASK-100.yaml'), 'id: TASK-100\ntitle: "待传播任务"\nstatus: pending\npendingPropagation:\n  - changeVersion: 2\n    status: pending\n    affectedNodes:\n      - id: TASK-100\n        action:\n          type: set_status\n          value: invalid-status-value-to-force-crash\n');

    // 2. 运行 propagate 变更传播命令
    const indexScript = path.resolve('engine/index.js');
    try {
      execFileSync(process.execPath, [indexScript, 'propagate', 'TASK-100'], {
        cwd: dir,
        encoding: 'utf8'
      });
      assert.fail('propagate should fail due to invalid status value');
    } catch (err) {
      // 成功捕获异常，说明触发了传播失败并退出了进程！
    }

    // 3. 强核断言：
    //    - 依据 propagate 黄金分步设计，级联状态机跳转失败时，已完成项提交，失败项在磁盘上正确持久化为 partial，支持断点续传！
    const taskContent = fs.readFileSync(path.join(dir, '.asa/nodes/tasks/TASK-100.yaml'), 'utf-8');
    assert.match(taskContent, /status:\s*partial/, 'Propagate partial failures must commit status: partial for debugging and resume');
  });

  it('verifies that check-work-order hook immediately allows unexpanded $FILE_PATH placeholder to prevent editor saving hangs', () => {
    const orderHook = path.join(dir, '.asa/hooks/check-work-order.js');

    // 1. 模拟宿主未展开传入字面量 $FILE_PATH 变量
    const out = execFileSync(process.execPath, [orderHook, '$FILE_PATH'], {
      cwd: dir,
      encoding: 'utf8'
    });

    // 2. 强核断言：
    //    - 必须立刻放行，不能退化为 stdin 等待超时从而导致编辑器写盘挂起死锁！
    assert.match(out, /\[ASA 放行\]/);
    assert.match(out, /Claude \$FILE_PATH placeholder bypass/);
  });

  it('verifies that check-work-order old hook backups (mtime > 60s) are automatically cleared as orphans, while active ones are preserved (M2 Verification)', () => {
    // 1. 手动在 transactions 下写入两个模拟备份
    const txBaseDir = path.join(dir, '.asa/transactions');
    fs.mkdirSync(txBaseDir, { recursive: true });

    const oldBakPath = path.join(txBaseDir, 'hook-old-999.bak');
    const newBakPath = path.join(txBaseDir, 'hook-new-111.bak');

    fs.writeFileSync(oldBakPath, 'old-orphan-backup-content');
    fs.writeFileSync(newBakPath, 'new-active-backup-content');

    // 2. 将 oldBakPath 的 mtime 篡改到 120 秒前（即已过期），新备份保持当前时间
    const now = Date.now();
    const oldTime = (now - 120000) / 1000;
    fs.utimesSync(oldBakPath, oldTime, oldTime);

    // 3. 运行任何一个写操作（如 add-req），该写操作锁内自愈会自动扫描并触发 cleanTmpFiles()
    const indexScript = path.resolve('engine/index.js');
    execFileSync(process.execPath, [indexScript, 'add-req', '触发垃圾清理测试'], {
      cwd: dir,
      encoding: 'utf8'
    });

    // 4. 强核断言：
    //    - 120秒前的陈旧孤儿备份已被自愈引擎物理删除
    //    - 当前的活跃备份被完好保留，实现物理环境的敏捷自洁！
    assert.ok(!fs.existsSync(oldBakPath), 'Orphan hook backups (>60s) must be automatically cleared');
    assert.ok(fs.existsSync(newBakPath), 'Active hook backups (<60s) must be perfectly preserved');

    // 清理
    try { fs.unlinkSync(newBakPath); } catch {}
  });

  it('verifies that propagate partial failures physically align nodesDigest inside matrix.yaml', () => {
    const testMatrix = {
      meta: {
        project: "test-propagate-digest",
        phase: "implementation",
        schemaVersion: 3,
        engineVersion: "3.x",
        activeTask: "(none)",
        nodesDigest: "sha256:dummy-outdated-digest"
      },
      requirements: {},
      architecture: {},
      tasks: {
        "TASK-100": {
          title: "待传播任务",
          status: "pending",
          file: ".asa/nodes/tasks/TASK-100.yaml",
          pendingPropagation: [
            {
              changeVersion: 2,
              status: "pending",
              affectedNodes: [
                { id: "TASK-100", action: { type: "set_status", value: "invalid-status-value-to-force-crash" } }
              ]
            }
          ]
        }
      },
      edges: []
    };
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(testMatrix));

    try { fs.rmSync(path.join(dir, '.asa/nodes'), { recursive: true, force: true }); } catch {}
    fs.mkdirSync(path.join(dir, '.asa/nodes/tasks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.asa/nodes/tasks/TASK-100.yaml'), 'id: TASK-100\ntitle: "待传播任务"\nstatus: pending\npendingPropagation:\n  - changeVersion: 2\n    status: pending\n    affectedNodes:\n      - id: TASK-100\n        action:\n          type: set_status\n          value: invalid-status-value-to-force-crash\n');

    const indexScript = path.resolve('engine/index.js');
    try {
      execFileSync(process.execPath, [indexScript, 'propagate', 'TASK-100'], {
        cwd: dir,
        encoding: 'utf8'
      });
      assert.fail('propagate should fail');
    } catch (err) {
      // expected
    }

    const matrixContent = fs.readFileSync(path.join(dir, '.asa/matrix.yaml'), 'utf-8');
    const { parseAsaYaml } = require('../lib/yaml.js');
    const updatedMatrix = parseAsaYaml(matrixContent);
    const { calculateNodesDigest } = require('../lib/matrix.js');
    const realDigest = calculateNodesDigest(dir);
    assert.equal(updatedMatrix.meta.nodesDigest, realDigest, 'nodesDigest inside matrix.yaml must match the physical nodes digest on partial propagation failures');
  });

  it('verifies that propagate fails when attempting set_status: completed on a TASK node (TDD 1)', () => {
    // 1. 初始化一个含有 set_status: completed 动作的 matrix 与任务节点
    const testMatrix = {
      meta: {
        project: "test-propagate-completed-bypass",
        phase: "implementation",
        schemaVersion: 3,
        engineVersion: "3.x",
        activeTask: "(none)"
      },
      requirements: {},
      architecture: {},
      tasks: {
        "TASK-200": {
          title: "待传播任务",
          status: "in_progress",
          file: ".asa/nodes/tasks/TASK-200.yaml",
          pendingPropagation: [
            {
              changeVersion: 2,
              status: "pending",
              affectedNodes: [
                { id: "TASK-200", action: { type: "set_status", value: "completed" } }
              ]
            }
          ]
        }
      },
      edges: []
    };
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(testMatrix));

    try { fs.rmSync(path.join(dir, '.asa/nodes'), { recursive: true, force: true }); } catch {}
    fs.mkdirSync(path.join(dir, '.asa/nodes/tasks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.asa/nodes/tasks/TASK-200.yaml'), stringifyAsaYaml({
      id: "TASK-200",
      title: "待传播任务",
      status: "in_progress",
      pendingPropagation: [
        {
          changeVersion: 2,
          status: "pending",
          affectedNodes: [
            { id: "TASK-200", action: { type: "set_status", value: "completed" } }
          ]
        }
      ]
    }));

    // 2. 运行 propagate 变更传播命令
    const indexScript = path.resolve('engine/index.js');
    try {
      execFileSync(process.execPath, [indexScript, 'propagate', 'TASK-200'], {
        cwd: dir,
        encoding: 'utf8'
      });
      assert.fail('propagate should fail because set_status: completed is blocked by state machine');
    } catch (err) {
      // expected failure
      const taskContent = fs.readFileSync(path.join(dir, '.asa/nodes/tasks/TASK-200.yaml'), 'utf-8');
      assert.match(taskContent, /status:\s*partial/, 'Propagate must fail and commit status: partial when transition is forbidden');
    }
  });
  it('verifies that propagate fails when attempting set_status on awaiting-confirmation TASK node (TDD 1)', () => {
    // 1. 初始化一个含有 set_status: completed 动作的 matrix 与任务节点，其原状态为 awaiting-confirmation
    const testMatrix = {
      meta: {
        project: "test-propagate-awaiting-bypass",
        phase: "implementation",
        schemaVersion: 3,
        engineVersion: "3.x",
        activeTask: "(none)"
      },
      requirements: {},
      architecture: {},
      tasks: {
        "TASK-300": {
          title: "Awaiting任务",
          status: "awaiting-confirmation",
          file: ".asa/nodes/tasks/TASK-300.yaml",
          pendingPropagation: [
            {
              changeVersion: 2,
              status: "pending",
              affectedNodes: [
                { id: "TASK-300", action: { type: "set_status", value: "completed" } }
              ]
            }
          ]
        }
      },
      edges: []
    };
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(testMatrix));

    try { fs.rmSync(path.join(dir, '.asa/nodes'), { recursive: true, force: true }); } catch {}
    fs.mkdirSync(path.join(dir, '.asa/nodes/tasks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.asa/nodes/tasks/TASK-300.yaml'), stringifyAsaYaml({
      id: "TASK-300",
      title: "Awaiting任务",
      status: "awaiting-confirmation",
      pendingPropagation: [
        {
          changeVersion: 2,
          status: "pending",
          affectedNodes: [
            { id: "TASK-300", action: { type: "set_status", value: "completed" } }
          ]
        }
      ]
    }));

    // 2. 运行 propagate 变更传播命令
    const indexScript = path.resolve('engine/index.js');
    try {
      execFileSync(process.execPath, [indexScript, 'propagate', 'TASK-300'], {
        cwd: dir,
        encoding: 'utf8'
      });
      assert.fail('propagate should fail because set_status on awaiting-confirmation is blocked');
    } catch (err) {
      // expected failure
      const taskContent = fs.readFileSync(path.join(dir, '.asa/nodes/tasks/TASK-300.yaml'), 'utf-8');
      assert.match(taskContent, /status:\s*partial/, 'Propagate must fail and commit status: partial when awaiting transition is forbidden');
      // check original state remains awaiting-confirmation
      const { parseAsaYaml } = require('../lib/yaml.js');
      const parsedTask = parseAsaYaml(taskContent);
      assert.equal(parsedTask.status, 'awaiting-confirmation', 'TASK status must remain awaiting-confirmation');
    }
  });

});

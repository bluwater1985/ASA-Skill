// .asa/index.js — ASA v3 CLI 路由（零外部依赖）
const { run: compile } = require('./commands/compile.js');
const { run: patch } = require('./commands/patch.js');
const { run: traverse } = require('./commands/traverse.js');
const { run: reconcile } = require('./commands/reconcile.js');
const { run: validate } = require('./commands/validate.js');
const { run: status } = require('./commands/status.js');
const { run: impact } = require('./commands/impact.js');
const { run: edge } = require('./commands/edge.js');
const { run: propagate } = require('./commands/propagate.js');
const { run: change } = require('./commands/change.js');
const { run: deprecate } = require('./commands/deprecate.js');
const { run: addNode } = require('./commands/add.js');
const { run: journal } = require('./commands/journal.js');
const { run: history } = require('./commands/history.js');
const { run: setMeta } = require('./commands/set.js');
const { run: cancelTask } = require('./commands/cancel.js');
const { run: confirmTask } = require('./commands/confirm.js');
const { run: rejectTask } = require('./commands/reject.js');
const { run: search } = require('./commands/search.js');
const { run: list } = require('./commands/list.js');
const { run: linkTask } = require('./commands/link.js');
const { run: recordChanges } = require('./commands/record-changes.js');
const { run: planTasks } = require('./commands/plan.js');
const { run: overview } = require('./commands/overview.js');
const { run: diagnose } = require('./commands/diagnose.js');
const { run: doctor } = require('./commands/doctor.js');
const { acquireLock, releaseLock } = require('./lib/lock.js');

const writeCommands = new Set([
  'compile', 'patch', 'reconcile', 'status', 'deprecate',
  'edge', 'propagate', 'change-req', 'change-arch', 'change-task',
  'add-req', 'add-arch', 'add-task', 'set',
  'confirm-task', 'reject-task', 'cancel-task', 'link-task', 'record-changes'
]);

const [,, command, ...args] = process.argv;
let isWrite = writeCommands.has(command);

// reconcile 携带 --readonly 或 -r 只读运行时，强行剥离 isWrite，使其完全免除写锁与自愈，物理环境保持 100% 只读 (N1 修复)
if (command === 'reconcile' && (process.argv.includes('--readonly') || process.argv.includes('-r'))) {
  isWrite = false;
}

if (isWrite) {
  process.on('exit', () => {
    releaseLock();
  });
  process.on('SIGINT', () => {
    process.exit(130);
  });
}

let txId = null;

// 全局拦截 process.exit，确保在任何命令调用 process.exit 强行终止时，事务均能安全提交或原子回滚
const originalExit = process.exit;
process.exit = (code) => {
  if (isWrite && txId) {
    const { rollbackTransaction, commitTransaction, markCommitting } = require('./lib/transaction.js');
    try {
      if (code !== 0 && command !== 'propagate') {
        rollbackTransaction(txId);
      } else {
        markCommitting(txId);
        commitTransaction(txId);
      }
    } catch (e) {
      console.error(`[ASA] ❌ 事务安全退出捕获异常: ${e.message}`);
    }
  }
  originalExit(code);
};

try {
  const { rollbackAllIncomplete, beginTransaction, commitTransaction, rollbackTransaction, markCommitting } = require('./lib/transaction.js');
  
  if (isWrite) {
    acquireLock();

    // 启动自愈：扫描并回滚未提交的脏事务，已置于排他锁保护期内，解决写锁进程竞争
    rollbackAllIncomplete();

    // 检查 schemaVersion 是否超过引擎最大支持
    const { MAX_SUPPORTED_SCHEMA } = require('./version.js');
    const { loadMatrix } = require('./lib/matrix.js');
    let matrix;
    try {
      matrix = loadMatrix();
    } catch (e) {
      matrix = null;
    }
    if (matrix && matrix.meta && matrix.meta.schemaVersion > MAX_SUPPORTED_SCHEMA) {
      throw new Error(`[ASA] ❌ 引擎版本过低，无法安全修改更高 Schema 版本（${matrix.meta.schemaVersion}）的项目，请升级全局 ASA 引擎。`);
    }

    // 开启事务
    txId = beginTransaction();
  }

  switch (command) {
    // Phase 0: 基础
    case 'reconcile':
      reconcile(args);
      break;
    case 'compile':
      compile();
      break;
    case 'patch':
      patch();
      break;
    case 'validate':
      validate(args);
      break;

    // Phase 1: 状态与演进
    case 'status':
      status(args[0], args[1]);
      break;
    case 'deprecate':
      deprecate(args[0]);
      break;
    case 'edge':
      edge(args);
      break;

    // Phase 2: 变更影响与传播
    case 'impact':
      impact(args[0]);
      break;
    case 'propagate':
      propagate(args[0]);
      break;
    case 'change-req':
    case 'change-arch':
    case 'change-task':
      change(command, args[0]);
      break;

    // Phase 3: 节点管理
    case 'add-req':
      addNode('req', args);
      break;
    case 'add-arch':
      addNode('arch', args);
      break;
    case 'add-task':
      addNode('task', args);
      break;
    case 'journal':
      journal();
      break;
    case 'history':
      history(args[0]);
      break;
    case 'set':
      setMeta(args[0], args[1]);
      break;
    case 'traverse':
      traverse(args[0]);
      break;

    // Task lifecycle
    case 'confirm-task':
      confirmTask(args);
      break;
    case 'reject-task':
      rejectTask(args);
      break;
    case 'cancel-task':
      cancelTask(args);
      break;

    // Phase 4: 开发协同
    case 'search-req':
      search(args[0]);
      break;
    case 'list-req':
      list('req');
      break;
    case 'list-arch':
      list('arch');
      break;
    case 'list-task':
      list('task');
      break;
    case 'link-task':
      linkTask(args);
      break;
    case 'record-changes':
      recordChanges(args);
      break;
    case 'plan-tasks':
      planTasks(args);
      break;
    case 'update-overview':
      overview();
      break;
    case 'diagnose':
      diagnose();
      break;
    case 'doctor':
      doctor();
      break;

    default:
      if (command) {
        console.error(`[ASA] ❌ 未知命令: ${command}`);
      }
      console.log(`用法: node .asa/index.js <command> [args]
具体用法请参阅 docs/RUNBOOK.md`);
      process.exit(1);
  }

  if (isWrite && txId) {
    commitTransaction(txId);
    txId = null;
  }
} catch (err) {
  if (isWrite && txId) {
    try {
      const { rollbackTransaction } = require('./lib/transaction.js');
      rollbackTransaction(txId);
    } catch (e) {
      console.error(`[ASA] ❌ 崩溃回滚事务异常: ${e.message}`);
    }
  }
  console.error(`[ASA] ❌ ${err.message}`);
  process.exit(1);
}

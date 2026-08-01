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

const [,, command, ...args] = process.argv;

try {
  switch (command) {
    // Phase 0: 基础
    case 'compile':   compile(); break;
    case 'patch':     patch(); break;
    case 'traverse':  traverse(args[0]); break;
    case 'reconcile': reconcile(); break;
    case 'validate':  validate(); break;
    // Phase 2: Core
    case 'status':    status(args[0], args[1]); break;
    case 'impact':    impact(args[0]); break;
    case 'edge':      edge(args); break;
    // Phase 3: 传播链
    case 'propagate':   propagate(args[0]); break;
    case 'change-req':  change('change-req', args[0]); break;
    case 'change-arch': change('change-arch', args[0]); break;
    case 'change-task': change('change-task', args[0]); break;
    case 'deprecate':   deprecate(args[0]); break;
    // Phase 4-6: 增删改查 + 工作流
    case 'add-req':     addNode('req', args); break;
    case 'add-arch':    addNode('arch', args); break;
    case 'add-task':    addNode('task', args); break;
    case 'journal':     journal(); break;
    case 'history':     history(args[0]); break;
    case 'set':         setMeta(args[0], args[1]); break;
    default:
      console.log('ASA CLI v3 — 用法:');
      console.log('  基础:   compile | patch | traverse <id> | reconcile | validate');
      console.log('  状态:   status <id> <new-status> | deprecate <id>');
      console.log('  影响:   impact <id> | propagate <id>');
      console.log('  变更:   change-req|change-arch|change-task <id>');
      console.log('  新增:   add-req <title> | add-arch <title> | add-task <title>');
      console.log('  查询:   journal | history <id>');
      console.log('  边:     edge add <from> <to> --type depends|extends|refines | edge rm <from> <to>');
      console.log('  设置:   set phase <phase> | set active-task <TASK-ID> | set active-task clear');
      process.exit(1);
  }
} catch (e) {
  // 统一捕获底层抛错（如损坏 YAML），输出友好错误而非裸堆栈
  console.error(`[ASA] ❌ ${e.message}`);
  process.exit(1);
}

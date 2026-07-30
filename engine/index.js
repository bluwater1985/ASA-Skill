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

const [,, command, ...args] = process.argv;

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
  case 'change-req':
  case 'change-arch':
  case 'change-task': change(args[0]); break;
  case 'deprecate':   deprecate(args[0]); break;
  // Phase 4-6: 增删改查 + 工作流
  case 'add-req':     addNode('req', args.join(' ')); break;
  case 'add-arch':    addNode('arch', args.join(' ')); break;
  case 'add-task':    addNode('task', args.join(' ')); break;
  case 'journal':     journal(); break;
  case 'history':     history(args[0]); break;
  default:
    console.log('ASA CLI v3 — 用法:');
    console.log('  compile | patch | traverse <id> | reconcile | validate');
    console.log('  status <id> <new-status> | impact <id>');
    console.log('  edge add <from> <to> --type depends|extends|refines');
    console.log('  propagate <id>');
    console.log('  change-req|change-arch|change-task <id>');
    console.log('  deprecate <id>');
    process.exit(1);
}

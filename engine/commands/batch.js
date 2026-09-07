// engine/commands/batch.js — 批处理组合命令：一次进程内顺序执行多条引擎操作。
//
// 目的（省调用核心）：DSH / 脚本中把多条操作塞进「一次工具调用」= 1 次模型调用，
// 由引擎在单一进程中原子执行，返回统一摘要。
//
// 输入二选一：
//   1) 第一个参数为 JSON 字符串：
//      node .asa/index.js batch '{"ops":[{"command":"add-req","args":["标题"]},{"command":"add-task","args":["任务","--req","REQ-001"]}]}'
//   2) 从 stdin 读同一 JSON：
//      echo '{"ops":[...]}' | node .asa/index.js batch -
//   每条 op = { command, args? }；validate/flow.ship 等含 process.exit 的操作作为末步使用。
//
// 输出：做完每条后输出一行 [ASA batch] 摘要；全部成功后输出最终 [ASA batch] 完成。

const fs = require('fs');

const { run: addNode } = require('./add.js');
const { run: edge } = require('./edge.js');
const { run: setMeta } = require('./set.js');
const { run: status } = require('./status.js');
const { run: recordChanges } = require('./record-changes.js');
const { run: linkTask } = require('./link.js');
const { run: compile } = require('./compile.js');
const { run: validate } = require('./validate.js');
const { run: planTasks } = require('./plan.js');

const EXEC = {
  'add-req': (a) => addNode('req', a),
  'add-arch': (a) => addNode('arch', a),
  'add-task': (a) => addNode('task', a),
  'add-issue': (a) => addNode('issue', a),
  'edge': (a) => edge(a),
  'set': (a) => setMeta(a[0], a[1]),
  'status': (a) => status(a[0], a[1]),
  'record-changes': (a) => recordChanges(a),
  'link-task': (a) => linkTask(a),
  'plan-tasks': (a) => planTasks(a),
  'compile': () => compile(),
  'validate': (a) => validate(a),
};

function readInput(args) {
  if (args[0] && (args[0].startsWith('{') || args[0].startsWith('['))) {
    return JSON.parse(args[0]);
  }
  if (args[0] === '-' || args.length === 0) {
    const raw = fs.readFileSync(0, 'utf-8');
    return JSON.parse(raw);
  }
  throw new Error('batch 需要 JSON 输入（第一个参数或 stdin），格式: {"ops":[{"command":"...","args":[...]}]}');
}

function run(args) {
  let spec;
  try {
    spec = readInput(args);
  } catch (e) {
    console.error(`[ASA] ❌ batch 解析失败: ${e.message}`);
    process.exit(1);
  }

  const ops = Array.isArray(spec) ? spec : (spec.ops || []);
  if (!Array.isArray(ops) || ops.length === 0) {
    console.error('[ASA] ❌ batch 没有可执行的操作（ops 为空数组）');
    process.exit(1);
  }

  let done = 0;
  for (const op of ops) {
    const cmd = op.command || op.c;
    const opArgs = Array.isArray(op.args) ? op.args : (op.a || []);
    const fn = EXEC[cmd];
    if (!fn) {
      console.error(`[ASA] ❌ batch: 未知操作 ${cmd}`);
      process.exit(1);
    }
    fn(opArgs);
    done++;
    console.log(`[ASA batch] ✅ ${cmd}（${done}/${ops.length}）`);
  }

  console.log(`[ASA batch] ✅ 全部完成：${done} 条操作在单次调用中执行。`);
}

module.exports = { run };

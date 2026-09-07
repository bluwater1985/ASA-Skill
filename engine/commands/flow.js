// engine/commands/flow.js — 组合命令：把多条引擎命令在「同一进程内」串联，一次工具调用 = 多条命令 = 1 次模型调用
//
// 子命令：
//   flow add <REQ标题> <TASK标题> [--desc ..] [--inputs ..] [--outputs ..]
//       → add-req + add-task(关联 REQ) + edge add REQ→TASK + plan-tasks   （4 条 → 1 次）
//   flow begin <TASK> [phase]
//       → set phase <implementation> + set active-task <TASK>              （2 条 → 1 次）
//   flow ship <TASK> <files...>
//       → record-changes + status awaiting-confirmation + set active-task clear + compile + validate （5 条 → 1 次）
//   flow sync-docs
//       → compile + validate                                               （2 条 → 1 次）
//
// 说明：外部由 `node .asa/index.js flow ...` 触发，整条走一个写事务；
//       validate 为末步（失败即 process.exit(1) 触发外层事务回滚，保证原子）。

const { run: addNode } = require('./add.js');
const { run: edge } = require('./edge.js');
const { run: setMeta } = require('./set.js');
const { run: status } = require('./status.js');
const { run: recordChanges } = require('./record-changes.js');
const { run: compile } = require('./compile.js');
const { run: validate } = require('./validate.js');
const { run: planTasks } = require('./plan.js');
const { loadAllNodes } = require('../lib/matrix.js');

// 状态机要求 pending → in_progress → awaiting-confirmation。若任务仍为 pending，先提升为 in_progress（幂等）。
function promoteToProgress(taskId) {
  const nodes = loadAllNodes();
  const t = nodes[taskId];
  if (t && t.status === 'pending') {
    status(taskId, 'in_progress');
  }
}

function usage() {
  console.error('[ASA] 用法 (flow 组合命令，一次调用=多步):');
  console.error('  node .asa/index.js flow add <REQ标题> <TASK标题> [--desc ..] [--inputs ..] [--outputs ..]');
  console.error('  node .asa/index.js flow begin <TASK-ID> [phase]');
  console.error('  node .asa/index.js flow ship <TASK-ID> <file1> [file2]...');
  console.error('  node .asa/index.js flow sync-docs');
  process.exit(1);
}

function flowAdd(rest) {
  const titles = [];
  const flags = [];
  for (const a of rest) {
    if (a && a.startsWith('--')) flags.push(a);
    else titles.push(a);
  }
  if (titles.length < 2) usage();

  const reqTitle = titles[0];
  const taskTitle = titles[1];

  console.log('[ASA flow] 阶段1/4: 建需求与任务');
  const reqId = addNode('req', [reqTitle]);
  const taskId = addNode('task', [taskTitle, '--req', reqId, ...flags]);

  console.log('[ASA flow] 阶段2/4: 建依赖边');
  edge(['add', reqId, taskId, '--type', 'depends']);

  console.log('[ASA flow] 阶段3/4: 拓扑排序可用任务');
  planTasks([reqId]);

  console.log(`[ASA flow] ✅ 完成: ${reqId} → ${taskId}（一次调用完成建节点+建边+排序）`);
}

function flowBegin(rest) {
  const taskId = rest[0];
  if (!taskId) usage();
  const phase = (rest[1] && !rest[1].startsWith('--')) ? rest[1] : 'implementation';
  setMeta('phase', phase);
  setMeta('active-task', taskId);
  promoteToProgress(taskId);
  console.log(`[ASA flow] ✅ begin: phase=${phase}, active-task=${taskId}`);
}

function flowShip(rest) {
  const taskId = rest[0];
  const files = rest.slice(1).filter((f) => f && !f.startsWith('--'));
  if (!taskId) usage();

  promoteToProgress(taskId);
  console.log('[ASA flow] 阶段1/5: 记录变更文件');
  recordChanges([taskId, ...files]);
  console.log('[ASA flow] 阶段2/5: 置为待确认');
  status(taskId, 'awaiting-confirmation');
  console.log('[ASA flow] 阶段3/5: 清除活跃任务');
  setMeta('active-task', 'clear');
  console.log('[ASA flow] 阶段4/5: 编译文档');
  compile();
  console.log('[ASA flow] 阶段5/5: 跑门禁 validate（失败将整体回滚）');
  validate([]); // 末步：内部 process.exit，失败触发外层事务回滚
}

function syncDocs() {
  compile();
  validate([]);
}

function run(args) {
  const a = Array.isArray(args) ? args : [];
  const sub = a[0];
  const rest = a.slice(1);
  switch (sub) {
    case 'add': return flowAdd(rest);
    case 'begin': return flowBegin(rest);
    case 'ship': return flowShip(rest);
    case 'sync-docs': return syncDocs();
    default: usage();
  }
}

module.exports = { run };

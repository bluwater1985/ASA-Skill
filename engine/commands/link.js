// engine/commands/link.js — 关联需求 (link-task)
const path = require('path');
const { loadAllNodes, atomicWriteYaml } = require('../lib/matrix.js');
const { appendChangeLog } = require('../lib/changelog.js');

function run(args) {
  if (!args || args.length < 2) {
    console.error('[ASA] 用法: node .asa/index.js link-task <TASK-ID> <REQ-ID>');
    process.exit(1);
  }

  const taskId = args[0];
  const reqId = args[1];

  if (!taskId.startsWith('TASK-')) {
    console.error(`[ASA] ❌ 节点 ${taskId} 不是 TASK 节点`);
    process.exit(1);
  }
  if (!reqId.startsWith('REQ-')) {
    console.error(`[ASA] ❌ 节点 ${reqId} 不是 REQ 节点`);
    process.exit(1);
  }

  const nodes = loadAllNodes();
  const taskNode = nodes[taskId];
  const reqNode = nodes[reqId];

  if (!taskNode) {
    console.error(`[ASA] ❌ 任务 ${taskId} 不存在`);
    process.exit(1);
  }
  if (!reqNode) {
    console.error(`[ASA] ❌ 需求 ${reqId} 不存在`);
    process.exit(1);
  }
  if (taskNode.status === 'cancelled') {
    console.error(`[ASA] ❌ 任务 ${taskId} 处于 cancelled 状态，无法关联`);
    process.exit(1);
  }
  if (reqNode.status === 'rejected' || reqNode.status === 'deprecated') {
    console.error(`[ASA] ❌ 需求 ${reqId} 处于 ${reqNode.status} 状态，无法关联`);
    process.exit(1);
  }

  taskNode.linkedReqs = taskNode.linkedReqs || [];
  if (taskNode.linkedReqs.includes(reqId)) {
    console.log(`[ASA] ℹ️ 任务 ${taskId} 已关联需求 ${reqId}，无需重复操作`);
    return;
  }
  taskNode.linkedReqs.push(reqId);

  const version = appendChangeLog(taskNode, 'modified', `关联需求: ${reqId}`, 'user');

  // 写盘
  const cat = taskNode.__category || 'tasks';
  if (taskNode.__category) {
    delete taskNode.__category;
  }
  atomicWriteYaml(path.join(process.cwd(), `.asa/nodes/${cat}/${taskId}.yaml`), taskNode);
  taskNode.__category = cat;

  console.log(`[ASA] ✅ 任务关联成功: ${taskId} ↔ ${reqId} (v${version})`);

  // 自动重编译 docs + 刷新 nodesDigest
  try {
    const { run: compile } = require('./compile.js');
    compile();
  } catch (e) {
    console.error(`[ASA] ❌ compile 失败，将回滚当前写入。错误: ${e.message}`);
    throw e;
  }
}

module.exports = { run };

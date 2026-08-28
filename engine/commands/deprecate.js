// engine/commands/deprecate.js — 废弃节点 + 级联 cancelled
const path = require('path');
const { loadMatrix, saveMatrix, loadAllNodes, atomicWriteYaml } = require('../lib/matrix.js');
const { bfsForward } = require('../lib/graph.js');
const { appendChangeLog } = require('../lib/changelog.js');
const { validateTransition } = require('../lib/state-machine.js');

function run(id) {
  if (!id) {
    console.error('[ASA] 用法: node .asa/index.js deprecate <ID>');
    process.exit(1);
  }

  const matrix = loadMatrix();
  const nodes = loadAllNodes();
  const node = nodes[id];

  if (!node) {
    console.error(`[ASA] ❌ 节点 ${id} 不存在`);
    process.exit(1);
  }

  // 按节点类型分派终态：REQ→deprecated, ARCH→superseded, TASK→cancelled
  const type = (id || '').split('-')[0];
  const terminalState = { REQ: 'deprecated', ARCH: 'superseded', TASK: 'cancelled' }[type];
  if (!terminalState) {
    console.error(`[ASA] ❌ 未知节点类型: ${id}`);
    process.exit(1);
  }

  // 缺失 status 按类型回退初始态（与 status.js 一致）
  const INITIAL = { REQ: 'proposed', ARCH: 'draft', TASK: 'pending' };
  const currentStatus = node.status || INITIAL[type] || 'pending';
  const trans = validateTransition(id, currentStatus, terminalState);
  if (!trans.valid) {
    console.error(`[ASA] ❌ ${trans.error}`);
    process.exit(1);
  }

  // 标记目标节点为终态
  node.status = terminalState;
  appendChangeLog(node, terminalState, `节点已废弃 (${terminalState})`);
  const cat = node.__category;
  delete node.__category;
  atomicWriteYaml(path.join(process.cwd(), `.asa/nodes/${cat}/${id}.yaml`), node);
  node.__category = cat;
  console.log(`[ASA] ${id} → ${terminalState}`);

  // 1. 根据终审合格边级联矩阵搜集下游取消 TASK 节点
  const edges = matrix.edges || [];
  const startType = id.split('-')[0]; // REQ / ARCH / TASK
  const cancelledTasks = new Set();
  const queue = [];

  // 第一层级联：从起点 (id) 直连下游 TASK
  for (const edge of edges) {
    if (edge.from !== id || !edge.to) continue;
    const targets = Array.isArray(edge.to) ? edge.to : [edge.to];
    for (const toId of targets) {
      if (!toId.startsWith('TASK-')) continue; // 仅 TASK 是合格级联端点

      const isDepends = edge.type === 'depends';
      const isLegacy = !edge.type; // 无 type 边
      
      let qualified = false;
      if (startType === 'REQ' || startType === 'ARCH') {
        qualified = isDepends || isLegacy;
      } else if (startType === 'TASK') {
        qualified = isDepends;
      }

      if (qualified && !cancelledTasks.has(toId)) {
        cancelledTasks.add(toId);
        queue.push(toId);
      }
    }
  }

  // 递归级联：TASK -> TASK 且必须是 depends 边
  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of edges) {
      if (edge.from !== current || !edge.to) continue;
      const targets = Array.isArray(edge.to) ? edge.to : [edge.to];
      for (const toId of targets) {
        if (!toId.startsWith('TASK-')) continue; // 只能流向 TASK
        if (edge.type === 'depends' && !cancelledTasks.has(toId)) {
          cancelledTasks.add(toId);
          queue.push(toId);
        }
      }
    }
  }

  const downstream = Array.from(cancelledTasks).sort();
  let taskCount = 0;
  let preservedCount = 0;
  const successfullyCancelled = [];

  for (const taskId of downstream) {
    const taskNode = nodes[taskId];
    if (!taskNode) continue;

    const oldStatus = taskNode.status || 'pending';
    if (oldStatus === 'cancelled') {
      console.log(`  - ${taskId}: 已是 cancelled，跳过`);
      continue;
    }

    if (oldStatus === 'awaiting-confirmation') {
      console.log(`  ⚠️ 下游提审任务 [${taskId}] 处于 awaiting-confirmation 状态，已安全跳过级联取消。请使用 cancel-task 进行人工确权。`);
      preservedCount++;
      continue; // 跳过此节点的取消变更
    }

    // 校验 cancelled 转换：completed/verified 等终态不允许取消
    const trans = validateTransition(taskId, oldStatus, 'cancelled');
    if (!trans.valid) {
      console.log(`  [INFO] ${taskId}: 状态 ${oldStatus} 不允许自动取消，保留人工评估`);
      preservedCount++;
      continue;
    }

    taskNode.status = 'cancelled';
    appendChangeLog(taskNode, 'cancelled', `级联废弃: ${id} 已 deprecated`);
    const tCat = taskNode.__category;
    delete taskNode.__category;
    atomicWriteYaml(path.join(process.cwd(), `.asa/nodes/${tCat}/${taskId}.yaml`), taskNode);
    taskNode.__category = tCat;
    console.log(`  → ${taskId}: set_status cancelled (前: ${oldStatus})`);
    successfullyCancelled.push(taskId);
    taskCount++;
  }

  if (taskCount === 0 && preservedCount === 0) {
    console.log(`  (无下游 TASK 需要 cancelled)`);
  } else if (taskCount > 0) {
    console.log(`  ${taskCount} 个 TASK 已标记为 cancelled${preservedCount > 0 ? `，${preservedCount} 个因终态保留人工评估` : ''}`);
  } else {
    console.log(`  ${preservedCount} 个下游 TASK 因终态无法自动取消，保留人工评估`);
  }

  // 若被废弃/级联取消的节点是当前活跃任务，清除 activeTask (仅限真正被取消的节点)
  const activeWas = matrix.meta?.activeTask;
  if (activeWas && activeWas !== '(none)' &&
    (id === activeWas || successfullyCancelled.includes(activeWas))) {
    matrix.meta.activeTask = '(none)';
    saveMatrix(matrix);
    console.log(`  [INFO] 活跃任务 ${activeWas} 已被清除`);
  }

  // 运行 reconcile 确保 matrix 同步
  try {
    const { run: reconcile } = require('./reconcile.js');
    reconcile();
  } catch (e) {
    console.error(`  ❌ deprecate 中的 reconcile 同步失败: ${e.message}`);
    throw e;
  }

  // 重编译 docs，避免文档与节点状态漂移
  try {
    const { run: compile } = require('./compile.js');
    compile();
  } catch (e) {
    console.error(`  ❌ deprecate 中的 compile 失败: ${e.message}`);
    throw e;
  }
}

module.exports = { run };

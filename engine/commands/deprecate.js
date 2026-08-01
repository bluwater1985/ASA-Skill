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

  // 校验 deprecated 转换
  const currentStatus = node.status || 'pending';
  const trans = validateTransition(id, currentStatus, 'deprecated');
  if (!trans.valid) {
    console.error(`[ASA] ❌ ${trans.error}`);
    process.exit(1);
  }

  // 标记目标节点为 deprecated
  node.status = 'deprecated';
  appendChangeLog(node, 'deprecated', `节点已废弃`);
  const cat = node.__category;
  delete node.__category;
  atomicWriteYaml(path.join(process.cwd(), `.asa/nodes/${cat}/${id}.yaml`), node);
  node.__category = cat;
  console.log(`[ASA] ${id} → deprecated`);

  // 正向 BFS 找下游 TASK，自动 cancelled
  const edges = matrix.edges || [];
  const downstream = bfsForward(edges, id);
  let taskCount = 0;

  for (const d of downstream) {
    if (d.type !== 'TASK') {
      console.log(`  [INFO] ${d.id}: 非 TASK 类型，跳过自动处理`);
      continue;
    }
    const taskNode = nodes[d.id];
    if (!taskNode) continue;

    const oldStatus = taskNode.status || 'pending';
    if (oldStatus === 'cancelled') {
      console.log(`  - ${d.id}: 已是 cancelled，跳过`);
      continue;
    }

    // 校验 cancelled 转换：completed/verified 等终态不允许取消
    const trans = validateTransition(d.id, oldStatus, 'cancelled');
    if (!trans.valid) {
      console.log(`  [INFO] ${d.id}: 状态 ${oldStatus} 不允许自动取消（${trans.error.split('）')[0]}），保留人工评估`);
      continue;
    }

    taskNode.status = 'cancelled';
    appendChangeLog(taskNode, 'cancelled', `级联废弃: ${id} 已 deprecated`);
    const tCat = taskNode.__category;
    delete taskNode.__category;
    atomicWriteYaml(path.join(process.cwd(), `.asa/nodes/${tCat}/${d.id}.yaml`), taskNode);
    taskNode.__category = tCat;
    console.log(`  → ${d.id}: set_status cancelled (前: ${oldStatus})`);
    taskCount++;
  }

  if (taskCount === 0) {
    console.log(`  (无下游 TASK 需要 cancelled)`);
  } else {
    console.log(`  共 ${taskCount} 个 TASK 已标记为 cancelled`);
  }

  // 运行 reconcile 确保 matrix 同步
  try {
    const { run: reconcile } = require('./reconcile.js');
    reconcile();
  } catch (e) {
    console.log(`  ⚠️ reconcile 跳过: ${e.message}`);
  }
}

module.exports = { run };

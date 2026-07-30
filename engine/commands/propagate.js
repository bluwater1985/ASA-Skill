// engine/commands/propagate.js — 幂等变更传播
const path = require('path');
const { loadMatrix, loadAllNodes, atomicWriteYaml } = require('../lib/matrix.js');
const { bfsForward } = require('../lib/graph.js');
const { appendChangeLog, createPendingPropagation, clearPendingPropagation, hasPendingPropagation } = require('../lib/changelog.js');
const { validateTransition } = require('../lib/state-machine.js');

function run(startId) {
  if (!startId) {
    console.error('[ASA] 用法: node .asa/index.js propagate <ID>');
    process.exit(1);
  }

  const matrix = loadMatrix();
  const nodes = loadAllNodes();
  const source = nodes[startId];

  if (!source) {
    console.error(`[ASA] ❌ 节点 ${startId} 不存在`);
    process.exit(1);
  }

  // 检查是否有未完成的 propagation
  if (hasPendingPropagation(source)) {
    console.log(`[ASA] ◇ ${startId} 存在未完成的传播，恢复中...`);
  }

  // 获取下游节点
  const edges = matrix.edges || [];
  const downstream = bfsForward(edges, startId);
  if (downstream.length === 0) {
    console.log(`[ASA] ${startId} 无下游节点，无需传播`);
    return;
  }

  console.log(`[ASA] 传播 ${startId} 的变更...`);
  let count = 0;

  for (const d of downstream) {
    const node = nodes[d.id];
    if (!node) continue;

    // 幂等：如果是 ARCH 且状态是 draft，跳过
    if (d.type === 'ARCH' && node.status === 'draft') {
      console.log(`  ✓ ${d.id}: 已是 draft → 跳过 (幂等命中)`);
      continue;
    }

    // 对 ARCH 执行 set_status draft
    if (d.type === 'ARCH') {
      const oldStatus = node.status || 'pending';
      const trans = validateTransition(d.id, oldStatus, 'draft');
      if (trans.valid) {
        node.status = 'draft';
        appendChangeLog(node, 'draft', `传播: ${startId} 变更自动设为 draft`);
        const cat = node.__category;
        delete node.__category;
        atomicWriteYaml(path.join(process.cwd(), `.asa/nodes/${cat}/${d.id}.yaml`), node);
        node.__category = cat;
        console.log(`  ✓ ${d.id}: set_status draft (原: ${oldStatus})`);
        count++;
      } else {
        console.log(`  - ${d.id}: 无法设为 draft (${trans.error})`);
      }
    }
  }

  if (count === 0) {
    console.log(`  (无节点需要更新)`);
  }

  // 更新源节点 — 自动设为 modified 并递增版本
  const oldVersion = source.version || 1;
  source.version = oldVersion + 1;
  source.status = 'modified';
  if (!source.changeLog) source.changeLog = [];
  source.changeLog.push({
    date: new Date().toISOString().split('T')[0],
    type: 'propagation_done',
    version: source.version,
    summary: `传播完成: 更新了 ${count} 个下游节点`,
    by: 'system',
  });

  const srcCat = source.__category;
  delete source.__category;
  atomicWriteYaml(path.join(process.cwd(), `.asa/nodes/${srcCat}/${startId}.yaml`), source);
  source.__category = srcCat;

  // 清除 pendingPropagation
  clearPendingPropagation(source, source.version - 1);

  console.log(`  → ${startId}: v${oldVersion} → v${source.version}, status: modified`);
  console.log(`  ✓ 重新 compile...`);

  // 自动 compile
  try {
    const { run: compile } = require('./compile.js');
    compile();
  } catch (e) {
    console.log(`  ⚠️ compile 跳过: ${e.message}`);
  }
}

module.exports = { run };

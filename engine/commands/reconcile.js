// engine/commands/reconcile.js — 状态一致性修复 + 存量迁移
const fs = require('fs');
const path = require('path');
const { loadMatrix, saveMatrix, loadAllNodes, calculateDocsDigest, atomicWriteYaml, rebuildSummary } = require('../lib/matrix.js');

// 存量状态 → 新状态机映射表
const MIGRATION_MAP = {
  'REQ':  { pending: 'proposed' },
  'ARCH': { pending: 'draft' },
  'TASK': { pending: 'pending', done: 'completed', in_progress: 'in_progress' },
};

function getNodeType(id) {
  if (!id || typeof id !== 'string') return null;
  return id.split('-')[0];
}

function migrateNodes(nodes) {
  const migrated = [];
  for (const [id, node] of Object.entries(nodes)) {
    const type = getNodeType(id);
    if (!type) continue;
    const typeMap = MIGRATION_MAP[type];
    if (!typeMap) continue;

    const oldStatus = node.status;
    const newStatus = typeMap[oldStatus];
    if (newStatus && newStatus !== oldStatus) {
      node.status = newStatus;
      node.version = node.version || 1;
      if (!node.changeLog) node.changeLog = [];
      if (!node.pendingPropagation) node.pendingPropagation = [];
      console.log(`[ASA] 迁移: ${id} status: ${oldStatus} → ${newStatus}`);
      migrated.push(id);
    }
  }
  return migrated;
}

function run() {
  const matrix = loadMatrix();
  const nodes = loadAllNodes();

  // 存量迁移（schemaVersion < 2 才执行，避免 schemaVersion=1 的项目永远无法迁移）
  if (!matrix.meta || (matrix.meta.schemaVersion || 0) < 2) {
    matrix.meta = matrix.meta || {};
    const migrated = migrateNodes(nodes);
    if (migrated.length > 0) {
      // 只写回实际迁移的节点
      for (const id of migrated) {
        const node = nodes[id];
        const cat = node.__category;
        if (!cat) continue;
        delete node.__category;
        atomicWriteYaml(
          path.join(process.cwd(), `.asa/nodes/${cat}/${id}.yaml`),
          node
        );
        node.__category = cat;
      }
      matrix.meta.schemaVersion = 2;
    } else {
      matrix.meta.schemaVersion = 1;
    }
    saveMatrix(matrix);
    console.log(`[ASA] schemaVersion: ${matrix.meta.schemaVersion}`);
  }

  // 从 nodes/ 重建摘要索引（以节点文件为准）
  rebuildSummary(matrix, nodes);
  saveMatrix(matrix);

  // 摘要已由 rebuildSummary 从 nodes 重建，无需逐一修复
  let hasChanges = false;

  const currentDigest = calculateDocsDigest();
  if (matrix.meta?.docsActualDigest !== currentDigest) {
    matrix.meta.docsActualDigest = currentDigest;
    hasChanges = true;
  }

  if (hasChanges) saveMatrix(matrix);

  const activeTask = matrix.meta?.activeTask || '(none)';
  const phase = matrix.meta?.phase || '(unknown)';
  const total = matrix.tasks ? Object.keys(matrix.tasks).length : 0;
  const done = matrix.tasks ? Object.values(matrix.tasks).filter(t => ['done', 'completed', 'verified'].includes(t.status)).length : 0;
  console.log(`[ASA STATUS] Phase: ${phase} | ActiveTask: ${activeTask} | Tasks: ${done}/${total} done`);
}

module.exports = { run };

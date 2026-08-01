// engine/commands/propagate.js — 幂等变更传播
const path = require('path');
const { loadMatrix, loadAllNodes, atomicWriteYaml } = require('../lib/matrix.js');
const { bfsForward } = require('../lib/graph.js');
const { appendChangeLog, clearPendingPropagation, hasPendingPropagation } = require('../lib/changelog.js');
const { validateTransition } = require('../lib/state-machine.js');

// 执行单个结构化动作，返回 true 表示发生了实际修改
function executeAction(node, action) {
  const type = action?.type;
  const value = action?.value;
  const target = action?.target;

  switch (type) {
    case 'set_status': {
      if (!value) return false;
      const old = node.status || 'pending';
      if (old === value) return false; // 幂等
      const trans = validateTransition(node.id, old, value);
      if (!trans.valid) {
        console.log(`  - ${node.id}: 无法 set_status ${value} (${trans.error})`);
        return false;
      }
      node.status = value;
      appendChangeLog(node, value, `传播动作: set_status ${value}`);
      console.log(`  ✓ ${node.id}: set_status ${value} (原: ${old})`);
      return true;
    }
    case 'append_to_array': {
      if (!target) return false;
      if (!Array.isArray(node[target])) node[target] = [];
      if (node[target].includes(value)) return false; // 幂等
      node[target].push(value);
      appendChangeLog(node, 'modified', `传播动作: append ${target} += "${value}"`);
      console.log(`  ✓ ${node.id}: append_to_array ${target} +1`);
      return true;
    }
    case 'set_field': {
      if (!target) return false;
      if (node[target] === value) return false; // 幂等
      node[target] = value;
      appendChangeLog(node, 'modified', `传播动作: set ${target} = "${value}"`);
      console.log(`  ✓ ${node.id}: set_field ${target}`);
      return true;
    }
    case 'replace_in_array': {
      if (!target) return false;
      const old = value?.old;
      const neu = value?.new;
      if (!Array.isArray(node[target])) node[target] = [];
      const idx = node[target].indexOf(old);
      if (idx === -1) return false; // 无可替换
      node[target][idx] = neu;
      appendChangeLog(node, 'modified', `传播动作: replace ${target} "${old}" → "${neu}"`);
      console.log(`  ✓ ${node.id}: replace_in_array ${target}`);
      return true;
    }
    default:
      console.log(`  - 未知动作类型: ${type || '(空)'}`);
      return false;
  }
}

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

  console.log(`[ASA] 传播 ${startId} 的变更...`);
  let count = 0;

  // 1. 执行 pendingPropagation 中的结构化动作（幂等）
  const pending = source.pendingPropagation || [];
  if (pending.length > 0) {
    console.log(`  ◇ 执行 ${pending.length} 个未完成的传播条目...`);
    for (const entry of pending) {
      for (const af of entry.affectedNodes || []) {
        const node = nodes[af.id];
        if (!node) {
          console.log(`  - ${af.id}: 节点不存在，跳过`);
          continue;
        }
        if (executeAction(node, af.action)) {
          const cat = node.__category;
          delete node.__category;
          atomicWriteYaml(path.join(process.cwd(), `.asa/nodes/${cat}/${af.id}.yaml`), node);
          node.__category = cat;
          count++;
        }
      }
      clearPendingPropagation(source, entry.changeVersion);
    }
    // 写回源节点（pending 已清除）
    const srcCat = source.__category;
    delete source.__category;
    atomicWriteYaml(path.join(process.cwd(), `.asa/nodes/${srcCat}/${startId}.yaml`), source);
    source.__category = srcCat;
  }

  // 2. 沿下游 BFS 对 ARCH 执行 set_status draft（兼容旧行为）
  const edges = matrix.edges || [];
  const downstream = bfsForward(edges, startId);
  for (const d of downstream) {
    const node = nodes[d.id];
    if (!node || d.type !== 'ARCH') continue;
    if (executeAction(node, { type: 'set_status', value: 'draft' })) {
      const cat = node.__category;
      delete node.__category;
      atomicWriteYaml(path.join(process.cwd(), `.asa/nodes/${cat}/${d.id}.yaml`), node);
      node.__category = cat;
      count++;
    }
  }

  if (count === 0) {
    console.log(`  (无节点需要更新)`);
    return; // 幂等：无实际变更，不递增源版本、不写 changelog
  }

  // 3. 有实际变更：源节点递增版本 + 设为 modified + 记录 changelog
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

  console.log(`  → ${startId}: v${oldVersion} → v${source.version}, status: modified`);
  console.log(`  ✓ 重新 compile...`);

  try {
    const { run: compile } = require('./compile.js');
    compile();
  } catch (e) {
    console.log(`  ⚠️ compile 跳过: ${e.message}`);
  }
}

module.exports = { run };

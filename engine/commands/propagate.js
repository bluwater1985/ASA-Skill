// engine/commands/propagate.js — 幂等变更传播
// 语义：执行 pendingPropagation 中定义的结构化动作（set_status/append_to_array/...）。
// 失败的动作不丢弃 —— 保留条目标 partial，返回非零退出码，让 validate 继续阻塞。
const path = require('path');
const { loadMatrix, loadAllNodes, atomicWriteYaml } = require('../lib/matrix.js');
const { appendChangeLog, clearPendingPropagation } = require('../lib/changelog.js');
const { validateTransition } = require('../lib/state-machine.js');

// 返回: 'applied' | 'skipped'(幂等命中) | 'failed' | 'unknown'
function executeAction(node, action) {
  const type = action?.type;
  const value = action?.value;
  const target = action?.target;

  switch (type) {
    case 'set_status': {
      if (!value) return 'failed';
      const old = node.status || 'pending';
      if (old === value) return 'skipped'; // 幂等
      const trans = validateTransition(node.id, old, value);
      if (!trans.valid) {
        console.log(`  ✗ ${node.id}: 无法 set_status ${value}（${trans.error}）`);
        return 'failed';
      }
      node.status = value;
      appendChangeLog(node, value, `传播动作: set_status ${value}`);
      console.log(`  ✓ ${node.id}: set_status ${value} (原: ${old})`);
      return 'applied';
    }
    case 'append_to_array': {
      if (!target) return 'failed';
      if (!Array.isArray(node[target])) node[target] = [];
      if (node[target].includes(value)) return 'skipped'; // 幂等
      node[target].push(value);
      appendChangeLog(node, 'modified', `传播动作: append ${target} += "${value}"`);
      console.log(`  ✓ ${node.id}: append_to_array ${target} +1`);
      return 'applied';
    }
    case 'set_field': {
      if (!target) return 'failed';
      if (node[target] === value) return 'skipped'; // 幂等
      node[target] = value;
      appendChangeLog(node, 'modified', `传播动作: set ${target} = "${value}"`);
      console.log(`  ✓ ${node.id}: set_field ${target}`);
      return 'applied';
    }
    case 'replace_in_array': {
      if (!target) return 'failed';
      const old = value?.old;
      const neu = value?.new;
      if (!Array.isArray(node[target])) node[target] = [];
      const idx = node[target].indexOf(old);
      if (idx === -1) return 'skipped'; // 无可替换 = 已是最新
      node[target][idx] = neu;
      appendChangeLog(node, 'modified', `传播动作: replace ${target} "${old}" → "${neu}"`);
      console.log(`  ✓ ${node.id}: replace_in_array ${target}`);
      return 'applied';
    }
    default:
      console.log(`  ✗ ${node.id}: 未知动作类型 "${type || '(空)'}"`);
      return 'failed';
  }
}

function writeNode(node) {
  const cat = node.__category;
  if (!cat) return;
  delete node.__category;
  atomicWriteYaml(path.join(process.cwd(), `.asa/nodes/${cat}/${node.id}.yaml`), node);
  node.__category = cat;
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
  let applied = 0;
  let failed = 0;

  const pending = source.pendingPropagation || [];
  if (pending.length === 0) {
    console.log(`  (无待传播的 pendingPropagation 条目)`);
    return;
  }

  // 逐条目执行动作；只有全部成功/幂等命中的条目才清除
  for (const entry of pending) {
    const remaining = [];
    for (const af of entry.affectedNodes || []) {
      const node = nodes[af.id];
      if (!node) {
        console.log(`  ✗ ${af.id}: 节点不存在，动作保留待处理`);
        failed++;
        remaining.push(af);
        continue;
      }
      const result = executeAction(node, af.action);
      if (result === 'applied') {
        writeNode(node);
        applied++;
      } else if (result === 'failed') {
        failed++;
        remaining.push(af);
      } else {
        // skipped：幂等命中，无需保留
      }
    }

    if (remaining.length === 0) {
      clearPendingPropagation(source, entry.changeVersion);
      console.log(`  ✓ 条目 v${entry.changeVersion} 全部完成，已清除`);
    } else {
      entry.status = 'partial';
      entry.affectedNodes = remaining;
      console.log(`  ⚠️ 条目 v${entry.changeVersion} 有 ${remaining.length} 个动作未完成，已标记 partial`);
    }
  }

  // 源节点写回（pending 状态可能更新为 partial 或条目被清除）
  writeNode(source);

  if (failed > 0) {
    console.error(`[ASA] ❌ ${failed} 个动作执行失败，已保留为 partial。请人工处理后重跑 propagate。`);
    process.exit(1);
  }

  if (applied === 0) {
    console.log(`  (无实际变更，源节点状态不变)`);
    return;
  }

  // 有实际变更：源节点递增版本 + 设为 modified + 记录 changelog
  const oldVersion = source.version || 1;
  source.version = oldVersion + 1;
  source.status = 'modified';
  if (!source.changeLog) source.changeLog = [];
  // 设计文档要求同版本两条记录：状态变更 + 传播完成
  source.changeLog.push({
    date: new Date().toISOString().split('T')[0],
    type: 'modified',
    version: source.version,
    summary: `状态变更: ${source.status} 传播触发`,
    by: 'system',
  });
  source.changeLog.push({
    date: new Date().toISOString().split('T')[0],
    type: 'propagation_done',
    version: source.version,
    summary: `传播完成: 应用了 ${applied} 个动作`,
    by: 'system',
  });
  writeNode(source);

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

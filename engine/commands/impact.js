// engine/commands/impact.js — 影响分析报告
const { loadMatrix, loadAllNodes } = require('../lib/matrix.js');
const { bfsForward, bfsReverse } = require('../lib/graph.js');

function run(startId) {
  if (!startId) {
    console.error('[ASA] 用法: node .asa/index.js impact <ID>');
    process.exit(1);
  }

  const matrix = loadMatrix();
  const nodes = loadAllNodes();
  const source = nodes[startId];

  if (!source) {
    console.error(`[ASA] ❌ 节点 ${startId} 不存在`);
    process.exit(1);
  }

  const title = source.title || '未命名';
  const edges = matrix.edges || [];

  // BFS 遍历
  const downstream = bfsForward(edges, startId);
  const upstream = bfsReverse(edges, startId);

  console.log(`\n[ASA] Impact Report for ${startId} (${title})`);
  console.log('═'.repeat(50));

  // 上游依赖
  if (upstream.length > 0) {
    console.log('\n上游依赖 (DEPENDS ON):');
    for (const u of upstream) {
      const n = nodes[u.id];
      const note = n ? ` — ${n.title || ''}` : '';
      console.log(`  ← ${u.id}${note}`);
    }
  }

  // 下游影响
  if (downstream.length > 0) {
    console.log('\n下游影响 (AFFECTS):');
    for (const d of downstream) {
      const n = nodes[d.id];
      const note = n ? ` — ${n.title || ''}` : '';
      console.log(`  → ${d.id}${note}`);
    }
  }

  if (upstream.length === 0 && downstream.length === 0) {
    console.log('\n  (无关联节点)');
  }

  // 仅当存在待传播条目时才建议 propagate
  const pending = source.pendingPropagation || [];
  if (pending.length > 0) {
    console.log(`\n建议: 运行 asa propagate ${startId} 执行级联更新（有 ${pending.length} 个待传播条目）`);
  } else if (downstream.length > 0) {
    console.log(`\n提示: ${startId} 无待传播条目。如需传播变更，请先添加 pendingPropagation。`);
  }
}

module.exports = { run };

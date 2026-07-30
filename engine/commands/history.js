// engine/commands/history.js — 单节点变更沿革
const { loadAllNodes } = require('../lib/matrix.js');

function run(id) {
  if (!id) {
    console.error('[ASA] 用法: node .asa/index.js history <ID>');
    process.exit(1);
  }

  const nodes = loadAllNodes();
  const node = nodes[id];

  if (!node) {
    console.error(`[ASA] ❌ 节点 ${id} 不存在`);
    process.exit(1);
  }

  console.log(`[ASA] ${id} 变更沿革`);
  console.log(`  title: ${node.title || '未命名'}`);
  console.log(`  status: ${node.status || '?'}`);
  console.log(`  version: ${node.version || 1}`);
  console.log('');

  const log = node.changeLog || [];
  if (log.length === 0) {
    console.log('  (暂无变更记录)');
    return;
  }

  console.log('  日期        类型            版本  操作者  摘要');
  console.log('  ─' .repeat(60));
  for (const entry of log) {
    const date = (entry.date || '?').padEnd(12);
    const type = (entry.type || '').padEnd(16);
    const ver = String(entry.version || '?').padEnd(5);
    const by = (entry.by || '?').padEnd(8);
    const summary = entry.summary || '';
    console.log(`  ${date}${type}${ver}${by}${summary}`);
  }
}

module.exports = { run };

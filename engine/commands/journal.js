// engine/commands/journal.js — 全项目变更历史
const { loadAllNodes } = require('../lib/matrix.js');

function run() {
  const nodes = loadAllNodes();
  const entries = [];

  for (const [id, node] of Object.entries(nodes)) {
    if (Array.isArray(node.changeLog)) {
      for (const entry of node.changeLog) {
        entries.push({
          node: id,
          title: node.title || '',
          date: entry.date || '?',
          type: entry.type,
          version: entry.version || '?',
          summary: entry.summary || '',
          by: entry.by || '?',
        });
      }
    }
  }

  // 按日期排序
  entries.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  if (entries.length === 0) {
    console.log('[ASA] 暂无变更记录');
    return;
  }

  console.log(`[ASA] 全项目变更历史 (${entries.length} 条记录)\n`);
  console.log('日期       节点      版本  类型            操作者  摘要');
  console.log('─'.repeat(80));
  for (const e of entries) {
    const id = e.node.padEnd(10);
    const ver = String(e.version).padEnd(5);
    const type = (e.type || '?').padEnd(18);
    const by = e.by.padEnd(8);
    const summary = e.summary.length > 30 ? e.summary.slice(0, 27) + '...' : e.summary;
    console.log(`${e.date}  ${id}${ver}${type}${by}${summary}`);
  }
}

module.exports = { run };

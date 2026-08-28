// engine/commands/search.js — 模糊检索需求节点 (search-req)
const { loadMatrix, loadAllNodes } = require('../lib/matrix.js');
const { topCandidates } = require('../lib/similarity.js');

function run(args) {
  const argList = Array.isArray(args) ? args : [args];
  const query = argList.join(' ').trim();
  
  if (!query) {
    console.error('[ASA] ❌ 检索词不能为空。用法: search-req <query>');
    process.exit(1);
  }

  const threshold = 0.3; // 统一查重检索阈值

  // 从节点文件实体加载全量信息，保证 status 和 version 字段齐备
  const allNodes = loadAllNodes();
  const reqs = Object.values(allNodes).filter(n => n.id && n.id.startsWith('REQ-'));

  const results = topCandidates(query, reqs, threshold);
  if (results.length === 0) {
    console.log(`[ASA] 🔍 未找到相似的需求节点 (阈值: ${threshold})`);
    return;
  }

  console.log(`[ASA] 🔍 模糊检索结果 (阈值: ${threshold}, 匹配到 ${results.length} 个):`);
  for (const item of results) {
    console.log(`  - [相似度: ${item.score.toFixed(2)}] ${item.id}: ${item.title} (Status: ${item.status}, Version: ${item.version})`);
  }
}

module.exports = { run };

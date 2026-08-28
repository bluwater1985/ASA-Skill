// engine/commands/traverse.js — 图 BFS 遍历（仅读）
const { loadMatrix, loadAllNodes } = require('../lib/matrix.js');
const { bfsForward } = require('../lib/graph.js');

function run(startId) {
  if (!startId) {
    console.error('[ASA] 需指定节点 ID: node .asa/index.js traverse <ID>');
    process.exit(1);
  }
  // 校验节点存在，与 impact 行为一致
  if (!loadAllNodes()[startId]) {
    console.error(`[ASA] ❌ 节点 ${startId} 不存在`);
    process.exit(1);
  }
  const matrix = loadMatrix();
  const result = bfsForward(matrix.edges || [], startId);
  console.log(JSON.stringify({ source: startId, blastRadius: result }, null, 2));
}

module.exports = { run };

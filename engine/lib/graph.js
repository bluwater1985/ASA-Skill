// engine/lib/graph.js — 图遍历工具（零外部依赖）
// 边方向约定：from → to 表示 from 处于上游，to 处于下游

/**
 * 沿 edges 做正向 BFS（从 from 到 to 方向，找下游）
 * @param {Array} edges - [{from, to, type?}]
 * @param {string} startId - BFS 起点
 * @returns {Array} [{id, type}] — 受影响节点列表（不含起点）
 */
function bfsForward(edges, startId) {
  if (!Array.isArray(edges)) return [];
  const visited = new Set([startId]);
  const queue = [startId];
  const result = [];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of edges) {
      if (edge.from !== current || !edge.to) continue;
      const targets = Array.isArray(edge.to) ? edge.to : [edge.to];
      for (const toId of targets) {
        if (!visited.has(toId)) {
          visited.add(toId);
          queue.push(toId);
          result.push({ id: toId, type: toId ? toId.split('-')[0] : null });
        }
      }
    }
  }
  return result;
}

/**
 * 沿 edges 做逆向 BFS（从 to 到 from 方向，找上游）
 */
function bfsReverse(edges, startId) {
  if (!Array.isArray(edges)) return [];
  const visited = new Set([startId]);
  const queue = [startId];
  const result = [];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of edges) {
      const sources = Array.isArray(edge.to) ? edge.to : [edge.to];
      if (sources.includes(current) && edge.from && !visited.has(edge.from)) {
        visited.add(edge.from);
        queue.push(edge.from);
        result.push({ id: edge.from, type: edge.from ? edge.from.split('-')[0] : null });
      }
    }
  }
  return result;
}

/**
 * 检测新增边是否会形成循环依赖
 * @param {Array} edges - 现有边列表
 * @param {string} from - 新边的 from
 * @param {string} to - 新边的 to
 * @returns {boolean} true = 会形成环
 */
function wouldCreateCycle(edges, from, to) {
  // 自环：from === to 一定形成环
  if (from === to) return true;
  // 仅考虑 depends 依赖边 (口径统一)
  const dependsEdges = edges.filter(e => !e.type || e.type === 'depends');
  // 从 to 出发沿正向 BFS，如果能到达 from 则形成环
  const downstream = bfsForward(dependsEdges, to);
  return downstream.some(n => n.id === from);
}

module.exports = { bfsForward, bfsReverse, wouldCreateCycle };

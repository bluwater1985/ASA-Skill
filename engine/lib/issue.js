// engine/lib/issue.js — 问题(ISSUE)节点便捷创建（供 reject / confirm-hint / completed 返工 等复用）
const fs = require('fs');
const path = require('path');
const { loadMatrix, saveMatrix, loadAllNodes, atomicWriteYaml } = require('./matrix.js');
const { appendChangeLog } = require('./changelog.js');

function nextIssueId() {
  const nodes = loadAllNodes();
  let max = 0;
  for (const id of Object.keys(nodes)) {
    const m = id.match(/^ISSUE-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `ISSUE-${String(max + 1).padStart(3, '0')}`;
}

/**
 * 创建一条 ISSUE 节点并写入矩阵摘要 + affects 边。
 * opts: { title, description, category, severity, linkedReqs?, linkedTasks?, linkedArch?, by?, discoveredBy?, note? }
 * @returns {string} 新 ISSUE id
 */
function createIssue(opts) {
  const id = nextIssueId();
  const node = {
    id,
    title: opts.title || '新问题',
    status: 'open',
    version: 1,
    category: opts.category || 'observation',
    severity: opts.severity || 'P2',
    description: opts.description || '',
    resolution: null,
    linkedReqs: Array.isArray(opts.linkedReqs) ? opts.linkedReqs : [],
    linkedTasks: Array.isArray(opts.linkedTasks) ? opts.linkedTasks : [],
    linkedArch: Array.isArray(opts.linkedArch) ? opts.linkedArch : [],
    changeLog: [],
    pendingPropagation: [],
  };
  if (opts.discoveredBy) node.discoveredBy = opts.discoveredBy;
  const by = opts.by || 'user';
  const summary = opts.note ? `问题创建: ${opts.note}` : '问题创建';
  appendChangeLog(node, 'open', summary, by);

  const dir = path.join(process.cwd(), '.asa/nodes/issues');
  fs.mkdirSync(dir, { recursive: true });
  atomicWriteYaml(path.join(dir, `${id}.yaml`), node);

  const matrix = loadMatrix();
  matrix.issues = matrix.issues || {};
  matrix.issues[id] = { title: node.title, status: node.status, file: `.asa/nodes/issues/${id}.yaml` };
  if (!Array.isArray(matrix.edges)) matrix.edges = [];
  for (const t of [...node.linkedReqs, ...node.linkedTasks, ...node.linkedArch]) {
    const exists = matrix.edges.some(e =>
      e.from === id && (e.to === t || (Array.isArray(e.to) && e.to.includes(t))) &&
      (e.type || 'affects') === 'affects');
    if (!exists) matrix.edges.push({ from: id, to: t, type: 'affects' });
  }
  saveMatrix(matrix);
  return id;
}

module.exports = { createIssue, nextIssueId };

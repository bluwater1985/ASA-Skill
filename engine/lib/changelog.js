// engine/lib/changelog.js — 变更日志管理工具（零外部依赖）

/**
 * 向节点追加一条 changeLog 记录
 * @param {Object} node - 节点对象（会被直接修改）
 * @param {string} type - 变更类型（modified, status 名称等）
 * @param {string} summary - 变更摘要
 * @param {string} by - 操作者（默认 "user"）
 * @returns {number} 递增后的版本号
 */
function appendChangeLog(node, type, summary, by) {
  by = by || 'user';
  if (!node.changeLog) node.changeLog = [];

  // 检查是否实质性变更，是则递增版本
  const isSubstantive = ['acceptanceCriteria', 'desc', 'outputs', 'status', 'edges'].includes(type);
  // 类型以状态名开头的（如 "modified", "approved"）也是状态变更
  const isStatusChange = ['proposed', 'approved', 'implemented', 'deprecated', 'modified',
    'rejected', 'draft', 'reviewed', 'superseded',
    'pending', 'in_progress', 'completed', 'verified', 'blocked', 'cancelled', 'awaiting-confirmation',
    'open', 'triaged', 'resolved', 'wontfix',
    'reopen'
  ].includes(type);

  if (isStatusChange || type === 'propagation_done' || isSubstantive) {
    // 数值化后再递增，避免手写 "2"（字符串）被拼接成 "21"
    node.version = (parseInt(node.version, 10) || 1) + 1;
  }

  const entry = {
    date: new Date().toISOString().split('T')[0],
    type,
    version: node.version,
    summary,
    by,
  };

  node.changeLog.push(entry);
  return node.version;
}

/**
 * 创建 pendingPropagation 条目
 * @param {Object} node - 源节点
 * @param {number} changeVersion - 对应的版本号
 * @param {Array} affectedNodes - [{ id, action: { type, target?, value } }]
 */
function createPendingPropagation(node, changeVersion, affectedNodes) {
  if (!node.pendingPropagation) node.pendingPropagation = [];
  node.pendingPropagation.push({
    changeVersion,
    status: 'pending',
    affectedNodes,
  });
}

/**
 * 清除已完成传播的 pendingPropagation 条目。
 * 按条目对象身份清除（而非 changeVersion），避免同版本多个条目时误删 partial 条目。
 */
function clearPendingPropagation(node, changeVersion, entryRef) {
  if (!node.pendingPropagation) return;
  if (entryRef) {
    node.pendingPropagation = node.pendingPropagation.filter(e => e !== entryRef);
  } else {
    // 向后兼容：无 entryRef 时按 changeVersion 清除（仅当该版本只有一个条目时安全）
    node.pendingPropagation = node.pendingPropagation.filter(
      e => e.changeVersion !== changeVersion
    );
  }
}

/**
 * 检查节点是否有未完成的传播
 */
function hasPendingPropagation(node) {
  return !!(node.pendingPropagation && node.pendingPropagation.length > 0);
}

module.exports = {
  appendChangeLog,
  createPendingPropagation,
  clearPendingPropagation,
  hasPendingPropagation,
};

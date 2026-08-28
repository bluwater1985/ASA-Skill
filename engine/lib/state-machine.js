// engine/lib/state-machine.js — ASA 节点状态机（零外部依赖）

/**
 * 三种节点类型的状态机转换规则
 * key: 当前状态 → values: 允许的下一个状态数组
 */
const TRANSITIONS = {
  REQ: {
    proposed:     ['approved', 'rejected', 'deprecated'],
    approved:     ['implemented', 'modified', 'deprecated'],
    implemented:  ['modified', 'deprecated'],
    modified:     ['approved', 'rejected', 'deprecated'],
    rejected:     ['proposed'],  // 误拒绝可重新提交
    deprecated:   [],            // 吸收态
  },
  ARCH: {
    draft:        ['reviewed', 'superseded'],
    reviewed:     ['approved', 'draft', 'superseded'],
    approved:     ['superseded', 'draft'],
    superseded:   [],            // 吸收态
  },
  TASK: {
    pending:      ['in_progress', 'cancelled'],
    in_progress:  ['blocked', 'cancelled', 'awaiting-confirmation'],
    'awaiting-confirmation': ['completed', 'in_progress', 'cancelled'],
    completed:    ['verified', 'pending', 'in_progress'],  // verified=验收终态；pending/in_progress=返工回开
    verified:     [],
    blocked:      ['in_progress'],
    cancelled:    ['pending'],   // 误取消可恢复
  },
  ISSUE: {
    open:         ['triaged', 'cancelled', 'wontfix'],
    triaged:      ['in_progress', 'cancelled', 'wontfix'],
    in_progress:  ['resolved', 'cancelled', 'blocked'],
    blocked:      ['in_progress'],
    resolved:     ['verified', 'open', 'in_progress'],  // verified=验收终态；open/in_progress=返工回开（对齐 TASK）
    verified:     [],            // 吸收态
    wontfix:      [],            // 吸收态
    cancelled:    ['open'],      // 误取消可恢复
  },
};

/**
 * 获取节点类型 ID（"REQ-001" → "REQ"）
 */
function getNodeType(id) {
  if (!id || typeof id !== 'string') return null;
  return id.split('-')[0];
}

/**
 * 校验状态转换是否合法
 * @param {string} id - 节点 ID（如 "REQ-001"）
 * @param {string} from - 当前状态
 * @param {string} to - 目标状态
 * @returns {{ valid: boolean, error?: string }}
 */
function validateTransition(id, from, to) {
  const type = getNodeType(id);
  if (!type || !TRANSITIONS[type]) {
    return { valid: false, error: `未知节点类型: ${id}` };
  }

  const allowed = TRANSITIONS[type][from];
  if (!allowed) {
    return { valid: false, error: `状态 "${from}" 在 ${type} 状态机中不存在` };
  }

  if (allowed.includes(to)) {
    return { valid: true };
  }

  return {
    valid: false,
    error: `${id}: ${from} → ${to} 不允许（${type} 允许的下一个状态: ${allowed.join(', ') || '无'}）`,
  };
}

/**
 * 获取节点允许的下一个状态列表
 */
function getAllowedTransitions(id, current) {
  const type = getNodeType(id);
  if (!type || !TRANSITIONS[type]) return [];
  return TRANSITIONS[type][current] || [];
}

module.exports = {
  TRANSITIONS,
  validateTransition,
  getAllowedTransitions,
};

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

/**
 * 查看层「分桶」定义 —— compile / list / board 共用的唯一口径。
 *
 * 桶语义（三层，而非简单二分）：
 *   - active    未完成（焦点）：默认只展示这一桶让人集中注意力
 *   - done      已完成（沉底归档）：可查但不在眼前
 *   - archived  废弃/取消（噪音）：默认隐藏；cancelled/rejected/deprecated/wontfix 等
 *               既不算「未完成」也不算「已做」，应默认不显示
 *
 * 未知状态一律归入 active（宁可多显示也不愿你漏看该干的事）。
 */
const BUCKETS = {
  REQ: { active: ['proposed', 'approved', 'modified'], done: ['implemented'], archived: ['rejected', 'deprecated'] },
  ARCH: { active: ['draft', 'reviewed'], done: ['approved'], archived: ['superseded'] },
  TASK: { active: ['pending', 'in_progress', 'blocked', 'awaiting-confirmation'], done: ['completed', 'verified'], archived: ['cancelled'] },
  ISSUE: { active: ['open', 'triaged', 'in_progress', 'blocked'], done: ['resolved', 'verified'], archived: ['wontfix', 'cancelled'] },
};

/**
 * 纯只读分桶判定：输入节点类型 + 状态 → 'active' | 'done' | 'archived'
 * @param {string} type - "REQ" / "TASK" / "ARCH" / "ISSUE"
 * @param {string} [status]
 * @returns {'active'|'done'|'archived'}
 */
function getBucket(type, status) {
  const rules = BUCKETS[type];
  if (!rules) return 'active';
  const s = status || 'pending';
  if (rules.active.includes(s)) return 'active';
  if (rules.done.includes(s)) return 'done';
  if (rules.archived.includes(s)) return 'archived';
  return 'active';
}

module.exports = {
  TRANSITIONS,
  validateTransition,
  getAllowedTransitions,
  BUCKETS,
  getBucket,
};

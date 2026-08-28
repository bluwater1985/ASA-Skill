// engine/lib/similarity.js — 确定性文本检索与查重相似度算法（零外部依赖）

/**
 * 强归一化文本：转小写，去除所有中英文标点、特殊符号和所有空白
 */
function normalize(text) {
  if (!text) return '';
  return String(text).toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, '').replace(/_/g, '');
}

/**
 * 提取文本的字符级二元组（Bigrams），作为频次 Map（多重集合 Multiset 表达）
 */
function bigrams(text) {
  const norm = normalize(text);
  const map = new Map();
  if (norm.length < 2) {
    if (norm.length === 1) map.set(norm, 1);
    return map;
  }
  for (let i = 0; i < norm.length - 1; i++) {
    const bg = norm.substring(i, i + 2);
    map.set(bg, (map.get(bg) || 0) + 1);
  }
  return map;
}

/**
 * 计算多重集合（Multiset）下的 Sørensen-Dice 系数
 */
function dice(str1, str2) {
  const norm1 = normalize(str1);
  const norm2 = normalize(str2);

  // 空白与纯标点串防御哨兵 (B-n1 修复)：空输入 100% 返回 0.0，捍卫空串契约
  if (norm1 === '' || norm2 === '') {
    return 0.0;
  }

  // 查重超短字符保护 (B4/P2/24轮 P1 修复)：对长度小于等于 2 的极短文本，
  // 若较长者包含了较短者（智能子包含关系），判定为 1.0 强查重拦截，防止假阴性逃逸！
  if (norm1.length <= 2 || norm2.length <= 2) {
    const longer = norm1.length >= norm2.length ? norm1 : norm2;
    const shorter = norm1.length < norm2.length ? norm1 : norm2;
    return longer.includes(shorter) ? 1.0 : 0.0;
  }

  const b1 = bigrams(norm1);
  const b2 = bigrams(norm2);

  const size1 = Array.from(b1.values()).reduce((sum, count) => sum + count, 0);
  const size2 = Array.from(b2.values()).reduce((sum, count) => sum + count, 0);

  if (size1 === 0 && size2 === 0) return 0.0;
  if (size1 === 0 || size2 === 0) return 0.0;

  let intersection = 0;
  for (const [bg, count1] of b1.entries()) {
    if (b2.has(bg)) {
      intersection += Math.min(count1, b2.get(bg));
    }
  }

  return (2.0 * intersection) / (size1 + size2);
}

/**
 * 计算特定需求与查询文本的加权相似度得分：
 * 规则：title 加权（×2）加上 body（description与acceptanceCriteria拼接）加权（×1）
 */
function scoreReq(query, node) {
  const scoreTitle = dice(query, node.title || '');

  // 确定性拼接 body 规则
  const bodyParts = [];
  if (node.description) bodyParts.push(String(node.description));
  if (Array.isArray(node.acceptanceCriteria)) {
    bodyParts.push(node.acceptanceCriteria.join('\n'));
  }
  const bodyText = bodyParts.join('\n');
  const scoreBody = dice(query, bodyText);

  return (scoreTitle * 2 + scoreBody * 1) / 3;
}

/**
 * 搜寻符合阈值的候选相似需求，返回按得分降序排列的列表，包含 status 与 version 字段
 */
function topCandidates(query, nodesList, threshold = 0.5) {
  const candidates = [];
  for (const req of nodesList) {
    const score = scoreReq(query, req);
    if (score >= threshold) {
      candidates.push({
        id: req.id,
        title: req.title,
        score,
        status: req.status || 'pending',
        version: req.version || 1
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

module.exports = {
  normalize,
  bigrams,
  dice,
  scoreReq,
  topCandidates
};

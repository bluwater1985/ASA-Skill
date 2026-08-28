// engine/lib/contract-merge.js — GEMINI.md/CLAUDE.md 契约段落级合并（零外部依赖）
//
// 目标：asa init 重跑时，满足三个同时成立的约束：
//   1. 升级后契约必须随模板同步（标准契约段使用最新模板）
//   2. 用户在项目里沉淀的自定义规约不能被覆盖（仅替换标记内的标准契约段）
//   3. 真正写 GEMINI.md / CLAUDE.md 之前，调用方先做 .bak.<时间戳> 备份
//
// 本模块只提供纯函数，不执行任何磁盘 IO；备份与写盘由调用方（asa-init.js）完成。

// 契约区块边界标记（模板在标准契约正文上、下各放一个）：
//   <!-- ASA-CONTRACT-BEGIN: engine=3.x tier=tier2 -->
//   <标准契约正文>
//   <!-- ASA-CONTRACT-END -->
const BEGIN_RE = /<!--\s*ASA-CONTRACT-BEGIN(?:\s*:\s*(.*?))?\s*-->/;
const END_RE = /<!--\s*ASA-CONTRACT-END\s*-->/;

// 无标记旧文件（老版本生成的 GEMINI.md）回退合并时，用于定位标准契约段的标准章节标题关键词。
// 覆盖三个 tier 模板中固定出现的管理性章节（强制启动序列/核心/变更/事务/门禁/敏捷/增量方法库/协作基线）。
const FALLBACK_KEYWORDS = [
  '强制启动序列', '核心', '物理防御', '变更管理', '事务闭环',
  '门禁', '敏捷', '增量方法库', '协作行为基线', '阶段导航'
];

/**
 * 从模板文本提取契约区块（含 BEGIN/END 边界）。
 * @param {string} text 模板原文
 * @returns {{block:string, meta:{engine:string|null,tier:string|null}}|null} 无标记则返回 null
 */
function extractContractBlock(text) {
  const begin = text.match(BEGIN_RE);
  const end = text.match(END_RE);
  if (!begin || !end) return null;
  const block = text.slice(begin.index, end.index + end[0].length);
  return { block, meta: parseMeta(begin[1]) };
}

/**
 * 解析 BEGIN 标记内联元信息，例：`engine=3.x tier=tier2`
 */
function parseMeta(raw) {
  const meta = { engine: null, tier: null };
  if (typeof raw !== 'string') return meta;
  const engine = raw.match(/engine\s*=\s*([\w.+-]+)/);
  const tier = raw.match(/tier\s*=\s*([\w.+-]+)/);
  if (engine) meta.engine = engine[1];
  if (tier) meta.tier = tier[1];
  return meta;
}

/**
 * 是否包含完整契约标记。
 */
function hasContractMarkers(text) {
  return BEGIN_RE.test(text) && END_RE.test(text);
}

/**
 * 现有 GEMINI.md 的契约区块是否与模板新区块逐字一致。
 * 有标记且内容一致 → true（无需更新）；无标记或内容不一致 → false（需要合并）。
 */
function contractUnchanged(existingText, newBlock) {
  const ex = extractContractBlock(existingText);
  if (!ex) return false;
  return ex.block === newBlock;
}

/**
 * 把模板的新契约区块合并进现有 GEMINI.md：
 *  - 现有文件带标记 → 精确替换 BEGIN..END 区间（保留区间外的头部与尾部自定义内容）
 *  - 现有文件无标记（旧文件，回退 A）→ 按标准章节位置尽力替换，保留首尾
 * @param {string} existingText 现有 GEMINI.md 全文
 * @param {string} newBlock 模板提取的新契约区块（含 BEGIN/END）
 * @returns {string|null} 合并结果；无法定位标准契约段时返回 null（调用方应保守跳过）
 */
function mergeContract(existingText, newBlock) {
  const begin = existingText.match(BEGIN_RE);
  const end = existingText.match(END_RE);
  if (begin && end) {
    return existingText.slice(0, begin.index) + newBlock + existingText.slice(end.index + end[0].length);
  }
  // 无标记 → 回退 A
  const region = detectFallbackRegion(existingText);
  if (!region) return null;
  return existingText.slice(0, region.start) + newBlock + existingText.slice(region.end);
}

/**
 * 回退 A：在无标记的旧 GEMINI.md/CLAUDE.md 中定位标准契约段范围。
 * 标准段 = 从【首个】标准章节标题起，到【末个标准章节标题之后的下一个章节标题】止
 *          （覆盖每个标准章节的正文）；若其后没有其它标题则到文件尾。
 * 头部（标题 + 前置自定义）与尾部（用户追加的自定义章节）不在范围内，从而被保留。
 * @returns {{start:number, end:number}|null} 找不到任何标准章节时返回 null
 */
function detectFallbackRegion(text) {
  const lines = text.split('\n');
  // 收集所有二级及以上标题的起始偏移，并标注是否属于标准契约标题
  const headings = [];
  let cursor = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{2,}\s/.test(line)) {
      headings.push({ start: cursor, isStd: FALLBACK_KEYWORDS.some(k => line.includes(k)) });
    }
    cursor += line.length + 1; // 含换行符
  }

  // 首个标准标题
  let firstStd = null;
  let lastStdIdx = -1;
  for (let i = 0; i < headings.length; i++) {
    if (!headings[i].isStd) continue;
    if (firstStd === null) firstStd = headings[i].start;
    lastStdIdx = i;
  }
  if (firstStd === null) return null; // 找不到任何标准章节

  // 末个标准标题之后的下一个章节标题 → 用户区边界；无则到文件尾
  let regionEnd = text.length;
  for (let i = lastStdIdx + 1; i < headings.length; i++) {
    regionEnd = headings[i].start;
    break;
  }
  return { start: firstStd, end: regionEnd };
}

module.exports = {
  BEGIN_RE,
  END_RE,
  FALLBACK_KEYWORDS,
  extractContractBlock,
  parseMeta,
  hasContractMarkers,
  contractUnchanged,
  mergeContract,
  detectFallbackRegion
};

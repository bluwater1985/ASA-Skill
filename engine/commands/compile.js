// engine/commands/compile.js — 节点 → docs 编译
const path = require('path');
const fs = require('fs');
const { loadMatrix, saveMatrix, loadAllNodes, calculateDocsDigest } = require('../lib/matrix.js');

const DOCS_DIR = path.join(process.cwd(), 'docs');

function run() {
  const matrix = loadMatrix();
  const nodes = loadAllNodes();
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR);

  // 提取现有 docs 中 ASA-NODE 块之外的「用户手写内容」，编译时保留
  const docsPath = path.join(DOCS_DIR, '01-requirements.md');
  let userHeader = '';
  let userFooter = '';
  if (fs.existsSync(docsPath)) {
    const old = fs.readFileSync(docsPath, 'utf-8');
    const firstNode = old.indexOf('<!-- ASA-NODE:');
    const lastEnd = old.lastIndexOf('<!-- ASA-NODE-END -->');
    if (firstNode < 0) {
      // 文档无任何 ASA-NODE 标记 → 整份视为用户手写内容保留
      userHeader = old.trim();
      // 但剔除上次编译的 --- 分隔 + ASA-VERSION/ASA-COMPILED 锚点块，避免累积
      userHeader = userHeader
        .replace(/(?:\n?---\s*\n?)?<!-- ASA-VERSION:[^\n]*\n<!-- ASA-COMPILED:[^\n]*[\s\S]*$/, '')
        .trimEnd();
    } else if (firstNode > 0) {
      userHeader = old.slice(0, firstNode).trimEnd();
      // 剥离上次编译追加的尾部 --- 分隔线，避免每次 compile 累积
      userHeader = userHeader.replace(/\n?---\s*$/, '').trimEnd();
    }
    if (lastEnd >= 0) {
      // 优先保留 ASA-COMPILED 锚点之后的用户手写内容
      const anchorIdx = old.indexOf('<!-- ASA-COMPILED:', lastEnd);
      let footerStart = -1;
      if (anchorIdx >= 0) {
        const nl = old.indexOf('\n', anchorIdx);
        if (nl >= 0) footerStart = nl + 1;
      } else {
        // 锚点缺失（可能被人工删除）→ 降级为取最后一个 ASA-NODE-END 之后的内容
        const endOfBlock = lastEnd + '<!-- ASA-NODE-END -->'.length;
        const afterBlock = old.slice(endOfBlock);
        // 跳过 --- 分隔线与可能残留的 VERSION 锚点
        const m = afterBlock.match(/\n?---\s*\n?(?:<!-- ASA-VERSION:[^\n]*\n)?([\s\S]*)$/);
        if (m && m[1].trim()) footerStart = endOfBlock;
      }
      if (footerStart >= 0) {
        const footer = old.slice(footerStart).trim();
        if (footer) userFooter = footer;
      }
    }
  }

  let reqContent = userHeader ? `${userHeader}\n\n---\n\n` : '# 项目核心需求资产清单\n\n';
  for (const [id, node] of Object.entries(nodes)) {
    if (node.__category !== 'requirements') continue;
    reqContent += `<!-- ASA-NODE: ${id} -->\n`;
    reqContent += `## ${id}: ${node.title || '未命名'}\n\n`;
    reqContent += `- 优先级: ${node.priority || 'P1'}\n`;
    reqContent += `- 当前状态: ${node.status || 'pending'}\n`;
    if (node.version) reqContent += `- 版本: ${node.version}\n`;
    reqContent += `\n<!-- ASA-FIELD: acceptanceCriteria -->\n`;
    if (Array.isArray(node.acceptanceCriteria)) {
      node.acceptanceCriteria.forEach(c => {
        // 多行 criterion 首行用 `- `，续行缩进 2 空格，保证 patch 反向解析无损
        const lines = String(c).split('\n');
        reqContent += `- ${lines[0]}\n`;
        for (let li = 1; li < lines.length; li++) reqContent += `  ${lines[li]}\n`;
      });
    }
    reqContent += `<!-- ASA-NODE-END -->\n\n---\n\n`;
  }

  // 文档版本锚点：反映最新编译的节点版本
  let maxVersion = 1;
  for (const [, node] of Object.entries(nodes)) {
    if (node.__category === 'requirements' && (node.version || 1) > maxVersion) maxVersion = node.version;
  }
  reqContent += `<!-- ASA-VERSION: ${maxVersion} -->\n`;
  reqContent += `<!-- ASA-COMPILED: ${new Date().toISOString().split('T')[0]} -->\n`;

  // 追加用户手写尾部内容（如有）
  if (userFooter) reqContent += `\n${userFooter}\n`;

  fs.writeFileSync(docsPath, reqContent.trim(), 'utf-8');
  console.log('[ASA] Docs 编译完成。');

  // 同步重建 matrix 摘要 + 更新 digest（一次 saveMatrix）
  try {
    const { rebuildSummary } = require('../lib/matrix.js');
    rebuildSummary(matrix, nodes);
  } catch (e) { /* 摘要重建失败不影响主流程 */ }

  const newDigest = calculateDocsDigest();
  matrix.meta = matrix.meta || {};
  matrix.meta.docsExpectedDigest = newDigest;
  matrix.meta.docsActualDigest = newDigest;
  matrix.meta.nodesDigest = require('../lib/matrix.js').calculateNodesDigest();
  saveMatrix(matrix);
}

module.exports = { run };

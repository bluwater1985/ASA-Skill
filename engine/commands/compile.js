// engine/commands/compile.js — 节点 → docs 编译
const path = require('path');
const fs = require('fs');
const { loadMatrix, saveMatrix, loadAllNodes, calculateDocsDigest, docsDir } = require('../lib/matrix.js');


function run() {
  const matrix = loadMatrix();
  const nodes = loadAllNodes();
  if (!fs.existsSync(docsDir())) fs.mkdirSync(docsDir());

  // 提取现有 docs 中 ASA-NODE 块之外的「用户手写内容」，编译时保留
  const docsPath = path.join(docsDir(), '01-requirements.md');
  let userHeader = '';
  let userFooter = '';
  if (fs.existsSync(docsPath)) {
    const old = fs.readFileSync(docsPath, 'utf-8');
    const firstNode = old.indexOf('<!-- ASA-NODE:');
    const lastEnd = old.lastIndexOf('<!-- ASA-NODE-END -->');

    // footer：节点块与锚点之间的「中部」内容 + 最后一个 ASA-COMPILED 锚点之后的内容
    const anchorIdx = old.lastIndexOf('<!-- ASA-COMPILED:');
    const versionIdx = old.lastIndexOf('<!-- ASA-VERSION:');
    if (lastEnd >= 0) {
      const endOfBlock = lastEnd + '<!-- ASA-NODE-END -->'.length;
      const afterBlock = old.slice(endOfBlock);
      // 分离中部内容（节点块之后、锚点块之前）
      let middle = '';
      if (versionIdx > endOfBlock) {
        middle = old.slice(endOfBlock, versionIdx);
      } else if (anchorIdx < 0) {
        // 无锚点：节点块之后的全部视为中部
        const m = afterBlock.match(/\n?---\s*\n?([\s\S]*)$/);
        if (m) middle = m[1];
      }
      // 剔除中部内容中的 --- 分隔线
      middle = middle.replace(/^\s*\n?---\s*\n?/, '').trim();
      // 锚点之后的内容
      let afterAnchors = '';
      if (anchorIdx >= 0) {
        const nl = old.indexOf('\n', anchorIdx);
        if (nl >= 0) afterAnchors = old.slice(nl + 1).trim();
      }
      const merged = [middle, afterAnchors].filter(Boolean).join('\n\n');
      if (merged) userFooter = merged;
    }

    // header：锚点块之前 + 第一个 ASA-NODE 标记之前，取更早者；剥离旧 --- 与锚点
    const anchorBlockStart = anchorIdx >= 0 ? old.lastIndexOf('<!-- ASA-VERSION:', anchorIdx) : -1;
    const headEnd = Math.min(
      firstNode >= 0 ? firstNode : old.length,
      anchorBlockStart >= 0 ? anchorBlockStart : old.length
    );
    userHeader = old.slice(0, headEnd).trimEnd();
    userHeader = userHeader.replace(/\n?---\s*$/, '').trimEnd();
  }

  // 提取节点之间的手写笔记（keyed by 后续节点 ID），渲染时重新插入
  const nodeNotes = {};
  if (fs.existsSync(docsPath)) {
    const old = fs.readFileSync(docsPath, 'utf-8');
    const nodePositions = [];
    for (const match of old.matchAll(/<!-- ASA-NODE: ([A-Z]+-\d+) -->/g)) {
      nodePositions.push({ id: match[1], start: match.index });
    }
    for (let i = 1; i < nodePositions.length; i++) {
      const prevEnd = old.lastIndexOf('<!-- ASA-NODE-END -->', nodePositions[i].start);
      if (prevEnd < 0) continue;
      const gap = old.slice(prevEnd + '<!-- ASA-NODE-END -->'.length, nodePositions[i].start);
      const note = gap.replace(/^\s*\n?---\s*\n?/, '').replace(/\n?---\s*$/, '').trim();
      if (note) nodeNotes[nodePositions[i].id] = note;
    }
  }

  let reqContent = userHeader ? `${userHeader}\n\n---\n\n` : '# 项目核心需求资产清单\n\n';
  for (const [id, node] of Object.entries(nodes)) {
    if (node.__category !== 'requirements') continue;
    // 手写笔记插在节点块之前（上一节点 END 与本节点 START 之间），与提取位置一致，逐次编译稳定
    if (nodeNotes[id]) reqContent += `${nodeNotes[id]}\n\n`;
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
    } else if (node.acceptanceCriteria !== undefined) {
      console.warn(`[ASA] ⚠️ ${id} 的 acceptanceCriteria 不是数组（${typeof node.acceptanceCriteria}），compile 不渲染，patch 将跳过反写`);
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

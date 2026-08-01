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
    } else if (firstNode > 0) {
      userHeader = old.slice(0, firstNode).trimEnd();
      // 剥离上次编译追加的尾部 --- 分隔线，避免每次 compile 累积
      userHeader = userHeader.replace(/\n?---\s*$/, '').trimEnd();
    }
    if (lastEnd >= 0) {
      // 只保留 ASA-COMPILED 锚点之后的用户手写内容
      const anchorIdx = old.indexOf('<!-- ASA-COMPILED:', lastEnd);
      if (anchorIdx >= 0) {
        const nl = old.indexOf('\n', anchorIdx);
        if (nl >= 0) {
          const footer = old.slice(nl + 1).trim();
          if (footer) userFooter = footer;
        }
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
      node.acceptanceCriteria.forEach(c => { reqContent += `- ${c}\n`; });
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

  const newDigest = calculateDocsDigest();
  matrix.meta = matrix.meta || {};
  matrix.meta.docsExpectedDigest = newDigest;
  matrix.meta.docsActualDigest = newDigest;
  saveMatrix(matrix);
}

module.exports = { run };

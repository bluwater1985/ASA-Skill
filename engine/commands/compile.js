// engine/commands/compile.js — 节点 → docs 编译
const path = require('path');
const fs = require('fs');
const { loadMatrix, saveMatrix, loadAllNodes, calculateDocsDigest } = require('../lib/matrix.js');

const DOCS_DIR = path.join(process.cwd(), 'docs');

function run() {
  const matrix = loadMatrix();
  const nodes = loadAllNodes();
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR);

  let reqContent = '# 项目核心需求资产清单\n\n';
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

  fs.writeFileSync(path.join(DOCS_DIR, '01-requirements.md'), reqContent.trim(), 'utf-8');
  console.log('[ASA] Docs 编译完成。');

  const newDigest = calculateDocsDigest();
  matrix.meta = matrix.meta || {};
  matrix.meta.docsExpectedDigest = newDigest;
  matrix.meta.docsActualDigest = newDigest;
  saveMatrix(matrix);
}

module.exports = { run };

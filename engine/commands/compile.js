// engine/commands/compile.js — 节点 → docs 编译
const path = require('path');
const fs = require('fs');
const { loadMatrix, saveMatrix, loadAllNodes, calculateDocsDigest, docsDir, calculateNodesDigest } = require('../lib/matrix.js');
const { seedNarrativeDocs } = require('../lib/narrative-sync.js');

function compileDoc(docName, category, nodes, matrix) {
  const docsPath = path.join(docsDir(), docName);
  let userHeader = '';
  let userFooter = '';
  const nodeNotes = {};

  if (fs.existsSync(docsPath)) {
    const old = fs.readFileSync(docsPath, 'utf-8');
    const firstNode = old.indexOf('<!-- ASA-NODE:');
    const lastEnd = old.lastIndexOf('<!-- ASA-NODE-END -->');

    const anchorIdx = old.lastIndexOf('<!-- ASA-COMPILED:');
    const versionIdx = old.lastIndexOf('<!-- ASA-VERSION:');
    if (lastEnd >= 0) {
      const endOfBlock = lastEnd + '<!-- ASA-NODE-END -->'.length;
      const afterBlock = old.slice(endOfBlock);
      let middle = '';
      if (versionIdx > endOfBlock) {
        middle = old.slice(endOfBlock, versionIdx);
      } else if (anchorIdx < 0) {
        const m = afterBlock.match(/\n?---\s*\n?([\s\S]*)$/);
        if (m) middle = m[1];
      }
      middle = middle.replace(/^\s*\n?---\s*\n?/, '').trim();
      let afterAnchors = '';
      if (anchorIdx >= 0) {
        const nl = old.indexOf('\n', anchorIdx);
        if (nl >= 0) afterAnchors = old.slice(nl + 1).trim();
      }
      const merged = [middle, afterAnchors].filter(Boolean).join('\n\n');
      if (merged) userFooter = merged;
    }

    const anchorBlockStart = anchorIdx >= 0 ? old.lastIndexOf('<!-- ASA-VERSION:', anchorIdx) : -1;
    const headEnd = Math.min(
      firstNode >= 0 ? firstNode : old.length,
      anchorBlockStart >= 0 ? anchorBlockStart : old.length
    );
    userHeader = old.slice(0, headEnd).trimEnd();
    userHeader = userHeader.replace(/\n?---\s*$/, '').trimEnd();

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

  let defaultHeader = category === 'requirements' ? '# 项目核心需求资产清单\n\n' : '# 项目任务清单\n\n';
  let content = userHeader ? `${userHeader}\n\n---\n\n` : defaultHeader;

  // sort by ID ascending
  const nodeEntries = Object.entries(nodes)
    .filter(([, node]) => node.__category === category)
    .sort(([id1], [id2]) => {
      const num1 = parseInt(id1.split('-')[1] || '0', 10);
      const num2 = parseInt(id2.split('-')[1] || '0', 10);
      return num1 - num2;
    });

  for (const [id, node] of nodeEntries) {
    if (nodeNotes[id]) content += `${nodeNotes[id]}\n\n`;
    content += `<!-- ASA-NODE: ${id} -->\n`;
    content += `## ${id}: ${node.title || '未命名'}\n\n`;
    
    if (category === 'requirements') {
      content += `- 优先级: ${node.priority || 'P1'}\n`;
      content += `- 当前状态: ${node.status || 'pending'}\n`;
      if (node.version) content += `- 版本: ${node.version}\n`;
      content += `\n<!-- ASA-FIELD: acceptanceCriteria -->\n`;
      if (Array.isArray(node.acceptanceCriteria)) {
        node.acceptanceCriteria.forEach(c => {
          const lines = String(c).split('\n');
          content += `- ${lines[0]}\n`;
          for (let li = 1; li < lines.length; li++) content += `  ${lines[li]}\n`;
        });
      } else if (node.acceptanceCriteria !== undefined) {
        console.error(`[ASA] ⚠️ ${id} 的 acceptanceCriteria 不是数组（${typeof node.acceptanceCriteria}），compile 不渲染，patch 将跳过反写`);
      }
      if (node.spec) {
        content += `\n<!-- ASA-FIELD: spec -->\n\n${node.spec}\n`;
      }
    } else if (category === 'tasks') {
      content += `- 当前状态: ${node.status || 'pending'}\n`;
      if (node.version) content += `- 版本: ${node.version}\n`;
      
      const linkedReqs = node.linkedReqs || [];
      if (linkedReqs.length > 0) {
        content += `- 关联需求: ${linkedReqs.join(', ')}\n`;
      }
      
      const dependsOn = [];
      for (const e of (matrix.edges || [])) {
        if (e.to && e.type === 'depends') {
          const matchTo = Array.isArray(e.to) ? e.to.includes(id) : e.to === id;
          if (matchTo && e.from) {
            const froms = Array.isArray(e.from) ? e.from : [e.from];
            froms.forEach(f => { if (!dependsOn.includes(f)) dependsOn.push(f); });
          }
        }
      }
      if (dependsOn.length > 0) {
        content += `- 依赖任务: ${dependsOn.join(', ')}\n`;
      }
      
      content += `\n<!-- ASA-FIELD: description -->\n`;
      if (node.description) {
        content += `${node.description}\n`;
      } else {
        content += `(No description)\n`;
      }
    }

    content += `\n<!-- ASA-NODE-END -->\n\n---\n\n`;
  }

  let maxVersion = 1;
  for (const [, node] of nodeEntries) {
    if ((node.version || 1) > maxVersion) maxVersion = node.version;
  }
  content += `<!-- ASA-VERSION: ${maxVersion} -->\n`;
  content += `<!-- ASA-COMPILED: ${new Date().toISOString().split('T')[0]} -->\n`;

  if (userFooter) content += `\n${userFooter}\n`;

  const { getActiveTxId, registerFile } = require('../lib/transaction.js');
  const txId = getActiveTxId();
  if (txId) {
    registerFile(txId, docsPath);
  }

  const tmpPath = docsPath + '.tmp';
  fs.writeFileSync(tmpPath, content.trim(), 'utf-8');
  fs.renameSync(tmpPath, docsPath);
}

function run() {
  const matrix = loadMatrix();
  const nodes = loadAllNodes();
  if (!fs.existsSync(docsDir())) fs.mkdirSync(docsDir(), { recursive: true });

  compileDoc('01-requirements.md', 'requirements', nodes, matrix);
  compileDoc('03-tasks.md', 'tasks', nodes, matrix);

  console.log('[ASA] Docs 编译完成。');

  try {
    const { rebuildSummary } = require('../lib/matrix.js');
    rebuildSummary(matrix, nodes);
  } catch (e) {
    console.error(`[ASA] ❌ 编译后重建摘要失败: ${e.message}`);
    throw e;
  }

  const newDigest = calculateDocsDigest();
  matrix.meta = matrix.meta || {};
  matrix.meta.docsExpectedDigest = newDigest;
  matrix.meta.docsActualDigest = newDigest;
  matrix.meta.compiledDocsExpectedDigest = newDigest;
  matrix.meta.compiledDocsActualDigest = newDigest; // B-b 修复：双摘要 Actual 对称落盘
  const currentNodesDigest = calculateNodesDigest();
  matrix.meta.nodesDigest = currentNodesDigest;
  saveMatrix(matrix);

  // 首次自动播种叙事文档占位（00-overview / 02-architecture），仅补缺失、不覆盖已有
  const seeded = seedNarrativeDocs(docsDir(), currentNodesDigest, matrix.meta?.project);
  if (seeded.length > 0) {
    console.log(`[ASA] 已自动播种叙事文档: ${seeded.join(', ')}（请交给模型用 update-overview 填充内容）。`);
  }
}

module.exports = { run };

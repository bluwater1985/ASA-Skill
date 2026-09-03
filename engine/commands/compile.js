// engine/commands/compile.js — 节点 → docs 编译（按「未完成 / 已完成」分桶，集中注意力到未完成）
const path = require('path');
const fs = require('fs');
const { loadMatrix, saveMatrix, loadAllNodes, calculateDocsDigest, docsDir, calculateNodesDigest } = require('../lib/matrix.js');
const { seedNarrativeDocs } = require('../lib/narrative-sync.js');
const { getBucket } = require('../lib/state-machine.js');

// 每个类别的中文名（用于分区标题）
const CATEGORY_TITLES = { tasks: '任务', requirements: '需求', issues: '问题' };

/**
 * 渲染单个节点为一个完整可往返块（含用户手写批注 + ASA-NODE 标记 + 字段）。
 * 分桶只改变这些块的「输出顺序」，绝不删除节点，保证批注 / patch 反写安全。
 */
function nodeBlock(id, node, category, matrix, nodeNotes) {
  let block = nodeNotes[id] ? `${nodeNotes[id]}\n\n` : '';
  block += `<!-- ASA-NODE: ${id} -->\n`;
  block += `## ${id} - ${node.title || '未命名'}\n\n`;

  if (category === 'requirements') {
    block += `- 优先级: ${node.priority || 'P1'}\n`;
    block += `- 当前状态: ${node.status || 'pending'}\n`;
    if (node.version) block += `- 版本: ${node.version}\n`;
    block += `\n<!-- ASA-FIELD: acceptanceCriteria -->\n`;
    if (Array.isArray(node.acceptanceCriteria)) {
      node.acceptanceCriteria.forEach(c => {
        const lines = String(c).split('\n');
        block += `- ${lines[0]}\n`;
        for (let li = 1; li < lines.length; li++) block += `  ${lines[li]}\n`;
      });
    } else if (node.acceptanceCriteria !== undefined) {
      console.error(`[ASA] ⚠️ ${id} 的 acceptanceCriteria 不是数组（${typeof node.acceptanceCriteria}），compile 不渲染，patch 将跳过反写`);
    }
    if (node.spec) {
      block += `\n<!-- ASA-FIELD: spec -->\n\n${node.spec}\n`;
    }
  } else if (category === 'tasks') {
    block += `- 当前状态: ${node.status || 'pending'}\n`;
    if (node.version) block += `- 版本: ${node.version}\n`;

    const linkedReqs = node.linkedReqs || [];
    if (linkedReqs.length > 0) {
      block += `- 关联需求: ${linkedReqs.join(', ')}\n`;
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
      block += `- 依赖任务: ${dependsOn.join(', ')}\n`;
    }

    block += `\n<!-- ASA-FIELD: description -->\n`;
    if (node.description) {
      block += `${node.description}\n`;
    } else {
      block += `(No description)\n`;
    }
  } else if (category === 'issues') {
    block += `- 状态: ${node.status || 'open'}\n`;
    block += `- 类别: ${node.category || 'observation'}\n`;
    block += `- 严重度: ${node.severity || 'P2'}\n`;
    if (node.discoveredBy) block += `- 来源: ${node.discoveredBy}\n`;
    const linked = [...(node.linkedReqs || []), ...(node.linkedTasks || []), ...(node.linkedArch || [])];
    if (linked.length > 0) block += `- 关联: ${linked.join(', ')}\n`;
    if (node.version) block += `- 版本: ${node.version}\n`;
    if (node.description) block += `\n${node.description}\n`;
    if (node.resolution) {
      block += `\n- 处置: ${node.resolution.note || ''} (by ${node.resolution.by || ''})${node.resolution.verifiedAt ? '，已验收' : ''}\n`;
    }
  }

  block += `\n<!-- ASA-NODE-END -->`;
  return block;
}

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
    // 分区标记位于首节点之前：新文件在分区标记处截断 userHeader，避免把自动生成的
    // 分区标题/统计行当成用户手写头部而重复；旧文件无分区标记时回退到首节点截断（兼容）。
    const firstBucket = old.indexOf('<!-- ASA-BUCKETS -->');
    const nodeBoundary = (firstBucket >= 0 ? firstBucket : firstNode);
    const headEnd = Math.min(
      nodeBoundary >= 0 ? nodeBoundary : old.length,
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
      const between = old.slice(prevEnd + '<!-- ASA-NODE-END -->'.length, nodePositions[i].start);
      // 跨分区间隙（含 <!-- ASA-BUCKET --> 边界标记/分区标题）不是某个节点的批注，跳过，
      // 避免分区标题被误当 TASK 批注反复注入导致编译非幂等。
      if (between.includes('<!-- ASA-BUCKET')) continue;
      const note = between.replace(/^\s*\n?---\s*\n?/, '').replace(/\n?---\s*$/, '').trim();
      if (note) nodeNotes[nodePositions[i].id] = note;
    }
  }

  let defaultHeader = category === 'requirements' ? '# 项目核心需求资产清单\n\n' : category === 'issues' ? '# 项目问题清单\n\n' : '# 项目任务清单\n\n';
  let head = userHeader ? `${userHeader}\n\n---\n\n` : defaultHeader;

  // 按 ID ascending 收集本类别节点（桶内再排），保证渲染稳定
  const nodeEntries = Object.entries(nodes)
    .filter(([, node]) => node.__category === category)
    .sort(([id1], [id2]) => {
      const num1 = parseInt(id1.split('-')[1] || '0', 10);
      const num2 = parseInt(id2.split('-')[1] || '0', 10);
      return num1 - num2;
    });

  // 分桶：active（焦点） / done（沉底归档） / archived（默认隐藏，仅计入统计）
  const sections = { active: [], done: [], archived: [] };
  for (const [id, node] of nodeEntries) {
    const bucket = getBucket(id.split('-')[0], node.status);
    sections[bucket].push([id, node]);
  }

  const title = CATEGORY_TITLES[category] || '';
  const summaryLine =
    `共 ${nodeEntries.length} 个 · 未完成 ${sections.active.length} · 已完成 ${sections.done.length}` +
    (sections.archived.length ? ` · 已归档 ${sections.archived.length}` : '');

  // 编译主体：分区标记 + 统计行 + 🟢未完成 + ✅已完成（沉底）。archived 默认不渲染节点。
  // 关键：每个分区前放 <!-- ASA-BUCKET: ... --> 边界标记，间隙据此不当作节点批注。
  let body = `<!-- ASA-BUCKETS -->\n\n`;
  body += `> ${summaryLine}\n\n`;
  body += `<!-- ASA-BUCKET: active -->\n\n## 🟢 未完成${title}\n\n`;
  for (const [id, node] of sections.active) {
    body += nodeBlock(id, node, category, matrix, nodeNotes) + `\n\n---\n\n`;
  }
  if (sections.active.length === 0) {
    body += `(无未完成${title})\n\n`;
  }
  if (sections.done.length > 0) {
    body += `<!-- ASA-BUCKET: done -->\n\n## ✅ 已完成${title}（沉底归档）\n\n`;
    for (const [id, node] of sections.done) {
      body += nodeBlock(id, node, category, matrix, nodeNotes) + `\n\n---\n\n`;
    }
  }

  let maxVersion = 1;
  for (const [, node] of nodeEntries) {
    if ((node.version || 1) > maxVersion) maxVersion = node.version;
  }

  let content = head + body;
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
  compileDoc('04-issues.md', 'issues', nodes, matrix);

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

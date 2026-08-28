// engine/commands/overview.js — 项目摘要与只读总览 (update-overview)
const fs = require('fs');
const path = require('path');
const { loadMatrix, loadAllNodes, calculateNodesDigest } = require('../lib/matrix.js');
const { ENGINE_VERSION, MIN_SCHEMA_VERSION } = require('../version.js');
const { digestLine, basedOnAnchor, NARRATIVE_SYNC_TEMPLATE } = require('../lib/narrative-sync.js');

function run() {
  const matrix = loadMatrix();
  const sv = matrix.meta?.schemaVersion || 1;

  if (sv < MIN_SCHEMA_VERSION) {
    console.error(`[ASA] ❌ 当前项目 Schema 版本 (${sv}) 过低，本版本引擎 (${ENGINE_VERSION}) 需要 Schema >= ${MIN_SCHEMA_VERSION}。请执行 reconcile 升级。`);
    process.exit(1);
  }

  const nodes = loadAllNodes();
  const currentNodesDigest = calculateNodesDigest();
  
  const reqs = Object.values(nodes).filter(n => n.__category === 'requirements');
  const archs = Object.values(nodes).filter(n => n.__category === 'architecture');
  const tasks = Object.values(nodes).filter(n => n.__category === 'tasks');

  let output = `[ASA 项目总览摘要]\n\n`;
  output += `## 1. 节点规模统计 (Total Nodes)\n`;
  output += `- Requirements (需求节点): ${reqs.length}\n`;
  output += `- Architecture (架构节点): ${archs.length}\n`;
  output += `- Tasks (任务节点): ${tasks.length}\n\n`;
  
  output += `## 2. 需求素材 (Requirements)\n`;
  output += `(需求正文请直接读取编译产物 docs/01-requirements.md 作为素材，此处不重复枚举)\n`;
  
  output += `\n## 3. 架构组件 (Architecture)\n`;
  for (const a of archs) {
    let line = `- [${a.id}] ${a.title} (Status: ${a.status}, Version: ${a.version || 1})`;
    const desc = String(a.description || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 3).join(' ');
    if (desc) line += `\n   描述: ${desc}`;
    output += line + '\n';
  }

  output += `\n## 4. 任务素材 (Tasks)\n`;
  output += `(任务正文与完成/未完成状态请直接读取编译产物 docs/03-tasks.md 作为素材，此处不重复枚举)\n`;

  output += `\n## 5. 架构组件依赖图 (ARCH -> ARCH Dependencies)\n`;
  let archEdgesCount = 0;
  if (matrix.edges) {
    for (const e of matrix.edges) {
      if (e.from && e.to && e.from.startsWith('ARCH-') && e.to.startsWith('ARCH-')) {
        output += `- ${e.from} --[${e.type || 'extends'}]--> ${e.to}\n`;
        archEdgesCount++;
      }
    }
  }
  if (archEdgesCount === 0) {
    output += `(暂无架构组件间的直接依赖关系)\n`;
  }

  // 6. 最近 5 条项目变更
  output += `\n## 6. 最近项目变更历史 (Last 5 Changes)\n`;
  const entries = [];
  for (const [id, node] of Object.entries(nodes)) {
    if (Array.isArray(node.changeLog)) {
      for (const entry of node.changeLog) {
        entries.push({
          node: id,
          date: entry.date || '',
          type: entry.type || '',
          version: entry.version || '?',
          summary: entry.summary || '',
          by: entry.by || '?',
        });
      }
    }
  }
  entries.sort((a, b) => (b.date || '').localeCompare(a.date || '')); // 按日期从新到旧排序
  const lastChanges = entries.slice(0, 5);
  if (lastChanges.length > 0) {
    for (const e of lastChanges) {
      output += `- [${e.date}] [${e.node}] (v${e.version}) [${e.type} by ${e.by}]: ${e.summary}\n`;
    }
  } else {
    output += `(暂无变更记录)\n`;
  }

  // 7. 经验与技术禁忌沉淀 lessons.yaml（有界截断，避免爆上下文）
  const lessonsPath = path.join(process.cwd(), 'knowledge/lessons.yaml');
  if (fs.existsSync(lessonsPath)) {
    output += `\n## 7. 知识沉淀与业务禁忌 (lessons.yaml)\n`;
    try {
      const lessonsText = fs.readFileSync(lessonsPath, 'utf-8');
      const lines = lessonsText.split('\n');
      output += `${lines.slice(0, 60).join('\n')}\n`;
      if (lines.length > 60) output += `...(lessons.yaml 已截断，共 ${lines.length} 行，如需全文请读取 knowledge/lessons.yaml)\n`;
    } catch (e) {
      output += `(无法加载 lessons.yaml: ${e.message})\n`;
    }
  }

  output += `\n## 8. 叙事文档重写闭环 (00-overview / 02-architecture)\n`;
  output += `- ${digestLine('当前', currentNodesDigest)}\n`;
  output += `- 锚点写法（可直接照抄）: ${basedOnAnchor(currentNodesDigest)}\n`;
  output += NARRATIVE_SYNC_TEMPLATE;

  output += `\n注意: 此命令为纯只读，不会修改 00-overview.md 也不修改 02-architecture.md。需求/任务正文请以 docs/01-requirements.md 与 docs/03-tasks.md 为素材；本命令补齐架构、依赖边、lessons 与锚点。\n`;
  
  console.log(output);
}

module.exports = { run };

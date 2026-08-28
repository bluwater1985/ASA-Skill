// engine/lib/narrative-sync.js — 叙事文档（00-overview / 02-architecture）重写闭环工具
//
// 设计意图：`00-overview.md` / `02-architecture.md` 是散文叙事型文档，由模型（LLM）根据
// 节点骨架重写，并通过 `<!-- ASA-BASED-ON: <nodesDigest> -->` 锚点追踪过期。
// 本模块集中输出：
//   1) `digestLine` —— 一行可打印的 Nodes Digest（供 update-overview 一次命令闭环）
//   2) `basedOnAnchor` —— 标准锚点写法
//   3) `NARRATIVE_SYNC_TEMPLATE` —— 可复制给模型照抄的完整操作模板
// 供 update-overview / doctor / validate 三处复用，保证措辞与步骤一致。

const fs = require('fs');
const path = require('path');

// label 形如「当前」；digest 形如 "sha256:xxxx"
function digestLine(label, digest) {
  return `Nodes Digest (${label}): ${digest}`;
}

// 返回标准锚点 HTML 注释
function basedOnAnchor(digest) {
  return `<!-- ASA-BASED-ON: ${digest} -->`;
}

// 可复制给模型照抄的完整操作模板（doctor / validate / update-overview 共用）
const NARRATIVE_SYNC_TEMPLATE = [
  '',
  '[ASA 叙事文档重写操作模板] 请模型照抄执行以下步骤：',
  '  1) 读取 docs/01-requirements.md 与 docs/03-tasks.md   # 需求/任务的真实素材（compile 编译自 nodes/）',
  '  2) node .asa/index.js update-overview                  # 读取架构/依赖边/lessons，并输出 Nodes Digest 当前值',
  '  3) node .asa/index.js diagnose                         # 再次确认 Nodes Digest (当前) 作为锚点值',
  '  4) 用 write_file 重写 docs/00-overview.md 与 docs/02-architecture.md',
  '  5) 每份文档顶部写入同一锚点：',
  '       <!-- ASA-BASED-ON: <当前 Nodes Digest> -->',
  '  6) node .asa/index.js validate                         # 确认无 NARRATIVE_OUTDATED 告警',
  '',
].join('\n');

// 首次初始化时自动播种占位叙事文档（00-overview / 02-architecture）。
// - 仅在文件不存在时创建，绝不覆盖已有内容（模型可能已填充）。
// - 每个占位文件顶部写入当前 digest 锚点，并提示模型"保持锚点"。
// - 返回实际新建的文件名列表。
function seedNarrativeDocs(docsDir, nodesDigest, projectTitle) {
  const files = [
    { name: '00-overview.md', label: '项目总览', intro: '本文件由引擎在首次初始化时自动播种，请以 docs/01-requirements.md 与 docs/03-tasks.md 为需求/任务素材，运行 update-overview 获取架构/依赖/lessons，由模型用 write_file 填充项目总览叙述。' },
    { name: '02-architecture.md', label: '架构设计', intro: '本文件由引擎在首次初始化时自动播种，请以 docs/01-requirements.md 与 docs/03-tasks.md 为需求/任务素材，运行 update-overview 获取架构/依赖/lessons，由模型用 write_file 填充架构设计叙述。' },
  ];
  const created = [];
  for (const { name, label, intro } of files) {
    const p = path.join(docsDir, name);
    if (fs.existsSync(p)) continue; // 只播种缺失文件
    fs.mkdirSync(docsDir, { recursive: true });
    const content = [
      basedOnAnchor(nodesDigest),
      '',
      `# ${projectTitle || '项目'} — ${label}`,
      '',
      `> ${intro}`,
      '> **重要**：填充叙述时请保持顶部 `<!-- ASA-BASED-ON: ... -->` 锚点等于当前 Nodes Digest，',
      '> 否则 validate 会报 NARRATIVE_OUTDATED。',
      '',
    ].join('\n');
    fs.writeFileSync(p, content, 'utf-8');
    created.push(name);
  }
  return created;
}

module.exports = { digestLine, basedOnAnchor, NARRATIVE_SYNC_TEMPLATE, seedNarrativeDocs };

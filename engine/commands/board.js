// engine/commands/board.js — 聚焦看板：只把「未完成任务」摊到眼前，让人集中注意力。
// 用法: node .asa/index.js board [REQ-xxx]
// 只读命令，不写盘、不加锁。默认只展示 active 桶;done/archived 仅计数。
const { loadMatrix, loadAllNodes } = require('../lib/matrix.js');
const io = require('../lib/io.js');
const { getBucket } = require('../lib/state-machine.js');

// active 桶内按状态的分组展示顺序
const STATUS_ORDER = ['pending', 'in_progress', 'blocked', 'awaiting-confirmation'];
const STATUS_LABEL = {
  pending: '⏳ 待办',
  in_progress: '🔨 进行中',
  blocked: '⛔ 阻塞',
  'awaiting-confirmation': '🙋 待确认',
};

function run(args) {
  const matrix = loadMatrix();
  const nodes = loadAllNodes();
  const targetReq = (args || []).find(a => a && a.startsWith('REQ-'));

  if (targetReq && !nodes[targetReq]) {
    console.error(`[ASA] ❌ 需求 ${targetReq} 不存在`);
    process.exit(1);
  }

  const tasks = Object.entries(nodes)
    .filter(([id, n]) => n.__category === 'tasks' || id.startsWith('TASK-'))
    .map(([id, n]) => ({ id, ...n }));

  let filtered = tasks;
  if (targetReq) {
    filtered = tasks.filter(t => (t.linkedReqs || []).includes(targetReq));
  }

  // 阻塞来源：edges 中 type=depends 的前序任务
  const blockedBy = {};
  for (const e of (matrix.edges || [])) {
    if (e.type === 'depends' && e.from && e.to) {
      const froms = Array.isArray(e.from) ? e.from : [e.from];
      const tos = Array.isArray(e.to) ? e.to : [e.to];
      for (const f of froms) {
        for (const t of tos) {
          if (f.startsWith('TASK-') && t.startsWith('TASK-')) {
            (blockedBy[t] = blockedBy[t] || []).push(f);
          }
        }
      }
    }
  }

  const active = filtered.filter(t => getBucket('TASK', t.status) === 'active');
  const doneCount = filtered.filter(t => getBucket('TASK', t.status) === 'done').length;
  const archCount = filtered.filter(t => getBucket('TASK', t.status) === 'archived').length;

  if (io.jsonOut({
    target: targetReq || null,
    total: filtered.length,
    counts: { active: active.length, done: doneCount, archived: archCount },
    items: active
      .map(a => ({
        id: a.id, title: a.title, status: a.status,
        linkedReqs: a.linkedReqs || [],
        blockedBy: [...new Set(blockedBy[a.id] || [])].sort(),
      }))
      .sort((x, y) => String(x.id).localeCompare(String(y.id))),
  })) return;

  const groups = {};
  for (const t of active) (groups[t.status] = groups[t.status] || []).push(t);

  let out = `[ASA 🔥 聚焦看板]${targetReq ? ` (针对 ${targetReq})` : ''}\n`;
  out += `未完成 ${active.length} · 已完成 ${doneCount} · 已归档 ${archCount} (共 ${filtered.length})\n\n`;

  if (active.length === 0) {
    out += `🎉 没有未完成任务，全部完成！\n`;
    console.log(out);
    return;
  }

  for (const st of STATUS_ORDER) {
    const list = (groups[st] || []).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    out += `### ${STATUS_LABEL[st]} (${list.length})\n`;
    if (list.length === 0) { out += `(无)\n\n`; continue; }
    for (const t of list) {
      out += `- [${t.id}] ${t.title}`;
      const reqs = (t.linkedReqs || []).join(', ');
      if (reqs) out += `  归属: ${reqs}`;
      if (st === 'blocked' && blockedBy[t.id]) out += `  ⚠️ 阻塞于: ${[...new Set(blockedBy[t.id])].sort().join(', ')}`;
      if (st === 'awaiting-confirmation') out += `  🙋 等待确认`;
      out += `\n`;
    }
    out += `\n`;
  }

  // 未识别的 active 状态兜底（未来状态机新增状态时不会被静默丢弃）
  const unknown = Object.keys(groups).filter(s => !STATUS_ORDER.includes(s));
  for (const s of unknown) {
    out += `### ${s} (${groups[s].length})\n`;
    for (const t of groups[s].sort((a, b) => String(a.id).localeCompare(String(b.id)))) out += `- [${t.id}] ${t.title}\n`;
    out += `\n`;
  }

  console.log(out);
}

module.exports = { run };

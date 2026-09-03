// engine/commands/list.js — 列出节点简清单 (list-req / list-arch / list-task / list-issue)
// 分桶：默认只列「未完成」，可用 --done / --archived / --all 切换，帮助人集中注意力。
const { loadAllNodes } = require('../lib/matrix.js');
const io = require('../lib/io.js');
const { getBucket } = require('../lib/state-machine.js');

function run(type, args) {
  const keyMap = {
    'req': { cat: 'requirements', name: '需求', prefix: 'REQ' },
    'arch': { cat: 'architecture', name: '架构组件', prefix: 'ARCH' },
    'task': { cat: 'tasks', name: '任务', prefix: 'TASK' },
    'issue': { cat: 'issues', name: '问题', prefix: 'ISSUE' }
  };

  const cfg = keyMap[type];
  if (!cfg) {
    console.error(`[ASA] ❌ 未知列表类型: ${type}`);
    process.exit(1);
  }

  // 解析筛选 flag：默认 active（未完成）；--done / --archived / --all
  const flags = (args || []).filter(a => a && a.startsWith('--'));
  let filter = 'active';
  if (flags.includes('--all') || flags.includes('-a')) filter = 'all';
  else if (flags.includes('--archived')) filter = 'archived';
  else if (flags.includes('--done')) filter = 'done';
  else if (flags.includes('--active')) filter = 'active';

  const nodes = loadAllNodes();
  const entries = Object.values(nodes).filter(n => n.__category === cfg.cat || (n.id && n.id.startsWith(cfg.prefix)));

  const rows = entries
    .map(n => {
      const id = n.id;
      return {
        id, title: n.title, status: n.status || (cfg.prefix === 'ISSUE' ? 'open' : 'unknown'),
        version: n.version || 1, priority: n.priority,
        bucket: getBucket((id || '').split('-')[0], n.status),
      };
    })
    .sort((a, b) => {
      const na = parseInt((a.id || '').split('-')[1] || '0', 10);
      const nb = parseInt((b.id || '').split('-')[1] || '0', 10);
      return na - nb;
    });

  const counts = { active: 0, done: 0, archived: 0 };
  for (const r of rows) counts[r.bucket] = (counts[r.bucket] || 0) + 1;
  const shown = filter === 'all' ? rows : rows.filter(r => r.bucket === filter);

  if (io.jsonOut({ type, filter, counts, count: shown.length, items: shown })) return;

  if (rows.length === 0) {
    console.log(`[ASA] 📋 ${cfg.name} 列表为空`);
    return;
  }

  const filterHint =
    filter === 'active' ? ` [默认仅未完成，--all 查看全部]`
    : ` [筛选: ${filter}]`;

  console.log(`[ASA] 📋 ${cfg.name} 列表 (共 ${rows.length} 个 · 未完成 ${counts.active} · 已完成 ${counts.done} · 已归档 ${counts.archived || 0})${filterHint}`);
  for (const n of shown) {
    let detail = `Status: ${n.status || 'unknown'}, Version: ${n.version || 1}`;
    if ((type === 'req' || type === 'issue') && n.priority) {
      detail += `, Priority: ${n.priority}`;
    }
    console.log(`  - ${n.id}: ${n.title} [${detail}]`);
  }
}

module.exports = { run };

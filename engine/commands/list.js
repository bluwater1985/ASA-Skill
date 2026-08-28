// engine/commands/list.js — 列出节点简清单 (list-req / list-arch / list-task)
const { loadAllNodes } = require('../lib/matrix.js');

function run(type) {
  const keyMap = {
    'req': { cat: 'requirements', name: '需求', prefix: 'REQ' },
    'arch': { cat: 'architecture', name: '架构组件', prefix: 'ARCH' },
    'task': { cat: 'tasks', name: '任务', prefix: 'TASK' }
  };

  const cfg = keyMap[type];
  if (!cfg) {
    console.error(`[ASA] ❌ 未知列表类型: ${type}`);
    process.exit(1);
  }

  const nodes = loadAllNodes();
  const entries = Object.values(nodes).filter(n => n.__category === cfg.cat || (n.id && n.id.startsWith(cfg.prefix)));

  if (entries.length === 0) {
    console.log(`[ASA] 📋 ${cfg.name} 列表为空`);
    return;
  }

  console.log(`[ASA] 📋 ${cfg.name} 列表 (共 ${entries.length} 个):`);
  for (const n of entries) {
    let detail = `Status: ${n.status || 'unknown'}, Version: ${n.version || 1}`;
    if (type === 'req' && n.priority) {
      detail += `, Priority: ${n.priority}`;
    }
    console.log(`  - ${n.id}: ${n.title} [${detail}]`);
  }
}

module.exports = { run };

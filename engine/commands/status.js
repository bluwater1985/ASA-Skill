// engine/commands/status.js — 状态机推进
const path = require('path');
const { loadAllNodes, atomicWriteYaml } = require('../lib/matrix.js');
const { validateTransition } = require('../lib/state-machine.js');
const { appendChangeLog } = require('../lib/changelog.js');

function run(id, newStatus) {
  if (!id || !newStatus) {
    console.error('[ASA] 用法: node .asa/index.js status <ID> <new-status>');
    process.exit(1);
  }

  const nodes = loadAllNodes();
  const node = nodes[id];
  if (!node) {
    console.error(`[ASA] ❌ 节点 ${id} 不存在`);
    process.exit(1);
  }

  const oldStatus = node.status || 'pending';
  const result = validateTransition(id, oldStatus, newStatus);
  if (!result.valid) {
    console.error(`[ASA] ❌ ${result.error}`);
    process.exit(1);
  }

  node.status = newStatus;
  const version = appendChangeLog(node, newStatus, `状态变更: ${oldStatus} → ${newStatus}`);

  const cat = node.__category;
  if (cat) {
    delete node.__category;
    atomicWriteYaml(path.join(process.cwd(), `.asa/nodes/${cat}/${id}.yaml`), node);
    node.__category = cat;
  }

  console.log(`[ASA] ✅ ${id}: ${oldStatus} → ${newStatus} (v${version})`);
}

module.exports = { run };

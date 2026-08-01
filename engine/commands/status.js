// engine/commands/status.js — 状态机推进
const path = require('path');
const { loadMatrix, saveMatrix, loadAllNodes, atomicWriteYaml } = require('../lib/matrix.js');
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

  // 缺失 status 时按类型回退初始态：REQ→proposed, ARCH→draft, TASK→pending
  const INITIAL = { REQ: 'proposed', ARCH: 'draft', TASK: 'pending' };
  const type = (id || '').split('-')[0];
  const oldStatus = node.status || INITIAL[type] || 'pending';

  // 同状态自转换 → 幂等成功
  if (oldStatus === newStatus) {
    console.log(`[ASA] ℹ️ ${id} 已是 ${newStatus}，无需变更`);
    return;
  }

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

  // 同步更新 matrix 摘要索引，避免陈旧状态
  try {
    const matrix = loadMatrix();
    const mapKey = cat === 'requirements' ? 'requirements' : cat === 'architecture' ? 'architecture' : 'tasks';
    if (matrix[mapKey] && matrix[mapKey][id]) {
      matrix[mapKey][id].status = newStatus;
      saveMatrix(matrix);
    }
  } catch (e) { /* 摘要同步失败不影响主操作 */ }

  console.log(`[ASA] ✅ ${id}: ${oldStatus} → ${newStatus} (v${version})`);

  // 自动重编译 docs，避免节点状态与 docs 不一致
  try {
    const { run: compile } = require('./compile.js');
    compile();
  } catch (e) { /* docs 编译失败不影响状态变更 */ }
}

module.exports = { run };

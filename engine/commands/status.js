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

  // 解析 --by 审计参数
  let by = '';
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--by' && i + 1 < process.argv.length) {
      by = process.argv[i + 1];
      break;
    }
  }

  // 强拦截任务终态流转（completed/verified）直接通过 status 命令绕过漏洞
  // 例外：如果是 completed -> verified 且提供了 --by 参数，则予以合规放行
  if (type === 'TASK' && ['completed', 'verified'].includes(newStatus)) {
    if (oldStatus === 'completed' && newStatus === 'verified') {
      if (!by || !by.trim()) {
        console.error('[ASA] ❌ 缺少 --by 审计参数');
        process.exit(1);
      }
    } else {
      console.error('[ASA] ❌ 任务节点的终态流转（completed/verified）必须通过专用审核命令处理，严禁通过 status 绕过门禁（此动作不允许）');
      process.exit(1);
    }
  }

  // 同状态自转换 → 幂等成功
  if (oldStatus === newStatus) {
    console.log(`[ASA] ℹ️ ${id} 已是 ${newStatus}，无需变更`);
    return;
  }

  // 拦截状态为 awaiting-confirmation 的任务通过通用 status 命令流转
  if (oldStatus === 'awaiting-confirmation') {
    console.error(`[ASA] ❌ 状态为 awaiting-confirmation 的任务不允许通过 status 命令进行流转`);
    process.exit(1);
  }

  const result = validateTransition(id, oldStatus, newStatus);
  if (!result.valid) {
    console.error(`[ASA] ❌ ${result.error}`);
    process.exit(1);
  }

  // cancelled -> pending 流转强锁 --by 人工确权卫兵
  if (type === 'TASK' && oldStatus === 'cancelled' && newStatus === 'pending') {
    if (!by || !by.trim()) {
      console.error("[ASA] ❌ 缺少 --by 审计参数，不允许将已取消的 TASK 恢复为 pending。");
      process.exit(1);
    }
  }

  // completed -> pending/in_progress 返工回开：必须提供 --by 人工确权，杜绝无审计返工
  if (type === 'TASK' && oldStatus === 'completed' && (newStatus === 'pending' || newStatus === 'in_progress')) {
    if (!by || !by.trim()) {
      console.error("[ASA] ❌ 缺少 --by 审计参数，不允许将已完成(completed)的 TASK 返工回开为 pending/in_progress。");
      process.exit(1);
    }
  }

  node.status = newStatus;
  let version;
  if (type === 'TASK' && oldStatus === 'cancelled' && newStatus === 'pending') {
    version = appendChangeLog(node, 'pending', `从已取消状态恢复: --by ${by}`, by);
    node.changeLog[node.changeLog.length - 1].text = "从已取消状态恢复";
  } else if (type === 'TASK' && oldStatus === 'completed' && (newStatus === 'pending' || newStatus === 'in_progress')) {
    version = appendChangeLog(node, 'reopen', `任务返工(completed reopen): ${oldStatus} → ${newStatus} --by ${by}`, by);
  } else {
    version = appendChangeLog(node, newStatus, `状态变更: ${oldStatus} → ${newStatus}`, by || 'user');
  }

  const cat = node.__category;
  if (cat) {
    delete node.__category;
    atomicWriteYaml(path.join(process.cwd(), `.asa/nodes/${cat}/${id}.yaml`), node);
    node.__category = cat;
  }

  // 同步更新 matrix 摘要索引，避免陈旧状态；若目标状态为取消/已完成等终态，且节点为当前 active-task，自动归零
  try {
    const matrix = loadMatrix();
    const mapKey = cat === 'requirements' ? 'requirements' : cat === 'architecture' ? 'architecture' : 'tasks';
    if (matrix[mapKey] && matrix[mapKey][id]) {
      matrix[mapKey][id].status = newStatus;
    }

    const finalStates = ['cancelled', 'completed', 'verified'];
    if (finalStates.includes(newStatus) && matrix.meta && matrix.meta.activeTask === id) {
      matrix.meta.activeTask = '(none)';
    }

    saveMatrix(matrix);
  } catch (e) {
    console.error(`[ASA] ❌ matrix 摘要同步失败: ${e.message}`);
    throw e;
  }

  if (newStatus === 'awaiting-confirmation') {
    console.log('[ASA] 等待用户确认');
  }

  console.log(`[ASA] ✅ ${id}: ${oldStatus} → ${newStatus} (v${version})`);

  // 自动重编译 docs，避免节点状态与 docs 不一致
  try {
    const { run: compile } = require('./compile.js');
    compile();
  } catch (e) {
    console.error(`[ASA] ❌ compile 失败，将回滚当前写入。错误: ${e.message}`);
    throw e;
  }
}

module.exports = { run };

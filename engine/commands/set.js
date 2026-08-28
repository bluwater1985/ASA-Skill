// engine/commands/set.js — 项目级设置 (set phase / set active-task / set active-task clear)
const { loadMatrix, saveMatrix, loadAllNodes } = require('../lib/matrix.js');

function run(what, value) {
  const matrix = loadMatrix();

  if (what === 'phase') {
    const valid = ['init', 'discovery', 'architecture', 'task-breakdown', 'implementation', 'review'];
    if (!valid.includes(value)) {
      console.error(`[ASA] ❌ 无效阶段: ${value}，可用: ${valid.join(' | ')}`);
      process.exit(1);
    }
    matrix.meta = matrix.meta || {};
    matrix.meta.phase = value;
    saveMatrix(matrix);
    console.log(`[ASA] ✅ 阶段已更新: ${value}`);
    return;
  }

  if (what === 'active-task') {
    matrix.meta = matrix.meta || {};
    if (value === 'clear' || value === 'none' || value === '(none)') {
      matrix.meta.activeTask = '(none)';
      saveMatrix(matrix);
      console.log('[ASA] ✅ 活跃任务已清除');
      return;
    }
    // 校验必须是 TASK 节点
    if (!value.startsWith('TASK-')) {
      console.error(`[ASA] ❌ 活跃任务必须是 TASK 节点（收到: ${value}）`);
      process.exit(1);
    }
    const nodes = loadAllNodes();
    if (!nodes[value]) {
      console.error(`[ASA] ❌ 任务 ${value} 不存在（可用节点: ${Object.keys(nodes).filter(n => n.startsWith('TASK-')).join(', ') || '无'}）`);
      process.exit(1);
    }
    // 拒绝把终态任务设为活跃
    const TERMINAL = ['completed', 'verified', 'cancelled'];
    const taskStatus = nodes[value].status || 'pending';
    if (TERMINAL.includes(taskStatus)) {
      console.error(`[ASA] ❌ 任务 ${value} 已是终态（${taskStatus}），不能设为活跃`);
      process.exit(1);
    }
    if (taskStatus === 'awaiting-confirmation') {
      console.error(`[ASA] ❌ 任务 ${value} 当前状态为 awaiting-confirmation，不能设为活跃。需先由用户确认或打回。`);
      process.exit(1);
    }
    matrix.meta.activeTask = value;
    saveMatrix(matrix);
    console.log(`[ASA] ✅ 活跃任务: ${value}`);
    return;
  }

  console.error('[ASA] 用法:');
  console.error('  node .asa/index.js set phase <init|discovery|architecture|task-breakdown|implementation|review>');
  console.error('  node .asa/index.js set active-task <TASK-ID>');
  console.error('  node .asa/index.js set active-task clear');
  process.exit(1);
}

module.exports = { run };

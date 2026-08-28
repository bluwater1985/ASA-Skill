// engine/commands/cancel.js — 任务取消 (cancel-task)
const path = require('path');
const { loadMatrix, saveMatrix, loadAllNodes, atomicWriteYaml } = require('../lib/matrix.js');
const { appendChangeLog } = require('../lib/changelog.js');

function run(args) {
  if (!args || args.length === 0) {
    console.error('[ASA] 用法: node .asa/index.js cancel-task <TASK-ID> --by <user> --note "..."');
    process.exit(1);
  }

  const id = args[0];
  if (!id.startsWith('TASK-')) {
    console.error(`[ASA] ❌ 节点 ${id} 不是 TASK 节点`);
    process.exit(1);
  }

  const nodes = loadAllNodes();
  const node = nodes[id];
  if (!node) {
    console.error(`[ASA] ❌ 任务 ${id} 不存在`);
    process.exit(1);
  }

  let by = '';
  let note = '';
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--by' && i + 1 < args.length) {
      by = args[++i];
    } else if ((args[i] === '--note' || args[i] === '--reason') && i + 1 < args.length) {
      note = args[++i];
    }
  }

  // N2 强拦截：cancel-task 强制要求提供 --by 审计参数
  if (!by || !by.trim()) {
    console.error('[ASA] ❌ 缺少 --by 审计参数');
    process.exit(1);
  }

  const oldStatus = node.status || 'pending';

  // 幂等处理：若已取消，则直接返回成功
  if (oldStatus === 'cancelled') {
    console.log(`[ASA] ℹ️ 任务 ${id} 已是 cancelled，无需变更`);
    return;
  }

  if (oldStatus !== 'awaiting-confirmation') {
    console.error(`[ASA] ❌ 任务 ${id} 当前状态不是 awaiting-confirmation，无法取消（当前状态: ${oldStatus}）`);
    process.exit(1);
  }

  node.status = 'cancelled';
  node.confirmation = {
    status: 'cancelled',
    by: by || 'user',
    note: note || '',
    at: new Date().toISOString()
  };

  const version = appendChangeLog(node, 'cancelled', `任务取消: ${oldStatus} → cancelled`, by || 'user');

  // 写入物理文件
  const cat = node.__category || 'tasks';
  if (node.__category) {
    delete node.__category;
  }
  atomicWriteYaml(path.join(process.cwd(), `.asa/nodes/${cat}/${id}.yaml`), node);
  node.__category = cat;

  // 更新 matrix
  try {
    const matrix = loadMatrix();
    if (matrix.tasks && matrix.tasks[id]) {
      matrix.tasks[id].status = 'cancelled';
    }
    if (matrix.meta && matrix.meta.activeTask === id) {
      matrix.meta.activeTask = '(none)';
    }
    saveMatrix(matrix);
  } catch (e) {
    console.error(`[ASA] ❌ matrix 摘要更新失败: ${e.message}`);
    throw e;
  }

  console.log(`[ASA] ✅ 任务已取消: ${id} (v${version})`);

  // 自动编译
  try {
    const { run: compile } = require('./compile.js');
    compile();
  } catch (e) {
    console.error(`[ASA] ❌ compile 失败，将回滚当前写入。错误: ${e.message}`);
    throw e;
  }
}

module.exports = { run };

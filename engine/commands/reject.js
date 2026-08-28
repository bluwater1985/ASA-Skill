// engine/commands/reject.js — 打回任务 (reject-task)
const path = require('path');
const { loadMatrix, saveMatrix, loadAllNodes, atomicWriteYaml } = require('../lib/matrix.js');
const { appendChangeLog } = require('../lib/changelog.js');

function run(args) {
  if (!args || args.length === 0) {
    console.error('[ASA] 用法: node .asa/index.js reject-task <TASK-ID> --by <user> --note "..."');
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
  let noIssue = false;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--by' && i + 1 < args.length) {
      by = args[++i];
    } else if ((args[i] === '--note' || args[i] === '--reason') && i + 1 < args.length) {
      note = args[++i];
    } else if (args[i] === '--no-issue') {
      noIssue = true;
    }
  }

  // N2 强拦截：reject-task 强制要求提供 --by 审计参数
  if (!by || !by.trim()) {
    console.error('[ASA] ❌ 缺少 --by 审计参数');
    process.exit(1);
  }

  const oldStatus = node.status || 'pending';

  // 幂等处理：若已打回并处于 in_progress 状态，直接返回成功
  if (oldStatus === 'in_progress') {
    console.log(`[ASA] ℹ️ 任务 ${id} 已是 in_progress，无需变更`);
    return;
  }

  if (oldStatus !== 'awaiting-confirmation') {
    console.error(`[ASA] ❌ 任务 ${id} 当前状态不是 awaiting-confirmation，无法打回（当前状态: ${oldStatus}）`);
    process.exit(1);
  }

  node.status = 'in_progress';
  node.confirmation = {
    status: 'changes-requested',
    by: by || 'user',
    note: note || '',
    at: new Date().toISOString()
  };

  const version = appendChangeLog(node, 'in_progress', `任务打回: ${oldStatus} → in_progress`, by || 'user');

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
      matrix.tasks[id].status = 'in_progress';
    }
    saveMatrix(matrix);
  } catch (e) {
    console.error(`[ASA] ❌ matrix 摘要更新失败: ${e.message}`);
    throw e;
  }

  console.log(`[ASA] ✅ 任务已打回: ${id} (v${version})`);

  // reviewer 驳回 → 自动升 ISSUE 留痕（--no-issue 跳过）：把"为什么不合规"落进问题管理
  if (!noIssue) {
    const { createIssue } = require('../lib/issue.js');
    const issueId = createIssue({
      title: `驳回: ${node.title}`,
      description: `任务 ${id} 被 ${by || 'user'} 驳回，原因: ${note || '（未填写）'}。原确认信息: ${JSON.stringify(node.confirmation || {})}`,
      category: 'observation',
      severity: 'P2',
      linkedTasks: [id],
      by: by || 'user',
      discoveredBy: 'reject',
      note: note || `任务 ${id} 被打回`,
    });
    console.log(`[ASA] ℹ️ 已自动升 ISSUE ${issueId}（记录驳回问题；可用 --no-issue 跳过）`);
  }

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

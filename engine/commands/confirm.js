// engine/commands/confirm.js — 确认任务 (confirm-task)
const fs = require('fs');
const path = require('path');
const { loadMatrix, saveMatrix, loadAllNodes, atomicWriteYaml } = require('../lib/matrix.js');
const { appendChangeLog } = require('../lib/changelog.js');

function run(args) {
  if (!args || args.length === 0) {
    console.error('[ASA] 用法: node .asa/index.js confirm-task <TASK-ID> --by <user> --note "..."');
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
  let allowNoFiles = false;
  let overrideReason = '';
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--by' && i + 1 < args.length) {
      by = args[++i];
    } else if ((args[i] === '--note' || args[i] === '--reason') && i + 1 < args.length) {
      note = args[++i];
    } else if (args[i] === '--allow-no-files' && i + 1 < args.length) {
      allowNoFiles = true;
      overrideReason = args[++i];
    }
  }

  // N2 强拦截：confirm-task 强制要求提供 --by 审计参数
  if (!by || !by.trim()) {
    console.error('[ASA] ❌ 缺少 --by 审计参数');
    process.exit(1);
  }

  const oldStatus = node.status || 'pending';

  // 幂等处理：若已确认完成，直接返回成功
  if (oldStatus === 'completed') {
    console.log(`[ASA] ℹ️ 任务 ${id} 已是 completed，无需变更`);
    return;
  }

  if (oldStatus !== 'awaiting-confirmation') {
    console.error(`[ASA] ❌ 任务 ${id} 当前状态不是 awaiting-confirmation，无法确认（当前状态: ${oldStatus}）`);
    process.exit(1);
  }

  // N3 实现落地门禁 (D2)：拒绝「声明完成但代码未落地」的台账漂移。
  // 强制要求：changedFiles 非空 + 每个路径在工作树真实存在。
  // 豁免：--allow-no-files "<理由>" 显式放行并留痕（用于不产出文件/外部交付的任务）。
  const changedFiles = Array.isArray(node.changedFiles) ? node.changedFiles : [];
  if (!allowNoFiles) {
    if (changedFiles.length === 0) {
      console.error('[ASA] ❌ 任务未记录任何变更文件（changedFiles 为空），无法确认完成。请先用 record-changes 登记实施文件；若确实不产生文件变更，请显式传 --allow-no-files "<理由>"。');
      console.error('[ASA] 💡 提示: 如需把"实现未落地/不合规"正式存档为问题，可运行 add-issue "<标题>" --category observation --desc "<说明>" --task ' + id);
      process.exit(1);
    }
    const missing = [];
    for (const f of changedFiles) {
      const norm = String(f).replace(/\\/g, '/');
      if (!fs.existsSync(path.resolve(process.cwd(), norm))) missing.push(norm);
    }
    if (missing.length > 0) {
      console.error(`[ASA] ❌ 下列实施文件在工作树中不存在，无法确认完成: ${missing.join(', ')}。请补齐文件或核实路径；确属外部/不留盘交付可显式传 --allow-no-files "<理由>"。`);
      console.error('[ASA] 💡 提示: 如需把"实现未落地/不合规"正式存档为问题，可运行 add-issue "<标题>" --category observation --desc "<说明>" --task ' + id);
      process.exit(1);
    }
  }

  node.status = 'completed';
  node.confirmation = {
    status: 'confirmed',
    by: by || 'user',
    note: note || '',
    at: new Date().toISOString()
  };
  if (allowNoFiles) {
    node.confirmation.overrideReason = overrideReason || 'no-files (not verified by existence check)';
    node.confirmation.bypassedFiles = changedFiles;
  }

  const version = appendChangeLog(node, 'completed', `任务确认: ${oldStatus} → completed`, by || 'user');

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
      matrix.tasks[id].status = 'completed';
    }
    if (matrix.meta && matrix.meta.activeTask === id) {
      matrix.meta.activeTask = '(none)';
    }
    saveMatrix(matrix);
  } catch (e) {
    console.error(`[ASA] ❌ matrix 摘要更新失败: ${e.message}`);
    throw e;
  }

  console.log(`[ASA] ✅ 任务已确认: ${id} (v${version})`);

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

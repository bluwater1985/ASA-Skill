// engine/commands/record-changes.js
const path = require('path');
const { loadAllNodes, atomicWriteYaml } = require('../lib/matrix.js');
const { appendChangeLog } = require('../lib/changelog.js');

function run(args) {
  if (!args || args.length < 2) {
    console.error('[ASA] 用法: node .asa/index.js record-changes <TASK-ID> <file1> [file2]...');
    process.exit(1);
  }

  const taskId = args[0];
  const files = args.slice(1);

  if (!taskId.startsWith('TASK-')) {
    console.error(`[ASA] ❌ 节点 ${taskId} 不是 TASK 节点`);
    process.exit(1);
  }

  const nodes = loadAllNodes();
  const taskNode = nodes[taskId];

  if (!taskNode) {
    console.error(`[ASA] ❌ 任务 ${taskId} 不存在`);
    process.exit(1);
  }

  const allowedStatuses = ['pending', 'in_progress'];
  if (!allowedStatuses.includes(taskNode.status)) {
    console.error(`[ASA] ❌ 任务 ${taskId} 处于 ${taskNode.status} 状态，无法记录变更`);
    process.exit(1);
  }

  taskNode.changedFiles = taskNode.changedFiles || [];
  
  let addedCount = 0;
  for (let file of files) {
    // path normalize to forward slashes
    const normalizedPath = file.replace(/\\/g, '/');
    if (!taskNode.changedFiles.includes(normalizedPath)) {
      taskNode.changedFiles.push(normalizedPath);
      addedCount++;
    }
  }

  if (addedCount === 0) {
    console.log(`[ASA] ℹ️ 任务 ${taskId} 变更文件均已存在，无需重复记录`);
    return;
  }

  const version = appendChangeLog(taskNode, 'modified', `记录变更文件: ${addedCount} 个`, 'user');

  // 写盘
  const cat = taskNode.__category || 'tasks';
  if (taskNode.__category) {
    delete taskNode.__category;
  }
  atomicWriteYaml(path.join(process.cwd(), `.asa/nodes/${cat}/${taskId}.yaml`), taskNode);
  taskNode.__category = cat;

  console.log(`[ASA] ✅ 任务变更记录成功: ${taskId} (新增 ${addedCount} 个文件) (v${version})`);

  // 自动重编译 docs + 刷新 nodesDigest
  try {
    const { run: compile } = require('./compile.js');
    compile();
  } catch (e) {
    console.error(`[ASA] ❌ compile 失败，将回滚当前写入。错误: ${e.message}`);
    throw e;
  }
}

module.exports = { run };

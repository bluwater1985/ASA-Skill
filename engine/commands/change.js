// engine/commands/change.js — 变更入口 (change-req / change-arch / change-task)
const path = require('path');
const fs = require('fs');
const { loadAllNodes } = require('../lib/matrix.js');

// REQ 是传播链唯一入口；ARCH/TASK 变更不触发传播链
const PROPAGATES = { 'REQ': true, 'ARCH': false, 'TASK': false };

function run(cmd, id) {
  if (!id) {
    console.error('[ASA] 用法: node .asa/index.js <change-req|change-arch|change-task> <ID>');
    process.exit(1);
  }

  const nodes = loadAllNodes();
  const node = nodes[id];
  if (!node) {
    console.error(`[ASA] ❌ 节点 ${id} 不存在`);
    process.exit(1);
  }

  const type = (id || '').split('-')[0];
  const cat = node.__category;
  const filePath = path.join(process.cwd(), `.asa/nodes/${cat}/${id}.yaml`);

  // 创建快照备份（同毫秒冲突时追加计数后缀）
  const backupDir = path.join(process.cwd(), '.asa/backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const ts = Date.now();
  let backupPath = path.join(backupDir, `${id}.${ts}.yaml`);
  let n = 1;
  while (fs.existsSync(backupPath)) {
    backupPath = path.join(backupDir, `${id}.${ts}-${n++}.yaml`);
  }
  fs.copyFileSync(filePath, backupPath);

  console.log(`[ASA] ${id} 准备变更`);
  console.log(`  文件: .asa/nodes/${cat}/${id}.yaml`);
  console.log(`  快照: ${backupPath}`);
  console.log('');

  if (PROPAGATES[type]) {
    console.log(`  编辑完成后，请按以下步骤驱动传播链:`);
    console.log(`    1. 在 ${id}.yaml 中追加 pendingPropagation 条目（使用多行嵌套格式）:`);
    console.log(`       pendingPropagation:`);
    console.log(`         - changeVersion: <当前版本+1>`);
    console.log(`           status: pending`);
    console.log(`           affectedNodes:`);
    console.log(`             - id: <受影响节点ID>`);
    console.log(`               action:`);
    console.log(`                 type: set_status   # 或 append_to_array / set_field / replace_in_array`);
    console.log(`                 value: <目标值>`);
    console.log(`    2. node .asa/index.js impact ${id}   # 查看影响`);
    console.log(`    3. node .asa/index.js propagate ${id}  # 执行级联更新（幂等）`);
  } else {
    console.log(`  ${type} 修改不触发传播链（REQ 是传播链唯一入口）。编辑 ${id}.yaml 后运行:`);
    console.log(`    node .asa/index.js compile  # 重新编译 docs`);
  }
}

module.exports = { run };

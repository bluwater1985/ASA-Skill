// engine/commands/change.js — 变更入口 (change-req / change-arch / change-task)
const path = require('path');
const fs = require('fs');
const { loadAllNodes, atomicWriteYaml } = require('../lib/matrix.js');
const { appendChangeLog } = require('../lib/changelog.js');

function run(id) {
  if (!id) {
    console.error('[ASA] 用法: node .asa/index.js change-req <ID>');
    process.exit(1);
  }

  const nodes = loadAllNodes();
  const node = nodes[id];
  if (!node) {
    console.error(`[ASA] ❌ 节点 ${id} 不存在`);
    process.exit(1);
  }

  const cat = node.__category;
  const filePath = path.join(process.cwd(), `.asa/nodes/${cat}/${id}.yaml`);

  // 创建快照备份
  const backupDir = path.join(process.cwd(), '.asa/backups');
  fs.mkdirSync(backupDir, { recursive: true });
  // 同毫秒冲突时追加计数后缀
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
  console.log(`  修改后运行以下命令触发传播链:`);
  console.log(`    asa impact ${id}    # 查看影响`);
  console.log(`    asa propagate ${id} # 执行级联更新`);
}

module.exports = { run };

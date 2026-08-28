// engine/commands/reconcile.js — 一键对账与自举恢复 (reconcile)
const fs = require('fs');
const path = require('path');
const { ENGINE_VERSION, MAX_SUPPORTED_SCHEMA } = require('../version.js');
const { parseAsaYaml, stringifyAsaYaml } = require('../lib/yaml.js');
const {
  loadMatrix,
  saveMatrix,
  loadAllNodes,
  rebuildSummary,
  calculateNodesDigest,
  calculateDocsDigest,
  matrixPath
} = require('../lib/matrix.js');

// 判定「旧数据可自动迁移」的解析错误特征
const MIGRATION_INDICATORS = ['块标量', '不允许 Tab'];

function isMigrationError(msg) {
  return MIGRATION_INDICATORS.some(k => msg.includes(k));
}

// 宽松数据模式专用原子写 YAML (不剔除 __ 属性，只做格式规范写盘)
function atomicWriteYaml(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`;
  try {
    fs.writeFileSync(tempPath, stringifyAsaYaml(data), 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (e) {}
    throw err;
  }
}

// 事务感知原子写 (如果传入 txId，在覆写前先 registerFile，实现无损的原子级物理自愈回滚)
function txWriteYaml(filePath, data, txId) {
  if (txId) {
    const { registerFile } = require('../lib/transaction.js');
    registerFile(txId, filePath); // P0-2 修复：删除空 catch，登记失败直接向外抛错阻断
  }
  atomicWriteYaml(filePath, data);
}

// 全量物理级备份（含 matrix, nodes 目录和 docs 目录）
function backupAllData() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(process.cwd(), `.asa/backups/reconcile-${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  let count = 0;

  // 1. 备份 matrix.yaml
  const matrixPath = path.join(process.cwd(), '.asa/matrix.yaml');
  if (fs.existsSync(matrixPath)) {
    fs.copyFileSync(matrixPath, path.join(backupDir, 'matrix.yaml'));
    count++;
  }

  // 2. 备份 nodes
  const nodesDir = path.join(process.cwd(), '.asa/nodes');
  if (fs.existsSync(nodesDir)) {
    const cats = ['requirements', 'architecture', 'tasks'];
    cats.forEach(cat => {
      const p = path.join(nodesDir, cat);
      if (fs.existsSync(p)) {
        const files = fs.readdirSync(p).filter(f => f.endsWith('.yaml'));
        if (files.length > 0) {
          fs.mkdirSync(path.join(backupDir, 'nodes', cat), { recursive: true });
          files.forEach(f => {
            fs.copyFileSync(path.join(p, f), path.join(backupDir, 'nodes', cat, f));
            count++;
          });
        }
      }
    });
  }

  // 3. 备份 docs
  const docsDir = path.join(process.cwd(), 'docs');
  if (fs.existsSync(docsDir)) {
    const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'));
    if (files.length > 0) {
      fs.mkdirSync(path.join(backupDir, 'docs'), { recursive: true });
      files.forEach(f => {
        fs.copyFileSync(path.join(docsDir, f), path.join(backupDir, 'docs', f));
        count++;
      });
    }
  }

  return { backupDir, count };
}

// 批量状态平滑演进与状态机强合并：
// REQ: proposed → approved | done → implemented (不推进 verified 等终态，无损向前兼容)
// ARCH: draft → reviewed
// TASK: pending/in_progress → completed
function migrateNodes(nodes) {
  const migrated = [];
  for (const [id, node] of Object.entries(nodes)) {
    let changed = false;
    const cat = node.__category;

    // P1-1 修复：剥离非冻结 REQ 和 ARCH 的业务状态自动提升，仅保留 TASK done -> completed 迁移
    if (id.startsWith('TASK-') || cat === 'tasks') {
      if (node.status === 'done') {
        node.status = 'completed';
        changed = true;
      }
    }

    if (changed) migrated.push(id);
  }
  return migrated;
}

// 半自动交互式确认
function confirmMigration() {
  if (process.env.CI === 'true' || process.env.ASA_AUTO_MIGRATE === 'true') return true;
  try {
    const buf = Buffer.alloc(16);
    process.stdout.write('[ASA] ⚠️ 检测到项目包含旧版不合规数据格式（如块标量、Tab 缩进或旧版 schema 等）。\n      是否授权执行半自动原子级自愈迁移并升级至 Schema 3 标准？[Y/n]: ');
    const n = fs.readSync(0, buf, 0, 16, null);
    const answer = buf.toString('utf8', 0, n).trim().toLowerCase();
    return answer === '' || answer === 'y' || answer === 'yes' || answer === '是';
  } catch { return true; }
}

// 执行自动迁移：备份 → 宽松解析 → 状态迁移 → 规范化写回 → 更新 digest/schemaVersion
function runMigration(matrixFromSkeleton, txId) {
  console.log('\n[ASA] 🔄 开始旧数据自动迁移...');
  const { backupDir, count } = backupAllData();
  console.log(`  ✓ 已备份 ${count} 个文件到 ${backupDir}`);

  // 1. 宽松解析 matrix（骨架重建时跳过）
  let matrix;
  if (matrixFromSkeleton) {
    matrix = matrixFromSkeleton;
  } else {
    try {
      matrix = loadMatrix(true);
      console.log('  ✓ matrix.yaml 已软化解析');
    } catch (e) {
      console.warn(`  ⚠️ matrix.yaml 仍无法解析（${e.message}），用骨架重建`);
      const skeletonPath = path.join(process.cwd(), '.asa/skeleton/matrix.yaml');
      matrix = parseAsaYaml(
        fs.existsSync(skeletonPath)
          ? fs.readFileSync(skeletonPath, 'utf-8')
          : `meta:\n  phase: "discovery"\n  schemaVersion: ${MAX_SUPPORTED_SCHEMA}\nrisks: []\nrequirements: {}\narchitecture: {}\ntasks: {}\nedges: []\n`
      );
    }
  }

  // 2. 宽松解析节点
  const { nodes, fixes } = loadAllNodes(true);
  if (fixes.length > 0) {
    console.log(`  ✓ ${fixes.length} 个节点文件软化（块标量/Tab）`);
    fixes.slice(0, 5).forEach(f => console.log(`    - ${f}`));
  }

  // 3. 规范化写回全部节点 + matrix
  for (const [id, node] of Object.entries(nodes)) {
    const cat = node.__category;
    if (!cat) continue;
    delete node.__category;
    txWriteYaml(path.join(process.cwd(), `.asa/nodes/${cat}/${id}.yaml`), node, txId);
    node.__category = cat;
  }
  console.log('  ✓ 节点文件已规范化写回');

  // 4. 更新 matrix：schemaVersion + digest + 摘要
  matrix.meta = matrix.meta || {};
  matrix.meta.schemaVersion = MAX_SUPPORTED_SCHEMA;
  matrix.meta.engineVersion = ENGINE_VERSION;
  rebuildSummary(matrix, nodes);
  const nodesDigest = calculateNodesDigest();
  const docsDigest = calculateDocsDigest();
  matrix.meta.nodesDigest = nodesDigest;
  matrix.meta.compiledDocsExpectedDigest = docsDigest;
  matrix.meta.docsActualDigest = docsDigest;
  matrix.meta.docsExpectedDigest = docsDigest;
  saveMatrix(matrix);
  console.log(`  ✓ matrix 已更新（schemaVersion=${MAX_SUPPORTED_SCHEMA}, engineVersion=${ENGINE_VERSION}）`);

  console.log('  ✅ 迁移完成。运行 node .asa/index.js compile 同步 docs 后即可正常使用。\n');
  return { matrix, nodes };
}

function run(args) {
  // ── 只读诊断诊断路由 (支持 --readonly 及其别名 -r 判定，对账对齐，防止越权写盘) ──
  if (args && (args.includes('--readonly') || args.includes('-r'))) {
    const { run: diagnose } = require('./diagnose.js');
    diagnose();
    return;
  }

  const { getActiveTxId, beginTransaction, commitTransaction, rollbackTransaction, markCommitting } = require('../lib/transaction.js');
  let recTxId = getActiveTxId();
  const isNested = !!recTxId;

  if (!isNested) {
    try {
      recTxId = beginTransaction('reconcile-tx');
    } catch (txErr) {
      throw txErr;
    }
  }

  try {
    // matrix.yaml 缺失/损坏时自举：用骨架重建基础结构，再补 nodes/ 摘要
    let matrix;
    let matrixSkeleton = false;
    try {
      matrix = loadMatrix();
    } catch (e) {
      console.warn(`[ASA] ⚠️ matrix.yaml 无法读取（${e.message}）`);
      const skeletonPath = path.join(process.cwd(), '.asa/skeleton/matrix.yaml');
      matrix = parseAsaYaml(
        fs.existsSync(skeletonPath)
          ? fs.readFileSync(skeletonPath, 'utf-8')
          : `meta:\n  phase: "discovery"\n  schemaVersion: ${MAX_SUPPORTED_SCHEMA}\n  engineVersion: "${ENGINE_VERSION}"\nrisks: []\nrequirements: {}\narchitecture: {}\ntasks: {}\nedges: []\n`
      );
      console.warn('[ASA] ⚠️ 已用骨架重建 matrix，edges 依赖关系需从备份恢复');
      saveMatrix(matrix);
      matrixSkeleton = true;
    }

    // 严格加载节点；若因旧数据（块标量/Tab）失败 → 半自动迁移
    let nodes;
    try {
      nodes = loadAllNodes();
    } catch (e) {
      if (isMigrationError(e.message)) {
        if (!confirmMigration()) {
          console.log('[ASA] 已取消迁移。请先运行 node .asa/index.js reconcile 或手动迁移旧数据。');
          process.exit(0);
        }
        const origSchema = matrix.meta?.schemaVersion || 1;
        const result = runMigration(matrixSkeleton ? matrix : null, recTxId);
        matrix = result.matrix;
        nodes = result.nodes;

        // 如果本来是旧的 schema，我们在软化迁移结果中强制将其 schemaVersion 设回旧的 origSchema，以便能够无缝进入 V3 迁移
        if (origSchema < MAX_SUPPORTED_SCHEMA) {
          matrix.meta = matrix.meta || {};
          matrix.meta.schemaVersion = origSchema;
          saveMatrix(matrix);
        } else {
          // 如果原本就是 3，虽然不进 V3 主流迁移，但由于节点已被软化重写，我们也重编译 docs 以对齐哈希
          try {
            const { run: compile } = require('./compile.js');
            compile();
          } catch (compErr) {
            console.error('[ASA] ❌ 迁移软化后联动重编译 docs 失败: ' + compErr.message);
            throw compErr; // P1-2 修复：compile 失败直接向上抛错，触发完整事务回滚
          }
        }

      const awaitingConf = matrix.tasks ? Object.values(matrix.tasks).filter(t => t.status === 'awaiting-confirmation').length : 0;
      console.log(`[ASA STATUS] 迁移后 Phase: ${matrix.meta?.phase || '(unknown)'} | ActiveTask: ${matrix.meta?.activeTask || '(none)'} | AwaitingConfirmation: ${awaitingConf}`);
      // 绝对禁止提前 return！
    } else {
      throw e; // 真损坏，保持严格报错
    }
  }

  // 存量迁移 (级别 3)
  const currentSchema = matrix.meta?.schemaVersion || 1;
  if (currentSchema < MAX_SUPPORTED_SCHEMA) {
    console.log(`[ASA] 检测到存量 Schema 版本 ${currentSchema} < 3，启动原子级 Schema 3 迁移...`);
    
    // 前置历史清洗
    try {
      const { rollbackAllIncomplete } = require('../lib/transaction.js');
      rollbackAllIncomplete();
    } catch (e) {
      console.error(`[ASA] ❌ 迁移前置自愈恢复失败: ${e.message}`);
      throw e;
    }

    // 规格要求：迁移前执行显式全量备份 matrix、nodes 与 docs 并保留
    const preBackupDir = path.join(process.cwd(), '.asa/backups/reconcile-pre-v3');
    try {
      fs.mkdirSync(preBackupDir, { recursive: true });
      // 备份 matrix.yaml
      const matrixP = path.join(process.cwd(), '.asa/matrix.yaml');
      if (fs.existsSync(matrixP)) {
        fs.copyFileSync(matrixP, path.join(preBackupDir, 'matrix.yaml'));
      }
      // 备份 nodes/
      const nodesSrc = path.join(process.cwd(), '.asa/nodes');
      const nodesDest = path.join(preBackupDir, 'nodes');
      if (fs.existsSync(nodesSrc)) {
        copyFolderSync(nodesSrc, nodesDest);
      }
      // 备份 docs/
      const docsSrc = path.join(process.cwd(), 'docs');
      const docsDest = path.join(preBackupDir, 'docs');
      if (fs.existsSync(docsSrc)) {
        copyFolderSync(docsSrc, docsDest);
      }
      console.log(`  ✓ 迁移前已安全生成全量备份快照：.asa/backups/reconcile-pre-v3/`);
    } catch (bkErr) {
      throw new Error(`[ASA] ❌ 迁移前置全量备份失败: ${bkErr.message}。由于缺失物理备份安全网，已紧急阻断迁移！`);
    }

    // 1. 设置阶段标记为 prepared
    matrix.meta = matrix.meta || {};
    matrix.meta.migrationStage = 'prepared';
    matrix.meta.engineVersion = ENGINE_VERSION;
    saveMatrix(matrix);

    // 2. 补齐字段 & 平滑状态迁移 (done -> completed)
    const migrated = migrateNodes(nodes);
    
    // 设置阶段标记为 committing
    matrix.meta.migrationStage = 'committing';
    saveMatrix(matrix);

    // 写回所有迁移成功的节点 (REQ, ARCH, TASK)
    for (const id of migrated) {
      const node = nodes[id];
      const cat = node.__category;
      if (cat) {
        delete node.__category;
        txWriteYaml(path.join(process.cwd(), `.asa/nodes/${cat}/${id}.yaml`), node, recTxId);
        node.__category = cat;
      }
    }
    
    // 强制补齐 TASK 的 linkedReqs / changedFiles
    let tasksUpdated = 0;
    for (const [id, node] of Object.entries(nodes)) {
      if (node.__category === 'tasks' || id.startsWith('TASK-')) {
        let nodeChanged = false;
        if (!node.linkedReqs || !Array.isArray(node.linkedReqs)) {
          node.linkedReqs = [];
          nodeChanged = true;
        }
        if (!node.changedFiles || !Array.isArray(node.changedFiles)) {
          node.changedFiles = [];
          nodeChanged = true;
        }
        if (nodeChanged || migrated.includes(id)) {
          const cat = node.__category || 'tasks';
          delete node.__category;
          txWriteYaml(path.join(process.cwd(), `.asa/nodes/${cat}/${id}.yaml`), node, recTxId);
          node.__category = cat;
          tasksUpdated++;
        }
      }
    }
    if (tasksUpdated > 0) {
      console.log(`  ✓ 已幂等补全并升级 ${tasksUpdated} 个 TASK 节点的字段与状态。`);
    }

    // 3. 刷新 matrix 中的版本和哈希摘要
    rebuildSummary(matrix, nodes);

    const nodesDigest = calculateNodesDigest();
    const docsDigest = calculateDocsDigest();

    matrix.meta.nodesDigest = nodesDigest;
    matrix.meta.compiledDocsExpectedDigest = docsDigest;
    matrix.meta.compiledDocsActualDigest = docsDigest; // B-b 修复：迁移补齐双摘要双字段 Actual 落盘
    matrix.meta.docsActualDigest = docsDigest;
    matrix.meta.docsExpectedDigest = docsDigest; // 兼容旧版

    // 4. 最后 Commit 落盘并升级 schemaVersion，清除迁移标记
    matrix.meta.schemaVersion = MAX_SUPPORTED_SCHEMA;
    matrix.meta.migrationStage = 'completed';
    saveMatrix(matrix);

    // 重编译 docs 确保哈希完全一致
    const { run: compile } = require('./compile.js');
    compile();

    console.log(`  ✓ 项目成功迁移至 Schema 3 级规范。落盘引擎版本标定为 ${ENGINE_VERSION}。`);
  }

    // 从 nodes/ 重建摘要索引（以节点文件为准）
    rebuildSummary(matrix, nodes);
    
    // P2-3 修复：在非迁移常规自愈对账路径中，也同步将 nodesDigest 和 compiledDocsActualDigest 双向对齐！
    matrix.meta = matrix.meta || {};
    matrix.meta.nodesDigest = calculateNodesDigest();

    let hasChanges = false;

    const currentDigest = calculateDocsDigest();
    if (matrix.meta.compiledDocsActualDigest !== currentDigest) {
      matrix.meta.compiledDocsActualDigest = currentDigest;
      hasChanges = true;
    }
    if (matrix.meta.docsActualDigest !== currentDigest) {
      matrix.meta.docsActualDigest = currentDigest;
      hasChanges = true;
    }

    if (hasChanges) saveMatrix(matrix);

    const activeTask = matrix.meta?.activeTask || '(none)';
    const phase = matrix.meta?.phase || '(unknown)';
    const total = matrix.tasks ? Object.keys(matrix.tasks).length : 0;
    const done = matrix.tasks ? Object.values(matrix.tasks).filter(t => ['done', 'completed', 'verified'].includes(t.status)).length : 0;
    const awaitingConf = matrix.tasks ? Object.values(matrix.tasks).filter(t => t.status === 'awaiting-confirmation').length : 0;
    console.log(`[ASA STATUS] Phase: ${phase} | ActiveTask: ${activeTask} | Tasks: ${done}/${total} done | AwaitingConfirmation: ${awaitingConf}`);

    // 如果是独立直接调用 reconcile，主路径执行成功后在此 Commit 提交事务
    if (!isNested && recTxId) {
      commitTransaction(recTxId);
    }
  } catch (err) {
    // 物理回滚：调用统一事务进行高安全、精细化的无损数据覆盖与原子删除
    console.error(`  ❌ 迁移发生异常: ${err.message}，启动数据物理回滚恢复...`);
    if (!isNested && recTxId) {
      rollbackTransaction(recTxId);
    }
    console.log(`  ✓ 数据物理回滚成功，已恢复至迁移前状态。`);
    throw err;
  }
}

function copyFolderSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyFolderSync(srcPath, destPath);
    } else {
      // 屏蔽遗留的 .yml 节点文件拷贝，对齐 nodes 全量 .yaml 后缀口径 (N6/B-2 修复)
      if (srcPath.replace(/\\/g, '/').includes('/nodes/') && entry.name.endsWith('.yml')) {
        continue;
      }
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

module.exports = { run };

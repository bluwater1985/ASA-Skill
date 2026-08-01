// engine/commands/reconcile.js — 状态一致性修复 + 存量迁移 + 旧数据自动迁移
const fs = require('fs');
const path = require('path');
const { loadMatrix, saveMatrix, loadAllNodes, calculateDocsDigest, calculateNodesDigest, atomicWriteYaml, rebuildSummary, matrixPath } = require('../lib/matrix.js');
const { parseAsaYaml, stringifyAsaYaml } = require('../lib/yaml.js');

// 存量状态 → 新状态机映射表
const MIGRATION_MAP = {
  'REQ':  { pending: 'proposed' },
  'ARCH': { pending: 'draft' },
  'TASK': { pending: 'pending', done: 'completed', in_progress: 'in_progress' },
};

// 判定「旧数据可自动迁移」的解析错误特征
const MIGRATION_INDICATORS = ['块标量', '不允许 Tab'];

function isMigrationError(msg) {
  return MIGRATION_INDICATORS.some(k => msg.includes(k));
}

function getNodeType(id) {
  if (!id || typeof id !== 'string') return null;
  return id.split('-')[0];
}

function migrateNodes(nodes) {
  const migrated = [];
  for (const [id, node] of Object.entries(nodes)) {
    const type = getNodeType(id);
    if (!type) continue;
    const typeMap = MIGRATION_MAP[type];
    if (!typeMap) continue;

    const oldStatus = node.status;
    const newStatus = typeMap[oldStatus];
    if (newStatus && newStatus !== oldStatus) {
      node.status = newStatus;
      node.version = node.version || 1;
      if (!node.changeLog) node.changeLog = [];
      if (!node.pendingPropagation) node.pendingPropagation = [];
      console.log(`[ASA] 迁移: ${id} status: ${oldStatus} → ${newStatus}`);
      migrated.push(id);
    }
  }
  return migrated;
}

// ── 旧数据自动迁移 ──

function allDataFiles() {
  const files = [];
  const mp = matrixPath();
  if (fs.existsSync(mp)) files.push(mp);
  for (const cat of ['requirements', 'architecture', 'tasks']) {
    const dir = path.join(process.cwd(), `.asa/nodes/${cat}`);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).sort()) {
      files.push(path.join(dir, f));
    }
  }
  return files;
}

function backupAllData() {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-').replace('Z', '');
  const backupDir = path.join(process.cwd(), `.asa/backups/migration-${ts}`);
  fs.mkdirSync(backupDir, { recursive: true });
  let count = 0;
  for (const f of allDataFiles()) {
    const rel = path.basename(path.dirname(f)) === '.asa' ? 'matrix.yaml' : path.relative(path.join(process.cwd(), '.asa'), f);
    const dest = path.join(backupDir, rel.replace(/[/\\]/g, '_'));
    fs.copyFileSync(f, dest);
    count++;
  }
  return { backupDir, count };
}

// 半自动确认：TTY 询问；非 TTY（CI/管道）自动继续（有备份兜底）
function confirmMigration() {
  if (!process.stdin.isTTY) return true;
  try {
    process.stdout.write('\n[ASA] 检测到旧版数据（块标量/Tab），需要自动迁移以兼容新引擎。\n');
    process.stdout.write('  迁移前会自动备份到 .asa/backups/migration-*/，确认继续？[Y/n] ');
    const buf = Buffer.alloc(16);
    const n = fs.readSync(0, buf, 0, 16, null);
    const answer = buf.toString('utf8', 0, n).trim().toLowerCase();
    return answer === '' || answer === 'y' || answer === 'yes' || answer === '是';
  } catch { return true; }
}

// 执行自动迁移：备份 → 宽松解析 → 状态迁移 → 规范化写回 → 更新 digest/schemaVersion
function runMigration(matrixFromSkeleton) {
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
          : `meta:\n  phase: "discovery"\n  schemaVersion: 2\nrisks: []\nrequirements: {}\narchitecture: {}\ntasks: {}\nedges: []\n`
      );
    }
  }

  // 2. 宽松解析节点 + 状态迁移
  const { nodes, fixes } = loadAllNodes(true);
  if (fixes.length > 0) {
    console.log(`  ✓ ${fixes.length} 个节点文件软化（块标量/Tab）`);
    fixes.slice(0, 5).forEach(f => console.log(`    - ${f}`));
  }
  const migrated = migrateNodes(nodes);
  if (migrated.length > 0) console.log(`  ✓ ${migrated.length} 个节点状态已迁移`);

  // 3. 规范化写回全部节点 + matrix
  for (const [id, node] of Object.entries(nodes)) {
    const cat = node.__category;
    if (!cat) continue;
    delete node.__category;
    atomicWriteYaml(path.join(process.cwd(), `.asa/nodes/${cat}/${id}.yaml`), node);
    node.__category = cat;
  }
  console.log('  ✓ 节点文件已规范化写回');

  // 4. 更新 matrix：schemaVersion + digest + 摘要
  matrix.meta = matrix.meta || {};
  matrix.meta.schemaVersion = 2;
  rebuildSummary(matrix, nodes);
  matrix.meta.docsActualDigest = calculateDocsDigest();
  matrix.meta.nodesDigest = calculateNodesDigest();
  saveMatrix(matrix);
  console.log('  ✓ matrix 已更新（schemaVersion=2, nodesDigest）');

  console.log('  ✅ 迁移完成。运行 node .asa/index.js compile 同步 docs 后即可正常使用。\n');
  return { matrix, nodes };
}

function run() {
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
        : `meta:\n  phase: "discovery"\n  schemaVersion: 2\nrisks: []\nrequirements: {}\narchitecture: {}\ntasks: {}\nedges: []\n`
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
      const result = runMigration(matrixSkeleton ? matrix : null);
      matrix = result.matrix;
      nodes = result.nodes;
      console.log(`[ASA STATUS] 迁移后 Phase: ${matrix.meta?.phase || '(unknown)'} | ActiveTask: ${matrix.meta?.activeTask || '(none)'}`);
      return;
    }
    throw e; // 真损坏，保持严格报错
  }

  // 存量迁移（schemaVersion < 2 才执行，避免 schemaVersion=1 的项目永远无法迁移）
  if (!matrix.meta || (matrix.meta.schemaVersion || 0) < 2) {
    matrix.meta = matrix.meta || {};
    const migrated = migrateNodes(nodes);
    if (migrated.length > 0) {
      for (const id of migrated) {
        const node = nodes[id];
        const cat = node.__category;
        if (!cat) continue;
        delete node.__category;
        atomicWriteYaml(
          path.join(process.cwd(), `.asa/nodes/${cat}/${id}.yaml`),
          node
        );
        node.__category = cat;
      }
      matrix.meta.schemaVersion = 2;
    } else {
      matrix.meta.schemaVersion = 1;
    }
    saveMatrix(matrix);
    console.log(`[ASA] schemaVersion: ${matrix.meta.schemaVersion}`);
  }

  // 从 nodes/ 重建摘要索引（以节点文件为准）
  rebuildSummary(matrix, nodes);
  saveMatrix(matrix);

  let hasChanges = false;

  const currentDigest = calculateDocsDigest();
  if (matrix.meta?.docsActualDigest !== currentDigest) {
    matrix.meta.docsActualDigest = currentDigest;
    hasChanges = true;
  }

  if (hasChanges) saveMatrix(matrix);

  const activeTask = matrix.meta?.activeTask || '(none)';
  const phase = matrix.meta?.phase || '(unknown)';
  const total = matrix.tasks ? Object.keys(matrix.tasks).length : 0;
  const done = matrix.tasks ? Object.values(matrix.tasks).filter(t => ['done', 'completed', 'verified'].includes(t.status)).length : 0;
  console.log(`[ASA STATUS] Phase: ${phase} | ActiveTask: ${activeTask} | Tasks: ${done}/${total} done`);
}

module.exports = { run };

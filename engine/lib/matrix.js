// engine/lib/matrix.js — ASA 矩阵/节点文件读写工具（零外部依赖）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseAsaYaml, stringifyAsaYaml } = require('./yaml.js');

const MATRIX_PATH = path.join(process.cwd(), '.asa/matrix.yaml');
const DOCS_DIR = path.join(process.cwd(), 'docs');

function loadMatrix() {
  if (!fs.existsSync(MATRIX_PATH)) {
    console.error('[ASA] 错误: 找不到 .asa/matrix.yaml 文件');
    process.exit(1);
  }
  try {
    return parseAsaYaml(fs.readFileSync(MATRIX_PATH, 'utf-8'));
  } catch (e) {
    console.error(`[ASA] ❌ .asa/matrix.yaml 解析失败: ${e.message}`);
    console.error('  请修复该文件，或将其重命名后运行 reconcile 从 nodes/ 重建');
    process.exit(1);
  }
}

function saveMatrix(matrix) {
  // atomic write: 先写 .tmp，再 rename
  const tmpPath = MATRIX_PATH + '.tmp';
  fs.writeFileSync(tmpPath, stringifyAsaYaml(matrix), 'utf-8');
  fs.renameSync(tmpPath, MATRIX_PATH);
}

function calculateDocsDigest() {
  if (!fs.existsSync(DOCS_DIR)) return 'sha256:empty';
  const files = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.md')).sort();
  // 空目录与骨架哨兵 "sha256:empty" 一致
  if (files.length === 0) return 'sha256:empty';
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const content = fs.readFileSync(path.join(DOCS_DIR, file), 'utf-8').replace(/\r\n/g, '\n');
    // 文件名也参与哈希，重命名文件会被篡改检测捕获
    hash.update(file + '\0' + content);
  }
  return `sha256:${hash.digest('hex')}`;
}

function loadAllNodes() {
  const nodes = {};
  const categories = ['requirements', 'architecture', 'tasks'];
  const errors = [];
  for (const cat of categories) {
    const dir = path.join(process.cwd(), `.asa/nodes/${cat}`);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.yaml'))) {
      const id = path.basename(file, '.yaml');
      try {
        nodes[id] = parseAsaYaml(fs.readFileSync(path.join(dir, file), 'utf-8'));
        nodes[id].__category = cat;
      } catch (e) {
        errors.push(`${cat}/${file}: ${e.message}`);
      }
    }
  }
  if (errors.length > 0) {
    console.error(`[ASA] ❌ ${errors.length} 个节点文件解析失败：`);
    errors.slice(0, 5).forEach(err => console.error(`  - ${err}`));
    console.error('  请用 validate-yaml hook 定位问题，或修复这些文件后重试。');
    process.exit(1);
  }
  return nodes;
}

function atomicWriteYaml(filePath, data) {
  // 仅剔除内部已知字段（__category），避免误删用户合法 __ 前缀字段
  const clean = { ...data };
  delete clean.__category;
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, stringifyAsaYaml(clean), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

// 从 nodes/ 重建 matrix 的 requirements/architecture/tasks 摘要索引
function rebuildSummary(matrix, nodes) {
  const catMap = { requirements: 'requirements', architecture: 'architecture', tasks: 'tasks' };
  matrix.requirements = matrix.requirements || {};
  matrix.architecture = matrix.architecture || {};
  matrix.tasks = matrix.tasks || {};

  // 清空后重建（以 nodes/ 为准）
  matrix.requirements = {};
  matrix.architecture = {};
  matrix.tasks = {};

  for (const [id, node] of Object.entries(nodes)) {
    const cat = node.__category;
    if (!catMap[cat]) continue;
    const summary = {
      title: node.title || '',
      status: node.status || 'pending',
    };
    if (cat === 'tasks') summary.file = `.asa/nodes/tasks/${id}.yaml`;
    matrix[catMap[cat]][id] = summary;
  }
}

module.exports = {
  MATRIX_PATH, DOCS_DIR,
  loadMatrix, saveMatrix, calculateDocsDigest, loadAllNodes, atomicWriteYaml, rebuildSummary,
};

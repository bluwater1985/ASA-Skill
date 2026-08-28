// engine/lib/matrix.js — ASA 矩阵/节点文件读写工具（零外部依赖）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseAsaYaml, stringifyAsaYaml } = require('./yaml.js');

// 路径在调用时计算（而非模块加载时），支持 cwd 变化的场景（如测试多沙箱）
function matrixPath() { return path.join(process.cwd(), '.asa/matrix.yaml'); }
function docsDir() { return path.join(process.cwd(), 'docs'); }

function loadMatrix(lenient) {
  const mp = matrixPath();
  if (!fs.existsSync(mp)) {
    throw new Error('找不到 .asa/matrix.yaml 文件');
  }
  try {
    const raw = fs.readFileSync(mp, 'utf-8');
    if (lenient) {
      const { text, fixes } = require('./yaml.js').softenYaml(raw);
      if (fixes.length > 0) console.warn(`[ASA] 迁移: matrix.yaml 软化 ${fixes.length} 处旧写法`);
      return parseAsaYaml(text);
    }
    return parseAsaYaml(raw);
  } catch (e) {
    throw new Error(`.asa/matrix.yaml 解析失败: ${e.message}。请修复该文件，或运行 reconcile（会从骨架重建，edges 需备份恢复）`);
  }
}

function saveMatrix(matrix) {
  const mp = matrixPath();
  const newYaml = stringifyAsaYaml(matrix);

  // 全局高保真幂等性检查：如果生成的新 YAML 与磁盘存量内容 100% 一致，无损静默返回，不更新 mtime (B1)
  if (fs.existsSync(mp)) {
    try {
      const oldYaml = fs.readFileSync(mp, 'utf-8');
      if (oldYaml.replace(/\r\n/g, '\n') === newYaml.replace(/\r\n/g, '\n')) {
        return;
      }
    } catch (e) {}
  }

  const { getActiveTxId, registerFile } = require('./transaction.js');
  const txId = getActiveTxId();
  if (txId) {
    registerFile(txId, mp);
  }

  // atomic write: 先写 .tmp，再 rename
  const tmpPath = mp + '.tmp';
  fs.writeFileSync(tmpPath, newYaml, 'utf-8');
  fs.renameSync(tmpPath, mp);
}

function calculateDocsDigest(projectRoot) {
  const dd = projectRoot ? path.join(projectRoot, 'docs') : docsDir();
  if (!fs.existsSync(dd)) return 'sha256:empty';
  const files = fs.readdirSync(dd).filter(f => f === '01-requirements.md' || f === '03-tasks.md' || f === '04-issues.md').sort();
  // 空目录与骨架哨兵 "sha256:empty" 一致
  if (files.length === 0) return 'sha256:empty';
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const content = fs.readFileSync(path.join(dd, file), 'utf-8').replace(/\r\n/g, '\n');
    // 文件名也参与哈希，重命名文件会被篡改检测捕获
    hash.update(file + '\0' + content);
  }
  return `sha256:${hash.digest('hex')}`;
}

function calculateNodesDigest(projectRoot) {
  const nodesDir = projectRoot ? path.join(projectRoot, '.asa/nodes') : path.join(process.cwd(), '.asa/nodes');
  if (!fs.existsSync(nodesDir)) return 'sha256:empty';
  const files = [];
  for (const cat of ['requirements', 'architecture', 'tasks', 'issues']) {
    const dir = path.join(nodesDir, cat);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).sort()) {
      files.push(`${cat}/${f}`);
    }
  }
  if (files.length === 0) return 'sha256:empty';
  const hash = crypto.createHash('sha256');
  for (const rel of files.sort()) {
    // CRLF→LF 归一化，抹平 Windows/Mac/Linux 换行差异（与 calculateDocsDigest 一致）
    const content = fs.readFileSync(path.join(nodesDir, rel), 'utf-8').replace(/\r\n/g, '\n');
    hash.update(rel + '\0' + content);
  }
  return `sha256:${hash.digest('hex')}`;
}

// 加载全部节点。lenient=true 时先用 softenYaml 软化旧写法（块标量/Tab），
// 返回 { nodes, fixes }，fixes 记录每个文件的软化情况（用于迁移报告）。
function loadAllNodes(lenient) {
  const nodes = {};
  const categories = ['requirements', 'architecture', 'tasks', 'issues'];
  const errors = [];
  const fixes = [];
  for (const cat of categories) {
    const dir = path.join(process.cwd(), `.asa/nodes/${cat}`);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).sort()) {
      const id = path.basename(file, '.yaml');
      const filePath = path.join(dir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        if (lenient) {
          const { text, fixes: fxs } = require('./yaml.js').softenYaml(raw);
          if (fxs.length > 0) fixes.push(`${cat}/${file}: ${fxs.join('; ')}`);
          nodes[id] = parseAsaYaml(text);
        } else {
          nodes[id] = parseAsaYaml(raw);
        }
        nodes[id].__category = cat;
        if (nodes[id].id && nodes[id].id !== id) {
          console.warn(`[ASA] ⚠️ ${cat}/${file}: 文件内 id="${nodes[id].id}" 与文件名不符，以文件名为准`);
        }
      } catch (e) {
        errors.push(`${cat}/${file}: ${e.message}`);
      }
    }
  }
  if (errors.length > 0) {
    const detail = errors.slice(0, 5).map(e => `  - ${e}`).join('\n');
    throw new Error(`${errors.length} 个节点文件解析失败：\n${detail}\n  请用 validate-yaml hook 定位问题，或修复这些文件后重试`);
  }
  if (lenient) return { nodes, fixes };
  return nodes;
}

function atomicWriteYaml(filePath, data) {
  const { getActiveTxId, registerFile } = require('./transaction.js');
  const txId = getActiveTxId();
  if (txId) {
    registerFile(txId, filePath);
  }

  // 仅剔除内部已知字段（__category），避免误删用户合法 __ 前缀字段
  const clean = { ...data };
  delete clean.__category;
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, stringifyAsaYaml(clean), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

// 从 nodes/ 重建 matrix 的 requirements/architecture/tasks/issues 摘要索引
function rebuildSummary(matrix, nodes) {
  const catMap = { requirements: 'requirements', architecture: 'architecture', tasks: 'tasks', issues: 'issues' };
  matrix.requirements = matrix.requirements || {};
  matrix.architecture = matrix.architecture || {};
  matrix.tasks = matrix.tasks || {};
  matrix.issues = matrix.issues || {};

  // 清空后重建（以 nodes/ 为准）
  matrix.requirements = {};
  matrix.architecture = {};
  matrix.tasks = {};
  matrix.issues = {};

  for (const [id, node] of Object.entries(nodes)) {
    const cat = node.__category;
    if (!catMap[cat]) continue;
    const summary = {
      title: node.title || '',
      status: node.status || 'pending',
    };
    if (cat === 'tasks') summary.file = `.asa/nodes/tasks/${id}.yaml`;
    if (cat === 'issues') summary.file = `.asa/nodes/issues/${id}.yaml`;
    matrix[catMap[cat]][id] = summary;
  }
}

module.exports = {
  matrixPath, docsDir,
  loadMatrix, saveMatrix, calculateDocsDigest, calculateNodesDigest, loadAllNodes, atomicWriteYaml, rebuildSummary,
};

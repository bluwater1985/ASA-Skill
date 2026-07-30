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
  return parseAsaYaml(fs.readFileSync(MATRIX_PATH, 'utf-8'));
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
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const content = fs.readFileSync(path.join(DOCS_DIR, file), 'utf-8').replace(/\r\n/g, '\n');
    hash.update(content);
  }
  return `sha256:${hash.digest('hex')}`;
}

function loadAllNodes() {
  const nodes = {};
  const categories = ['requirements', 'architecture', 'tasks'];
  for (const cat of categories) {
    const dir = path.join(process.cwd(), `.asa/nodes/${cat}`);
    if (!fs.existsSync(dir)) continue;
    fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).forEach(file => {
      const id = path.basename(file, '.yaml');
      nodes[id] = parseAsaYaml(fs.readFileSync(path.join(dir, file), 'utf-8'));
      nodes[id].__category = cat;
    });
  }
  return nodes;
}

function atomicWriteYaml(filePath, data) {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, stringifyAsaYaml(data), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

module.exports = {
  MATRIX_PATH, DOCS_DIR,
  loadMatrix, saveMatrix, calculateDocsDigest, loadAllNodes, atomicWriteYaml,
};

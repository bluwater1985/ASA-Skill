// engine/commands/helpers.js — 命令测试沙箱辅助（非生产代码）
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { parseAsaYaml, stringifyAsaYaml } = require('../lib/yaml.js');

/**
 * 创建临时沙箱项目，返回其绝对路径。
 */
function createSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asa-cmd-'));
  fs.mkdirSync(path.join(dir, '.asa/nodes/requirements'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.asa/nodes/architecture'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.asa/nodes/tasks'), { recursive: true });
  const skeleton = `meta:
  project: "test"
  phase: "discovery"
  schemaVersion: 2
  docsExpectedDigest: "sha256:empty"
  docsActualDigest: "sha256:empty"
risks: []
requirements: {}
architecture: {}
tasks: {}
edges: []
`;
  fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), skeleton);
  return dir;
}

/**
 * 在沙箱中以子进程方式执行 CLI 命令，返回真实 stdout/stderr 与退出码。
 * command 取 index.js 的子命令名（add-req / status / edge ...）。
 */
function run(dir, command, args) {
  const engineIndex = path.join(__dirname, '..', 'index.js');
  const argv = [engineIndex, command, ...(args || [])];
  let stdout = '';
  let stderr = '';
  let status = 0;
  try {
    stdout = execFileSync(process.execPath, argv, { cwd: dir, encoding: 'utf8' });
  } catch (e) {
    status = e.status || -1;
    stdout = e.stdout || '';
    stderr = e.stderr || '';
  }
  return { output: stdout + (stderr ? '\n[STDERR] ' + stderr : ''), exitCode: status };
}

/** 读取沙箱中的节点 */
function readNode(dir, cat, id) {
  const p = path.join(dir, `.asa/nodes/${cat}/${id}.yaml`);
  if (!fs.existsSync(p)) return null;
  return parseAsaYaml(fs.readFileSync(p, 'utf-8'));
}

/** 读取 matrix */
function readMatrix(dir) {
  return parseAsaYaml(fs.readFileSync(path.join(dir, '.asa/matrix.yaml'), 'utf-8'));
}

/** 写入节点 */
function writeNode(dir, cat, id, node) {
  fs.writeFileSync(path.join(dir, `.asa/nodes/${cat}/${id}.yaml`), stringifyAsaYaml(node));
}

module.exports = { createSandbox, run, readNode, readMatrix, writeNode };

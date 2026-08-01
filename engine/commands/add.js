// engine/commands/add.js — 新增节点 (add-req / add-arch / add-task)
const path = require('path');
const fs = require('fs');
const { loadMatrix, saveMatrix, atomicWriteYaml } = require('../lib/matrix.js');

const TEMPLATES = {
  REQ: {
    dir: 'requirements',
    template: {
      title: '新需求',
      status: 'proposed',
      version: 1,
      priority: 'P2',
      acceptanceCriteria: [],
      changeLog: [],
      pendingPropagation: [],
    },
  },
  ARCH: {
    dir: 'architecture',
    template: {
      title: '新架构组件',
      status: 'draft',
      version: 1,
      changeLog: [],
      pendingPropagation: [],
    },
  },
  TASK: {
    dir: 'tasks',
    template: {
      title: '新任务',
      status: 'pending',
      version: 1,
      inputs: [],
      outputs: [],
      changeLog: [],
      pendingPropagation: [],
    },
  },
};

function getNextId(nodesDir) {
  let max = 0;
  if (fs.existsSync(nodesDir)) {
    for (const f of fs.readdirSync(nodesDir)) {
      const match = f.match(/^(REQ|ARCH|TASK)-(\d+)\.yaml$/);
      if (match) {
        const num = parseInt(match[2], 10);
        if (num > max) max = num;
      }
    }
  }
  return max + 1;
}

function runNode(prefix, args) {
  const prefixMap = { 'req': 'REQ', 'arch': 'ARCH', 'task': 'TASK' };
  const p = prefixMap[prefix];
  if (!p) {
    console.error(`[ASA] ❌ 未知类型: ${prefix}，请使用 req/arch/task`);
    process.exit(1);
  }

  // 解析 --priority flag（仅 REQ 有效）
  let priority = null;
  const argList = Array.isArray(args) ? args : [args];
  const titleParts = [];
  for (let i = 0; i < argList.length; i++) {
    if (argList[i] === '--priority' && i + 1 < argList.length) {
      priority = argList[++i];
    } else {
      titleParts.push(argList[i]);
    }
  }
  const title = titleParts.join(' ');

  const cfg = TEMPLATES[p];
  const dir = path.join(process.cwd(), `.asa/nodes/${cfg.dir}`);
  fs.mkdirSync(dir, { recursive: true });

  const nextNum = getNextId(dir);
  const id = `${p}-${String(nextNum).padStart(3, '0')}`;
  const node = { id, ...JSON.parse(JSON.stringify(cfg.template)) };
  if (title) node.title = title;
  if (priority && p === 'REQ') node.priority = priority;

  atomicWriteYaml(path.join(dir, `${id}.yaml`), node);

  // 登记到 matrix 摘要索引
  const matrix = loadMatrix();
  const key = p === 'REQ' ? 'requirements' : p === 'ARCH' ? 'architecture' : 'tasks';
  matrix[key] = matrix[key] || {};
  matrix[key][id] = { title: node.title, status: node.status };
  if (key === 'tasks') matrix[key][id].file = `.asa/nodes/tasks/${id}.yaml`;
  saveMatrix(matrix);

  console.log(`[ASA] ✅ ${id} 已创建: ${node.title}`);

  // 自动重编译 docs + 刷新 nodesDigest，避免 docs/nodes 漂移
  try {
    const { run: compile } = require('./compile.js');
    compile();
  } catch (e) { console.warn(`[ASA] ⚠️ compile 失败，docs/digest 可能过期: ${e.message}`); }
}

module.exports = { run: runNode };

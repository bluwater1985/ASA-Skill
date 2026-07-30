// engine/commands/add.js — 新增节点 (add-req / add-arch / add-task)
const path = require('path');
const fs = require('fs');
const { atomicWriteYaml } = require('../lib/matrix.js');

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

function runNode(prefix, title) {
  const prefixMap = { 'req': 'REQ', 'arch': 'ARCH', 'task': 'TASK' };
  const p = prefixMap[prefix];
  if (!p) {
    console.error(`[ASA] ❌ 未知类型: ${prefix}，请使用 req/arch/task`);
    process.exit(1);
  }

  const cfg = TEMPLATES[p];
  const dir = path.join(process.cwd(), `.asa/nodes/${cfg.dir}`);
  fs.mkdirSync(dir, { recursive: true });

  const nextNum = getNextId(dir);
  const id = `${p}-${String(nextNum).padStart(3, '0')}`;
  const node = { id, ...JSON.parse(JSON.stringify(cfg.template)) };
  if (title) node.title = title;

  atomicWriteYaml(path.join(dir, `${id}.yaml`), node);
  console.log(`[ASA] ✅ ${id} 已创建: ${node.title}`);
}

module.exports = { run: runNode };

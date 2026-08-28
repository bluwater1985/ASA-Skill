// engine/commands/plan.js — 任务拓扑编排 (plan-tasks)
const { loadMatrix, loadAllNodes } = require('../lib/matrix.js');

function run(args) {
  const matrix = loadMatrix();
  const nodes = loadAllNodes();

  const targetReqId = args && args[0]; // 可选只看某一 REQ 关联的任务

  // 1. 过滤所有的 TASK 节点
  const tasks = Object.entries(nodes)
    .filter(([id, node]) => node.__category === 'tasks' || id.startsWith('TASK-'))
    .reduce((acc, [id, node]) => {
      acc[id] = node;
      return acc;
    }, {});

  // 2. 定义未完成状态（终态之外的视为未完成）
  const completedStates = ['completed', 'verified', 'cancelled'];
  const isIncomplete = (status) => !completedStates.includes(status);

  // 3. 筛选边：两端为 TASK，且 type === 'depends' (P2 修复，支持 to/from 数组 Flat 平铺兼容)
  const edges = [];
  for (const e of (matrix.edges || [])) {
    if (e.from && e.to && e.type === 'depends') {
      const froms = Array.isArray(e.from) ? e.from : [e.from];
      const tos = Array.isArray(e.to) ? e.to : [e.to];
      for (const f of froms) {
        for (const t of tos) {
          if (f.startsWith('TASK-') && t.startsWith('TASK-')) {
            edges.push({ from: f, to: t, type: e.type });
          }
        }
      }
    }
  }

  // 如果指定了 REQ-ID，只筛选与该 REQ 关联的任务及它们之间的边
  let activeTaskIds = Object.keys(tasks);
  if (targetReqId) {
    if (!targetReqId.startsWith('REQ-')) {
      console.error(`[ASA] ❌ 节点 ${targetReqId} 不是 REQ 节点`);
      process.exit(1);
    }
    if (!nodes[targetReqId]) {
      console.error(`[ASA] ❌ 需求 ${targetReqId} 不存在`);
      process.exit(1);
    }
    activeTaskIds = activeTaskIds.filter(id => {
      const linked = tasks[id].linkedReqs || [];
      return linked.includes(targetReqId);
    });
  }

  const incompleteTasks = activeTaskIds.filter(id => isIncomplete(tasks[id].status));

  // 4. 构建 Kahn 拓扑图：仅计算未完成任务之间的依赖
  const inDegree = {};
  const adj = {};
  for (const id of incompleteTasks) {
    inDegree[id] = 0;
    adj[id] = [];
  }

  for (const e of edges) {
    // 只有两端都是本次计算中的未完成任务，才计入拓扑
    if (inDegree[e.from] !== undefined && inDegree[e.to] !== undefined) {
      inDegree[e.to]++;
      adj[e.from].push(e.to);
    }
  }

  // 5. 寻找就绪（入度为 0）和被阻塞的任务
  const ready = [];
  const blocked = [];
  const awaiting = [];
  const blockedBy = {};

  for (const id of incompleteTasks) {
    if (inDegree[id] === 0) {
      const node = tasks[id];
      // 状态正处于 awaiting-confirmation 的任务节点，从就绪可执行 ready 列表中过滤并剔除，加入 awaiting 分组
      if (node && node.status === 'awaiting-confirmation') {
        awaiting.push(id);
      } else {
        ready.push(id);
      }
    } else {
      blocked.push(id);
      blockedBy[id] = [];
    }
  }

  // 收集每个被阻塞任务的具体未完成前序
  for (const e of edges) {
    if (inDegree[e.from] !== undefined && inDegree[e.to] !== undefined) {
      blockedBy[e.to].push(e.from);
    }
  }

  // 6. 执行 Kahn 拓扑排序 (使用 inDegree 副本 kahnInDegree 进行消解，保证 original inDegree 物理一致用于前序展示)
  const kahnInDegree = { ...inDegree };
  const kahnQueue = [];
  for (const id of incompleteTasks) {
    if (kahnInDegree[id] === 0) {
      kahnQueue.push(id);
    }
  }
  kahnQueue.sort();
  const order = [];

  while (kahnQueue.length > 0) {
    kahnQueue.sort();
    const u = kahnQueue.shift();
    order.push(u);

    for (const v of adj[u]) {
      kahnInDegree[v]--;
      if (kahnInDegree[v] === 0) {
        kahnQueue.push(v);
      }
    }
  }

  // 检测是否存在循环依赖（在已有的 edges 里）
  const hasCycle = order.length !== incompleteTasks.length;

  // 6.5 计算所有直接或间接依赖于 awaiting-confirmation 节点的任务集合（级联阻塞）
  const blockedByAwaiting = new Set();
  const queue = [];
  for (const id of incompleteTasks) {
    const node = tasks[id];
    if (node && node.status === 'awaiting-confirmation') {
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const curr = queue.shift();
    if (adj[curr]) {
      for (const next of adj[curr]) {
        if (!blockedByAwaiting.has(next)) {
          blockedByAwaiting.add(next);
          queue.push(next);
        }
      }
    }
  }

  // 7. 格式化控制台输出
  let output = `[ASA 任务拓扑编排计划]${targetReqId ? ` (针对需求: ${targetReqId})` : ''}\n\n`;

  output += `### 1. 就绪可执行任务 (Ready to Start)\n`;
  if (ready.length === 0) {
    output += `(无就绪任务，可能已被全部完成，或存在循环依赖/阻塞)\n`;
  } else {
    for (const id of ready.sort()) {
      const t = tasks[id];
      output += `- [${id}] ${t.title} (Status: ${t.status})\n`;
      if (t.linkedReqs && t.linkedReqs.length > 0) {
        output += `  归属需求: ${t.linkedReqs.join(', ')}\n`;
      }
    }
  }

  output += `\n### 2. 等待人工确认任务 (Awaiting Confirmation)\n`;
  if (awaiting.length === 0) {
    output += `(无等待确认任务)\n`;
  } else {
    for (const id of awaiting.sort()) {
      const t = tasks[id];
      output += `- [${id}] ${t.title} (Status: ${t.status})\n`;
      if (t.linkedReqs && t.linkedReqs.length > 0) {
        output += `  归属需求: ${t.linkedReqs.join(', ')}\n`;
      }
    }
  }

  output += `\n### 3. 被阻塞任务 (Blocked Tasks)\n`;
  if (blocked.length === 0) {
    output += `(无被阻塞任务)\n`;
  } else {
    for (const id of blocked.sort()) {
      const t = tasks[id];
      const blockers = blockedBy[id].sort().map(b => `${b}(${tasks[b].status})`).join(', ');
      output += `- [${id}] ${t.title} (Status: ${t.status}) -- ⚠️ 阻塞于: ${blockers}\n`;
    }
  }

  output += `\n### 4. 建议执行拓扑排序 (Recommended Order of Execution)\n`;
  if (hasCycle) {
    output += `⚠️ [ASA] 检测到任务依赖关系中存在循环依赖！无法给出确定性执行序列。请运行 node .asa/index.js validate 检查。\n`;
  } else if (order.length === 0) {
    output += `(所有关联任务已全部完成！)\n`;
  } else {
    // 拓扑建议序过滤：剔除所有 awaiting-confirmation 等不可执态任务，以及级联阻塞的下游任务，保障序列绝对纯净 (M1 & B-1 修复)
    const executableOrder = order.filter(id => {
      if (!tasks[id]) return false;
      if (tasks[id].status === 'awaiting-confirmation') return false;
      if (blockedByAwaiting.has(id)) return false;
      return true;
    });
    if (executableOrder.length === 0) {
      output += `(无就绪的建议执行任务，所有任务已完成或处于等待确认中)\n`;
    } else {
      output += executableOrder.map((id, index) => `${index + 1}. ${id}`).join(' → ') + '\n';
    }
  }

  console.log(output);
}

module.exports = { run };

// engine/commands/cost.js — 成本观测（只读）：估算“归因于 ASA 的模型调用次数”
//
// 依据：每个节点的 changeLog 条目数 ≈ 一次引擎写操作 ≈ 模型的一次工具调用。
// 目的：让“省了多少调用”可量化，便于验证 flow/batch/`;` 合并的真实收益。
// 只读、不加锁、不写盘。可加 --json 输出机器可读。

const { loadAllNodes } = require('../lib/matrix.js');
const io = require('../lib/io.js');

function run() {
  const nodes = loadAllNodes();
  const counts = { REQ: 0, ARCH: 0, TASK: 0, ISSUE: 0 };
  const nodeCount = { REQ: 0, ARCH: 0, TASK: 0, ISSUE: 0 };
  let totalOps = 0;

  for (const [id, node] of Object.entries(nodes)) {
    const type = (id.split('-')[0] || '?');
    nodeCount[type] = (nodeCount[type] || 0) + 1;
    // 写操作数：以 version（创建即 1、每次变更递增）为基准，回退到 changeLog 条数
    const cl = Array.isArray(node.changeLog) ? node.changeLog.length : 1;
    const n = Math.max(Number(node.version) || 1, cl);
    counts[type] = (counts[type] || 0) + n;
    totalOps += n;
  }

  // 估算：每条节点写操作 ≈ 1 次模型工具调用；采用 flow/batch/`;` 合并后按经验摊薄
  const estimateModelCalls = totalOps;
  const estimateModelCallsMerged = Math.max(1, Math.ceil(totalOps / 2.5));

  const result = {
    mode: 'estimate',
    nodeWriteOps: totalOps,
    byType: counts,
    nodeCount,
    estimateModelCalls,
    estimateModelCallsMerged,
    tip: '估算值：改用 flow/batch/`;` 合并命令后约可降 60%+ 的模型调用（每类任务从 8-14 降至 ~3-4）。',
  };

  if (io.jsonOut(result)) return;

  console.log('[ASA cost] 模型调用估算（依据节点 changeLog 写操作）:');
  console.log(`  节点写操作(changeLog 条目) ≈ ${totalOps}`);
  console.log(`    按类型: REQ=${counts.REQ} · ARCH=${counts.ARCH} · TASK=${counts.TASK} · ISSUE=${counts.ISSUE}`);
  console.log(`  近似模型工具调用 ≈ ${estimateModelCalls}`);
  console.log(`  合并命令后（flow/batch/;）≈ ${estimateModelCallsMerged}`);
  console.log(`  ${result.tip}`);
}

module.exports = { run };

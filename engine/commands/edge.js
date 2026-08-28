// engine/commands/edge.js — 依赖边管理
const { loadMatrix, saveMatrix, loadAllNodes } = require('../lib/matrix.js');
const { wouldCreateCycle } = require('../lib/graph.js');

const VALID_TYPES = ['depends', 'extends', 'refines'];

function run(args) {
  // args: ['add', 'REQ-001', 'ARCH-001', '--type', 'depends']
  //    or: ['rm', 'REQ-001', 'ARCH-001']
  if (!Array.isArray(args)) args = [];

  const sub = args[0];
  const from = args[1];
  const to = args[2];

  if (!sub || !from || !to) {
    console.error('[ASA] 用法:');
    console.error('  node .asa/index.js edge add <from> <to> --type depends|extends|refines');
    console.error('  node .asa/index.js edge rm <from> <to>');
    process.exit(1);
  }

  // 提取 --type flag
  const typeIdx = args.indexOf('--type');
  const type = typeIdx >= 0 && typeIdx + 1 < args.length ? args[typeIdx + 1] : null;

  // 校验 type 枚举
  if (type && !VALID_TYPES.includes(type)) {
    console.error(`[ASA] ❌ 无效边类型: ${type}，可用: ${VALID_TYPES.join(' | ')}`);
    process.exit(1);
  }

  const matrix = loadMatrix();
  if (!Array.isArray(matrix.edges)) matrix.edges = [];

  // 校验节点存在
  const nodes = loadAllNodes();
  if (!nodes[from]) {
    console.error(`[ASA] ❌ 节点 ${from} 不存在`);
    process.exit(1);
  }
  if (!nodes[to]) {
    console.error(`[ASA] ❌ 节点 ${to} 不存在`);
    process.exit(1);
  }

  if (sub === 'add') {
    const exists = matrix.edges.some(e =>
      e.from === from &&
      (e.to === to || (Array.isArray(e.to) && e.to.includes(to))) &&
      (e.type || 'depends') === (type || 'depends')
    );
    if (exists) {
      console.log(`[ASA] ℹ️ 边 ${from} → ${to}${type ? ` (${type})` : ''} 已存在，跳过`);
      process.exit(0);
    }

    if (wouldCreateCycle(matrix.edges, from, to)) {
      console.error(`[ASA] ❌ 边 ${from} → ${to} 会形成循环依赖，已拒绝`);
      process.exit(1);
    }

    const edge = { from, to };
    if (type) edge.type = type;
    matrix.edges.push(edge);
    saveMatrix(matrix);
    console.log(`[ASA] ✅ 边已添加: ${from} → ${to}${type ? ` (${type})` : ''}`);

    // 联动重编译 docs
    try {
      const { run: compile } = require('./compile.js');
      compile();
    } catch (e) {
      console.error('[ASA] ❌ 联动重编译 docs 失败: ' + e.message);
      throw e; // P1-3 修复：直接向外抛错，触发事务回滚，杜绝半写
    }

  } else if (sub === 'rm') {
    const idx = matrix.edges.findIndex(e =>
      e.from === from && (e.to === to || (Array.isArray(e.to) && e.to.includes(to)))
    );
    if (idx === -1) {
      console.error(`[ASA] ❌ 边 ${from} → ${to} 不存在`);
      process.exit(1);
    }
    matrix.edges.splice(idx, 1);
    saveMatrix(matrix);
    console.log(`[ASA] ✅ 边已删除: ${from} → ${to}`);

    // 联动重编译 docs
    try {
      const { run: compile } = require('./compile.js');
      compile();
    } catch (e) {
      console.error('[ASA] ❌ 联动重编译 docs 失败: ' + e.message);
      throw e; // P1-3 修复：直接向外抛错，触发事务回滚，杜绝半写
    }

  } else {
    console.error(`[ASA] ❌ 未知子命令: ${sub}，请使用 add 或 rm`);
    process.exit(1);
  }
}

module.exports = { run };

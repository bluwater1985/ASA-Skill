// engine/commands/doctor.js — 一键诊断维护 (doctor)
const path = require('path');
const fs = require('fs');
const { loadMatrix, calculateNodesDigest } = require('../lib/matrix.js');
const { ENGINE_VERSION, MIN_SCHEMA_VERSION } = require('../version.js');
const { NARRATIVE_SYNC_TEMPLATE } = require('../lib/narrative-sync.js');

function run() {
  console.log('=== ASA 引擎一键项目诊断报告 (doctor) ===\n');

  let hasIssue = false;

  // 1. 引擎与 Schema 兼容校验
  let matrix;
  try {
    matrix = loadMatrix();
    console.log(`[OK] 成功读取 matrix.yaml`);
  } catch (e) {
    console.log(`[ERROR] ❌ matrix.yaml 解析损坏: ${e.message}`);
    process.exit(1);
  }

  const schemaVersion = matrix.meta?.schemaVersion || 1;
  const projectEngineVersion = matrix.meta?.engineVersion || 'legacy';

  console.log(`- 运行中的全局引擎版本: ${ENGINE_VERSION}`);
  console.log(`- 项目 Schema 级别: schemaVersion ${schemaVersion}`);
  console.log(`- 项目落盘引擎版本: ${projectEngineVersion}`);

  const { MAX_SUPPORTED_SCHEMA } = require('../version.js');

  if (schemaVersion > MAX_SUPPORTED_SCHEMA) {
    console.log(`[ERROR] ❌ 项目 Schema 版本 (${schemaVersion}) 超过了当前引擎最大支持版本 (${MAX_SUPPORTED_SCHEMA})！您必须立刻升级全局 ASA 引擎，否则将无法进行任何写盘修改。`);
    hasIssue = true;
  } else if (schemaVersion < MIN_SCHEMA_VERSION) {
    console.log(`[WARN] ⚠️ 当前项目 Schema (${schemaVersion}) 偏低，建议运行 reconcile 升级至最新规范。`);
    hasIssue = true;
  } else {
    console.log(`[OK] 项目 Schema 兼容匹配。`);
  }

  // 2. 验证 Hook 物理存在性
  const root = process.cwd();
  const hooks = [
    { name: 'check-work-order.js', p: path.join(root, '.asa/hooks/check-work-order.js') },
    { name: 'validate-yaml.js', p: path.join(root, '.asa/hooks/validate-yaml.js') }
  ];

  for (const h of hooks) {
    if (fs.existsSync(h.p)) {
      console.log(`[OK] 物理 Hook 存在: ${h.name}`);
    } else {
      console.log(`[WARN] ⚠️ 物理 Hook 缺失: ${h.name}，可能会导致开发门禁失效！建议运行 /asa init 重刷环境。`);
      hasIssue = true;
    }
  }

  // 3. 比对 00/02 的 ASA-BASED-ON 状态
  const actualNodesDigest = calculateNodesDigest();
  const mdDocs = ['00-overview.md', '02-architecture.md'];

  for (const doc of mdDocs) {
    const docPath = path.join(root, 'docs', doc);
    if (fs.existsSync(docPath)) {
      const text = fs.readFileSync(docPath, 'utf8');
      const match = text.match(/<!-- ASA-BASED-ON: (.*?) -->/);
      if (match) {
        const basedOn = match[1];
        if (basedOn === actualNodesDigest) {
          console.log(`[OK] ${doc} 内容是最新的，完全与 nodes 对齐。`);
        } else {
          console.log(`[WARN] ⚠️ ${doc} 基于 nodesDigest [${basedOn.slice(0, 10)}...] 已过期，当前最新为 [${actualNodesDigest.slice(0, 10)}...]，请运行 update-overview 获取最新总览并让模型重写。${NARRATIVE_SYNC_TEMPLATE}`);
          hasIssue = true;
        }
      } else {
        console.log(`[WARN] ⚠️ ${doc} 缺失 <!-- ASA-BASED-ON: ... --> 结构锚点！${NARRATIVE_SYNC_TEMPLATE}`);
        hasIssue = true;
      }
    } else {
      console.log(`[WARN] ⚠️ 缺失叙事型文件 docs/${doc}！建议在相应阶段建立。`);
      hasIssue = true;
    }
  }

  // 4. 开放 ISSUE 提示（非阻塞信息）
  const { loadAllNodes } = require('../lib/matrix.js');
  let openIssues = [];
  try {
    const nodes = loadAllNodes();
    openIssues = Object.entries(nodes)
      .filter(([id]) => id.startsWith('ISSUE-'))
      .filter(([, n]) => !['verified', 'wontfix', 'cancelled', 'resolved'].includes(n.status));
  } catch (e) {}
  if (openIssues.length > 0) {
    console.log(`[INFO] ℹ️ 存在 ${openIssues.length} 个未关闭问题(ISSUE)，请分流处置: ${openIssues.map(([id]) => id).join(', ')}`);
  } else {
    console.log(`[OK] 无未关闭问题(ISSUE)。`);
  }

  // 5. Legacy 无 type 的边诊断
  let legacyEdgesCount = 0;
  if (matrix.edges) {
    for (const e of matrix.edges) {
      if (!e.type) {
        legacyEdgesCount++;
      }
    }
  }

  if (legacyEdgesCount > 0) {
    console.log(`[WARN] ⚠️ 检测到项目中存在 ${legacyEdgesCount} 条未指定 type 的旧版 (Legacy) 边！已默认降级为 extends 规则。建议通过 edge rm/add 补齐。`);
    hasIssue = true;
  } else {
    console.log(`[OK] 项目边依赖图类型齐整，无 legacy 边。`);
  }

  console.log('\n=======================================');
  if (hasIssue) {
    console.log('💡 诊断报告提示有可升级/修复项。可使用 reconcile / compile 或重新 init 修复。');
  } else {
    console.log('🟢 完美！项目一切健康，所有契约强一致对齐！');
  }
}

module.exports = { run };

// engine/commands/diagnose.js
const { loadMatrix, calculateNodesDigest, calculateDocsDigest, loadAllNodes } = require('../lib/matrix.js');
const fs = require('fs');
const path = require('path');
const { ENGINE_VERSION, MIN_SCHEMA_VERSION } = require('../version.js');

function run() {
  console.log(`[ASA DIAGNOSE] 引擎版本: ${ENGINE_VERSION}`);
  let matrix;
  try {
    matrix = loadMatrix();
  } catch (e) {
    console.error(`[ASA DIAGNOSE] ❌ matrix.yaml 解析失败: ${e.message}`);
    process.exit(1);
  }

  const sv = matrix.meta?.schemaVersion || 1;
  console.log(`[ASA DIAGNOSE] 项目 Schema 版本: ${sv}`);
  
  if (sv < MIN_SCHEMA_VERSION) {
    console.log(`[ASA DIAGNOSE] ⚠️ Schema 版本 (${sv}) 低于引擎最低要求 (${MIN_SCHEMA_VERSION})，请运行 reconcile 升级。`);
  }

  let nodes;
  try {
    nodes = loadAllNodes();
  } catch (e) {
    console.error(`[ASA DIAGNOSE] ❌ 节点解析失败: ${e.message}`);
    process.exit(1);
  }

  const actualNodesDigest = calculateNodesDigest();
  const expectedNodesDigest = matrix.meta?.nodesDigest;

  console.log(`[ASA DIAGNOSE] Nodes Digest (当前/预期): ${actualNodesDigest} / ${expectedNodesDigest || 'none'}`);
  if (actualNodesDigest !== expectedNodesDigest) {
    console.log('[ASA DIAGNOSE] ⚠️ Nodes 存在脏增量未入账。');
  }

  const actualDocsDigest = calculateDocsDigest();
  const expectedDocsDigest = matrix.meta?.compiledDocsExpectedDigest || matrix.meta?.docsExpectedDigest;
  
  console.log(`[ASA DIAGNOSE] Docs Digest (当前/预期): ${actualDocsDigest} / ${expectedDocsDigest || 'none'}`);
  if (actualDocsDigest !== expectedDocsDigest) {
    console.log('[ASA DIAGNOSE] ⚠️ [DOCS_TAMPERED] 编译型文档 (docs) 与预期哈希不一致，可能是被外部直接修改了，请检查或重新 compile。');
  }

  // 检查 00 和 02 头部状态
  const checkBasedOn = (filename) => {
    const p = path.join(process.cwd(), 'docs', filename);
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      const match = content.match(/<!-- ASA-BASED-ON: (.*?) -->/);
      if (match) {
        console.log(`[ASA DIAGNOSE] ${filename} 基于 nodesDigest: ${match[1]}`);
        if (match[1] !== actualNodesDigest) {
          console.log(`[ASA DIAGNOSE] ⚠️ ${filename} 已经过期，请让 LLM 重新渲染。`);
        }
      } else {
        console.log(`[ASA DIAGNOSE] ⚠️ ${filename} 缺少 ASA-BASED-ON 标记。`);
      }
    }
  };

  checkBasedOn('00-overview.md');
  checkBasedOn('02-architecture.md');

  // Check Hooks
  const hooks = [
    '.husky/pre-commit',
    '.asa/hooks/check-work-order.js',
    '.asa/hooks/validate-yaml.js'
  ];
  for (const hook of hooks) {
    const p = path.join(process.cwd(), hook);
    if (!fs.existsSync(p)) {
      console.log(`[ASA DIAGNOSE] ⚠️ 缺失 Hook: ${hook}`);
    }
  }

  // Check legacy edges
  let hasLegacyEdges = false;
  if (matrix.edges) {
    for (const e of matrix.edges) {
      if (!e.type) {
        hasLegacyEdges = true;
        break;
      }
    }
  }
  if (hasLegacyEdges) {
    console.log('[ASA DIAGNOSE] ⚠️ 存在未指定 type 的旧版本 (Legacy) 边，请升级数据。');
  }

  // 扫描残留/未完成的脏事务并进行高亮 WARN 上报
  const txBaseDir = path.join(process.cwd(), '.asa/transactions');
  if (fs.existsSync(txBaseDir)) {
    try {
      const items = fs.readdirSync(txBaseDir);
      for (const item of items) {
        const txDir = path.join(txBaseDir, item);
        if (fs.statSync(txDir).isDirectory()) {
          const manifestPath = path.join(txDir, 'manifest.json');
          if (fs.existsSync(manifestPath)) {
            const raw = fs.readFileSync(manifestPath, 'utf-8').trim();
            if (raw) {
              try {
                const manifest = JSON.parse(raw);
                if (manifest.status !== 'completed') {
                  console.log(`[ASA DIAGNOSE] ⚠️ 发现未提交的脏事务: ${item} (状态: ${manifest.status}，开始于: ${manifest.startedAt || 'unknown'})！为了保证数据安全，建议运行任一写命令或 reconcile 执行物理回滚自愈。`);
                }
              } catch (parseErr) {
                console.log(`[ASA DIAGNOSE] ⚠️ 发现损坏的未完成事务目录: ${item} (清单损坏)！物理备份现场已锁定保护，请联系架构师或手动修复/清理 "${txDir}"。`);
              }
            }
          }
        }
      }
    } catch (e) {}
  }

  console.log('[ASA DIAGNOSE] ✅ 诊断完成（只读）。');
}

module.exports = { run };

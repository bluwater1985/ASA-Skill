// engine/commands/validate.js — 健康检查 + CI 门禁
const fs = require('fs');
const path = require('path');
const { loadMatrix, calculateDocsDigest, loadAllNodes } = require('../lib/matrix.js');
const { hasPendingPropagation } = require('../lib/changelog.js');

function run() {
  try {
    const matrix = loadMatrix();

    // 1. 文件存在性检查
    for (const [id, meta] of Object.entries(matrix.tasks || {})) {
      if (meta.file && !fs.existsSync(path.join(process.cwd(), meta.file))) {
        console.error(`[ASA] ❌ 索引任务 ${id} 指向的文件 ${meta.file} 不存在`);
        process.exit(1);
      }
    }

    // 2. docs digest 检查
    const physicalDigest = calculateDocsDigest();
    if (matrix.meta?.docsExpectedDigest !== physicalDigest) {
      console.error(`[ASA] ❌ docs/ 已被篡改或未运行 compile`);
      process.exit(1);
    }

    // 3. CI 门禁：pendingPropagation 检查
    const nodes = loadAllNodes();
    let blocking = false;
    for (const [id, node] of Object.entries(nodes)) {
      if (hasPendingPropagation(node)) {
        console.error(`[ASA] ❌ ${id} 存在未完成的传播条目`);
        blocking = true;
      }
    }

    if (blocking) {
      console.error('[ASA] ❌ 存在未完成的变更传播，请先运行 propagate');
      process.exit(1);
    }

    console.log('[ASA] ✅ 全量健康检查通过');
    process.exit(0);
  } catch (e) {
    console.error(`[ASA] ❌ validate 崩溃: ${e.message}`);
    process.exit(2);
  }
}

module.exports = { run };

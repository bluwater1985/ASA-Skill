// engine/commands/validate.js — 健康检查 + CI 门禁
const fs = require('fs');
const path = require('path');
const { loadMatrix, calculateDocsDigest, loadAllNodes, calculateNodesDigest } = require('../lib/matrix.js');
const { hasPendingPropagation } = require('../lib/changelog.js');
const { NARRATIVE_SYNC_TEMPLATE } = require('../lib/narrative-sync.js');

function run(args) {
  const isJson = args && args.includes('--json');

  const blockingErrors = [];
  const warnings = [];

  const logStatus = (msg) => {
    if (isJson) {
      console.error(msg);
    } else {
      console.log(msg);
    }
  };

  const logError = (msg) => {
    console.error(msg);
  };

  try {
    const matrix = loadMatrix();
    const nodes = loadAllNodes();

    // 1. 文件存在性检查 (Blocking)
    for (const [id, meta] of Object.entries(matrix.tasks || {})) {
      if (meta.file && !fs.existsSync(path.join(process.cwd(), meta.file))) {
        blockingErrors.push({
          code: 'MISSING_TASK_FILE',
          message: `索引任务 ${id} 指向的文件 ${meta.file} 不存在`,
          id,
          path: meta.file
        });
      }
    }

    // 2. docs digest 编译型文档哈希检查 (Blocking)
    const physicalDigest = calculateDocsDigest();
    const expectedDocsDigest = matrix.meta?.compiledDocsExpectedDigest || matrix.meta?.docsExpectedDigest;
    if (expectedDocsDigest && expectedDocsDigest !== physicalDigest) {
      blockingErrors.push({
        code: 'DOCS_TAMPERED_OR_OUT_OF_SYNC',
        message: 'docs/ 编译型文档被物理修改或未运行 compile'
      });
    }

    // 3. pendingPropagation 变更传播拦截 (Blocking)
    for (const [id, node] of Object.entries(nodes)) {
      if (hasPendingPropagation(node)) {
        blockingErrors.push({
          code: 'PENDING_PROPAGATION',
          message: `${id} 存在未完成的传播条目，请先运行 propagate`,
          id
        });
      }
    }

    // 4. 节点漂移检测 nodesDigest (Blocking)
    const currentNodesDigest = calculateNodesDigest();
    if (matrix.meta?.nodesDigest && matrix.meta.nodesDigest !== currentNodesDigest) {
      blockingErrors.push({
        code: 'NODES_DRIFT',
        message: '节点文件已变更但未重新 compile，请运行 node .asa/index.js compile'
      });
    }

    // ── 5. 新增：非阻塞性追溯/拆解告警 (Warnings, exit 0) ──

    // 整理所有 TASK 的反向关联、属性及 changeFiles
    const tasks = Object.entries(nodes).filter(([id]) => id.startsWith('TASK-'));
    const reqs = Object.entries(nodes).filter(([id]) => id.startsWith('REQ-'));

    const reqLinkedTasks = {};
    for (const [reqId] of reqs) {
      reqLinkedTasks[reqId] = [];
    }

    for (const [taskId, taskNode] of tasks) {
      const linked = taskNode.linkedReqs || [];
      
      // 5.1 孤儿任务：非 cancelled 且无 linkedReqs
      if (taskNode.status !== 'cancelled' && linked.length === 0) {
        warnings.push({
          code: 'ORPHAN_TASK',
          message: `孤儿任务: TASK ${taskId} 非 cancelled 且没有关联任何 REQ`,
          id: taskId
        });
      }

      for (const reqId of linked) {
        if (reqLinkedTasks[reqId]) {
          reqLinkedTasks[reqId].push(taskId);
        }

        // 5.2 进度不一致：TASK completed/verified 但关联 REQ 非 implemented
        const reqNode = nodes[reqId];
        if (reqNode && ['completed', 'verified'].includes(taskNode.status) && reqNode.status !== 'implemented') {
          warnings.push({
            code: 'PROGRESS_INCONSISTENCY',
            message: `进度不一致: TASK ${taskId} 已完成/已验证，但关联需求 ${reqId} 状态非 implemented`,
            id: taskId
          });
        }
      }

      // 5.3 缺变更记录：TASK completed 但 changedFiles 为空
      if (taskNode.status === 'completed' && (!taskNode.changedFiles || taskNode.changedFiles.length === 0)) {
        warnings.push({
          code: 'MISSING_CHANGE_RECORD',
          message: `缺变更记录: TASK ${taskId} 已完成但 changedFiles 为空`,
          id: taskId
        });
      }
    }

    for (const [reqId, reqNode] of reqs) {
      const linkedTasks = reqLinkedTasks[reqId] || [];
      const delType = reqNode.deliveryType || 'code';

      // 5.4 悬空需求：REQ 为 approved/implemented，deliveryType 为 code 且无 TASK 关联它
      if (['approved', 'implemented'].includes(reqNode.status) && delType === 'code' && linkedTasks.length === 0) {
        warnings.push({
          code: 'HANGING_REQUIREMENT',
          message: `悬空需求: REQ ${reqId} 为 approved/implemented 且 deliveryType 为 code 却没有任何 TASK 关联它`,
          id: reqId
        });
      }

      // 5.5 拆解粒度过粗告警：验收标准 >= 4 条但关联任务只有 1 个
      const criteriaCount = Array.isArray(reqNode.acceptanceCriteria) ? reqNode.acceptanceCriteria.length : 0;
      if (criteriaCount >= 4 && linkedTasks.length === 1) {
        warnings.push({
          code: 'INSUFFICIENT_DECOMPOSITION',
          message: `复杂需求疑似只拆分了一个任务（acceptanceCriteria ${criteriaCount} 条，关联任务 1 个），建议垂直拆解`,
          id: reqId
        });
      }
    }

    // 5.6 叙事文档 00/02 ASA-BASED-ON 锚点哈希对账 (N2 级修复)
    const activeNodesDigest = matrix.meta?.nodesDigest || 'sha256:empty';
    const checkDocBasedOn = (filename) => {
      const p = path.join(process.cwd(), 'docs', filename);
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8');
        const match = content.match(/<!-- ASA-BASED-ON: (.*?) -->/);
        if (match) {
          if (match[1] !== activeNodesDigest) {
            warnings.push({
              code: 'NARRATIVE_OUTDATED',
              message: `⚠️ 叙事文档已过期: 锚点指纹不匹配。概览与设计（00/02）已落后于节点最新变更。请运行 update-overview 重新生成。${NARRATIVE_SYNC_TEMPLATE}`,
              id: `docs/${filename}`
            });
          }
        } else {
          warnings.push({
            code: 'NARRATIVE_OUTDATED',
            message: `⚠️ 叙事文档缺失指纹: 未包含 <!-- ASA-BASED-ON --> 校验锚点，请运行 update-overview 重新初始化。${NARRATIVE_SYNC_TEMPLATE}`,
            id: `docs/${filename}`
          });
        }
      } else {
        warnings.push({
          code: 'NARRATIVE_OUTDATED',
          message: `⚠️ 叙事文档缺失: 未在 docs/ 下发现 ${filename}，请运行 update-overview 重新生成并交由模型初始化。${NARRATIVE_SYNC_TEMPLATE}`,
          id: `docs/${filename}`
        });
      }
    };
    checkDocBasedOn('00-overview.md');
    checkDocBasedOn('02-architecture.md');

    // 6. 统一输出结果
    const isBlocked = blockingErrors.length > 0;
    const finalStatus = isBlocked ? 'blocked' : 'ok';

    if (isJson) {
      const resultJson = {
        status: finalStatus,
        blockingErrors,
        warnings,
        summary: {
          nodes: Object.keys(nodes).length,
          tasks: tasks.length,
          awaitingConfirmation: tasks.filter(([, t]) => t.status === 'awaiting-confirmation').length
        }
      };
      console.log(JSON.stringify(resultJson, null, 2));
      process.exit(isBlocked ? 1 : 0);
    } else {
      // 纯文本友好展示
      if (warnings.length > 0) {
        logStatus('=== ⚠️ [ASA validate] 诊断告警列表 (非阻塞) ===');
        warnings.forEach(w => {
          logStatus(`  [WARN] [${w.code}] ${w.message} ${w.id ? `(节点: ${w.id})` : ''}`);
        });
        logStatus('');
      }

      if (isBlocked) {
        logError('=== ❌ [ASA validate] 致命阻塞错误列表 ===');
        blockingErrors.forEach(e => {
          logError(`  [ERROR] [${e.code}] ${e.message} ${e.id ? `(节点: ${e.id})` : ''}`);
        });
        logError('\n[ASA] ❌ 门禁检查未通过！请修复上述致命错误。');
        process.exit(1);
      } else {
        logStatus('=== 🟢 [ASA validate] 完美！全量健康检查通过 ===');
        process.exit(0);
      }
    }
  } catch (e) {
    if (isJson) {
      console.log(JSON.stringify({
        status: 'error',
        message: e.message
      }));
    } else {
      logError(`[ASA] ❌ validate 运行崩溃: ${e.message}`);
    }
    process.exit(2);
  }
}

module.exports = { run };

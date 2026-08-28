#!/usr/bin/env node
// .asa/hooks/check-work-order.js — ASA 状态拦截器
//
// 跨平台设计：
//   入口寻址：通过 process.argv[1] 自定位所在目录，不依赖 CWD
//   路径归一：path.resolve() 压平 Windows 正反斜杠差异
//   协议自适应：自动检测 Claude Code（argv）或 Gemini CLI（stdin JSON）
//   拦截协议：Gemini CLI 下统一 stdout JSON + exit 0

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const isCI = process.env.CI === 'true';

let GUEST_HOOK_STDIN_TIMEOUT = 12000;
try {
  const constants = require('../lib/constants.js');
  GUEST_HOOK_STDIN_TIMEOUT = constants.GUEST_HOOK_STDIN_TIMEOUT;
} catch (e) {}

// ── 自定位：优先以目标写入路径，次以脚本所在目录，寻找项目根目录 ──
function findProjectRoot(target, fromDir) {
  let start = process.cwd();
  if (target) {
    const absTarget = path.isAbsolute(target) ? target : path.join(process.cwd(), target);
    start = path.dirname(absTarget);
  } else if (fromDir) {
    start = fromDir;
  }
  let dir = start;
  while (true) {
    if (fs.existsSync(path.join(dir, '.asa/matrix.yaml'))) return path.resolve(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd()); // 兜底
}

const SCRIPT_DIR = path.dirname(process.argv[1] || '.');

// ── 🛡️ N2/B2 物理零污染哨兵：仅在已知 argv 入口文件路径的 Claude 模式下，直接在最头部瞬间 Fail-Open 放行 ──
if (process.argv[2] && !process.argv[2].startsWith('-') && process.argv[2] !== '$FILE_PATH') {
  const checkRoot = findProjectRoot(process.argv[2], SCRIPT_DIR);
  if (!fs.existsSync(path.join(checkRoot, '.asa/matrix.yaml'))) {
    process.exit(0);
  }

  // 🚀 防双 Hook 注册执行踩踏 (ADR-22 修复) 🚀
  // 如果当前运行的是全局 Hook (即脚本不在当前项目的 .asa 目录下)，且当前项目已经有了局部的相对路径 Hook 注册
  const isGlobalHook = !path.resolve(__filename).startsWith(path.join(checkRoot, '.asa'));
  if (isGlobalHook) {
    const localSettingsPath = path.join(checkRoot, '.claude/settings.local.json');
    if (fs.existsSync(localSettingsPath)) {
      try {
        const localSettings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf-8'));
        if (localSettings.hooks?.PreToolUse?.some(h => h.name === 'asa-check-work-order')) {
          // 局部 Hook 已托管写盘，全局 Hook 自动瞬间 Fail-Open 让行！
          process.exit(0);
        }
      } catch (e) {}
    }
  }
}

// ── 入口分流 ──
if (process.argv[2] === '$FILE_PATH') {
  // 宿主未展开的占位符（如 $FILE_PATH），直接友好放行，防编辑器写盘挂起死锁 (B1 修复)
  allowWithCleanup(null, '', 'claude', "Claude $FILE_PATH placeholder bypass");
} else if (process.argv[2] && !process.argv[2].startsWith('-')) {
  checkAndExit(process.argv[2] || '', 'claude');
} else {
  let data = '';
  process.stdin.on('data', chunk => { data += chunk; });
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(data);
      const filePath = payload?.arguments?.file_path
        || payload?.arguments?.path
        || payload?.toolInput?.file_path
        || payload?.tool_input?.file_path
        || payload?.hook_input?.file_path
        || payload?.hook_event?.tool_input?.file_path
        || payload?.file_path
        || '';
      if (!filePath) {
        // 无法提取路径
        const projectRoot = findProjectRoot('', SCRIPT_DIR);
        if (isCI) {
          deny(projectRoot, '', 'gemini', '无法识别文件路径，在 CI 模式下拦截。');
        } else {
          deny(projectRoot, '', 'gemini', '无法识别文件路径，执行 Fail-Closed 拦截。');
        }
      }
      checkAndExit(filePath, 'gemini');
    } catch (e) {
      const projectRoot = findProjectRoot('', process.cwd());
      if (!fs.existsSync(path.join(projectRoot, '.asa/matrix.yaml'))) {
        allowWithCleanup(projectRoot, '', 'gemini', '非 ASA 项目，直接放行 (Fail-Open)。');
        return;
      }
      if (isCI) {
        deny(projectRoot, '', 'gemini', `JSON 解析异常: ${e.message}，在 CI 模式下拦截。`);
      } else {
        deny(projectRoot, '', 'gemini', `JSON 解析异常: ${e.message}，执行 Fail-Closed 拦截。`);
      }
    }
    });
    setTimeout(() => {
    const projectRoot = findProjectRoot('', process.cwd());
    if (isCI) {
      deny(projectRoot, '', 'gemini', '获取 stdin 超时，在 CI 模式下拦截。');
    } else {
      deny(projectRoot, '', 'gemini', '获取 stdin 超时，执行 Fail-Closed 拦截。');
    }
    }, GUEST_HOOK_STDIN_TIMEOUT);
}

// ── 核心检查 ──
function checkAndExit(target, mode) {
  const projectRoot = findProjectRoot(target, SCRIPT_DIR);
  
  // 🚀 N2/B2 核心物理零污染哨兵：在最终执行核心拦截逻辑前，若不属于 ASA 项目，瞬间 Fail-Open 100% 放行！ 🚀
  if (!fs.existsSync(path.join(projectRoot, '.asa/matrix.yaml'))) {
    allowWithCleanup(projectRoot, target, mode, '非 ASA 项目，直接放行 (Fail-Open)。');
    return;
  }

  const matrixPath = path.join(projectRoot, '.asa/matrix.yaml');
  let resolvedPath = '';

  try {
    // 2. 判定绝对路径与项目根内白名单边界
    resolvedPath = path.isAbsolute(target) ? path.resolve(target) : path.join(projectRoot, target);
    const relative = path.relative(projectRoot, resolvedPath);
    const normalizedRelative = relative.replace(/\\/g, '/');
    const isInsideProject = !relative.startsWith('..') && !path.isAbsolute(relative);

    // 3. 结构化加载 matrix.yaml（严格防卫，杜绝格式崩溃伪放行）与版本守卫（最高优先级安全契约）
    let matrix = null;
    if (fs.existsSync(matrixPath)) {
      try {
        const { loadMatrix } = require('../lib/matrix.js');
        const originalCwd = process.cwd;
        process.cwd = () => projectRoot;
        matrix = loadMatrix();
        process.cwd = originalCwd;
      } catch (loadErr) {
        deny(projectRoot, resolvedPath, mode, `[ASA 拦截] 核心元数据 .asa/matrix.yaml 损坏且无法加载。错误: ${loadErr.message}。请运行 reconcile 恢复数据。`);
        return;
      }

      const { MAX_SUPPORTED_SCHEMA } = require('../version.js');
      const sv = matrix.meta?.schemaVersion || 1;
      if (sv > MAX_SUPPORTED_SCHEMA) {
        deny(projectRoot, resolvedPath, mode, `[ASA 拦截] ❌ 引擎版本过低，无法安全修改更高 Schema 版本（${sv}）的项目，请升级全局 ASA 引擎。`);
        return;
      }
    }

    // 4. 执行 BeforeTool 备份协议 (支持并发沙盒与写后回滚)
    // 强力对账与隐私治理：只有针对 .yaml 格式的节点文件覆写才需要建立物理备份现场，非 yaml 格式（如白名单 Markdown 等）绝不备份，彻底消灭残留泄露 (B3)
    if (isInsideProject && resolvedPath.endsWith('.yaml')) {
      const hash = getPathHash(resolvedPath);
      const txDir = path.join(projectRoot, '.asa/transactions');
      fs.mkdirSync(txDir, { recursive: true });

      // 引入 UUID 级别防碰撞
      const crypto = require('crypto');
      const invocationId = crypto.randomUUID ? crypto.randomUUID() : (Date.now() + Math.random().toString(36).slice(2));

      // 写入物理独立去中心化先进先出队列配对文件 (ADR-25 修复，消除并发读写争用)
      const invocationFile = path.join(txDir, `invocation-${hash}.json`);
      let invocationIds = [];
      const lockKey = lockFile(invocationFile);
      let beforeParseFailed = false;
      if (fs.existsSync(invocationFile)) {
        try {
          const map = JSON.parse(fs.readFileSync(invocationFile, 'utf-8'));
          if (Array.isArray(map.invocationIds)) {
            invocationIds = map.invocationIds;
          }
        } catch (e) {
          beforeParseFailed = true;
        }
      }
      if (beforeParseFailed) {
        unlockFile(lockKey);
        throw new Error(`检测到损坏的 invocation 映射文件: ${invocationFile}。拒绝覆盖，保留现场。`);
      }
      invocationIds.push(invocationId);
      try {
        const tmpFile = invocationFile + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify({ invocationIds }, null, 2), 'utf-8');
        fs.renameSync(tmpFile, invocationFile);
      } catch (e) {}
      unlockFile(lockKey);

      const backupPath = path.join(txDir, `hook-${hash}-${invocationId}.bak`);
      const markerPath = path.join(txDir, `hook-${hash}-${invocationId}.created`);

      // 物理清洗以前的残留，保证隔离性
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);

      if (fs.existsSync(resolvedPath)) {
        fs.copyFileSync(resolvedPath, backupPath);
      } else {
        fs.writeFileSync(markerPath, '1', 'utf-8');
      }
    }

    // 5. 物理放行白名单范围（仅限项目根目录下的白名单）
    let isWhitelisted = false;
    if (isInsideProject) {
      if (normalizedRelative.startsWith('.asa/') || normalizedRelative.startsWith('docs/')) {
        isWhitelisted = true;
      }
    }

    if (isWhitelisted) {
      allowWithCleanup(projectRoot, resolvedPath, mode);
      return;
    }

    if (!matrix) {
      allowWithCleanup(projectRoot, resolvedPath, mode);
      return;
    }

    const activeTask = matrix.meta?.activeTask || '(none)';
    const phase = matrix.meta?.phase || 'discovery';

    // 仅且严格在 implementation（实现阶段）执行拦截，其余设计/开发前期阶段放行
    if (phase !== 'implementation') {
      allowWithCleanup(projectRoot, resolvedPath, mode);
      return;
    }

    // 7. 活跃任务卫兵
    if (!activeTask || activeTask === '(none)' || activeTask === 'null') {
      deny(projectRoot, resolvedPath, mode, `当前没有活跃 Task（phase: ${phase}）。为了确保数据追溯一致性，在实现阶段改写业务源码前，必须先激活当前工作的 Task。请先运行 node .asa/index.js set active-task <TASK-ID> 激活任务。`);
      return;
    }

    // 8. 活跃任务状态卫兵 (Awaiting / Completed 冻结)
    let status = matrix.tasks?.[activeTask]?.status;
    if (!status) {
      // 尝试去读取真实的节点 yaml 文件 (ADR-28 提升，保障 compile 延迟下的数据原子性)
      const taskPath = path.join(projectRoot, `.asa/nodes/tasks/${activeTask}.yaml`);
      if (fs.existsSync(taskPath)) {
        try {
          const text = fs.readFileSync(taskPath, 'utf-8');
          const m = text.match(/status:\s*['"]?([a-zA-Z0-9_-]+)['"]?/);
          if (m) status = m[1];
        } catch (e) {}
      }
    }

    if (status === 'awaiting-confirmation') {
      deny(projectRoot, resolvedPath, mode, `当前激活任务 ${activeTask} 状态正处于 awaiting-confirmation（等待用户确认中）。在完成确认或打回前，拒绝在当前任务上下文内执行任何源码修改。请运行 confirm-task 或 reject-task 处理。`);
      return;
    }
    if (status === 'completed' || status === 'verified' || status === 'cancelled') {
      deny(projectRoot, resolvedPath, mode, `当前激活任务 ${activeTask} 状态为已失效 (${status})。拒绝在已失效的任务下继续修改源码。如需修改，请创建新任务或激活其他 in_progress 任务。`);
      return;
    }

    allowWithCleanup(projectRoot, resolvedPath, mode);
  } catch (err) {
    if (isCI) {
      deny(projectRoot, resolvedPath, mode, `check-work-order Hook 运行中抛出未捕获异常: ${err.message}`);
    } else {
      deny(projectRoot, resolvedPath, mode, `check-work-order Hook 运行中抛出异常: ${err.message}`);
    }
  }
}

function getPathHash(filePath) {
  const crypto = require('crypto');
  const norm = path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
  return crypto.createHash('sha256').update(norm).digest('hex').substring(0, 12);
}

function allowWithCleanup(projectRoot, resolvedPath, mode, msg) {
  // 仅在 PreToolUse 前置放行，此时尚未执行实际物理写盘，故备份文件绝对不可清理，必须完整留盘供 AfterTool 校验及强回滚使用 (B-3/P1/P3 修复)
  if (mode === 'gemini') {
    const res = { decision: 'allow' };
    if (msg) res.systemMessage = `[ASA 放行] ${msg}`;
    console.log(JSON.stringify(res));
  } else if (msg) console.log(`[ASA 放行] ${msg}`);
  process.exit(0);
}

function lockFile(filePath, timeout = 5000) {
  const lockPath = filePath + '.lock';
  const start = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.closeSync(fd);
      return lockPath;
    } catch (err) {
      // 陈旧死锁防呆自愈 (ADR-28)：检查锁创建时长是否超过 10s
      try {
        const stat = fs.statSync(lockPath);
        const age = Date.now() - stat.mtimeMs;
        if (age > 10000) {
          try { fs.unlinkSync(lockPath); } catch (e) {}
          continue; // 重新抢占
        }
      } catch (e) {}

      if (Date.now() - start > timeout) {
        throw new Error(`锁获取超时: ${lockPath}。已被陈旧挂死，为保障数据原子性，执行 Fail-Closed 强拦截。`);
      }
      const end = Date.now() + 10;
      while (Date.now() < end) {}
    }
  }
}

function unlockFile(lockPath) {
  if (lockPath) {
    try { fs.unlinkSync(lockPath); } catch (e) {}
  }
}

function deny(projectRoot, resolvedPath, mode, reason) {
  const marked = `[ASA 拦截] ${reason}`;
  if (mode === 'gemini') {
    console.log(JSON.stringify({ decision: 'deny', reason: marked, systemMessage: marked }));
    process.exit(0);
  } else {
    console.error(marked);
    process.exit(2); // 统一 2 阻断 (符合 Claude Code 阻断规范)
  }
}

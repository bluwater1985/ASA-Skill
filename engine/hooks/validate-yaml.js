#!/usr/bin/env node
// .asa/hooks/validate-yaml.js — ASA YAML 合法性校验器与后置回滚引擎
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

// 复用引擎真实 YAML 解析器
let parseAsaYaml = null;
try { ({ parseAsaYaml } = require('../lib/yaml.js')); } catch (e) { parseAsaYaml = null; }

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
  return path.resolve(process.cwd());
}

const SCRIPT_DIR = path.dirname(process.argv[1] || '.');

// ── 🛡️ N2/B2 物理零污染哨兵：如果当前没有检测到包含 .asa/matrix.yaml 的项目根，立刻 100% 瞬间 Fail-Open 放行 ──
const checkTarget = (process.argv[2] && !process.argv[2].startsWith('-') && process.argv[2] !== '$FILE_PATH') ? process.argv[2] : '';
const checkRoot = findProjectRoot(checkTarget, SCRIPT_DIR);
if (!fs.existsSync(path.join(checkRoot, '.asa/matrix.yaml'))) {
  const isGemini = !process.argv[2] || process.argv[2].startsWith('-');
  if (isGemini) {
    console.log(JSON.stringify({ decision: 'allow' }));
  }
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
      if (localSettings.hooks?.PostToolUse?.some(h => h.name === 'asa-validate-yaml')) {
        // 局部 Hook 已托管校验，全局 Hook 自动瞬间 Fail-Open 让行！
        const isGemini = !process.argv[2] || process.argv[2].startsWith('-');
        if (isGemini) {
          console.log(JSON.stringify({ decision: 'allow' }));
        }
        process.exit(0);
      }
    } catch (e) {}
  }
}

// ── 入口分流 ──
if (process.argv[2] === '$FILE_PATH') {
  // 占位符友好放行 (B1 修复)
  const projectRoot = findProjectRoot('', SCRIPT_DIR);
  allowWithCleanup(projectRoot, '', 'claude', "Claude $FILE_PATH placeholder bypass");
} else if (process.argv[2] && !process.argv[2].startsWith('-')) {
  validateAndExit(process.argv[2] || '', 'claude');
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
        const projectRoot = findProjectRoot('', SCRIPT_DIR);
        if (isCI) {
          denyWithRollback(projectRoot, '', 'gemini', '未能识别写入文件路径，在 CI 模式下拦截。');
        } else {
          denyWithRollback(projectRoot, '', 'gemini', '未能识别写入文件路径，执行 Fail-Closed 拦截。');
        }
      }
      validateAndExit(filePath, 'gemini');
    } catch (e) {
      const projectRoot = findProjectRoot('');
      if (!fs.existsSync(path.join(projectRoot, '.asa/matrix.yaml'))) {
        allowWithCleanup(projectRoot, '', 'gemini', '非 ASA 项目，直接放行 (Fail-Open)。');
        return;
      }
      if (isCI) {
        denyWithRollback(projectRoot, '', 'gemini', `JSON 解析异常: ${e.message}，在 CI 模式下拦截。`);
      } else {
        denyWithRollback(projectRoot, '', 'gemini', `JSON 解析异常: ${e.message}，执行 Fail-Closed 拦截。`);
      }
    }
  });
  setTimeout(() => {
    const projectRoot = findProjectRoot('');
    if (isCI) {
      denyWithRollback(projectRoot, '', 'gemini', '获取 stdin 超时，在 CI 模式下拦截。');
    } else {
      denyWithRollback(projectRoot, '', 'gemini', '获取 stdin 超时，执行 Fail-Closed 拦截。');
    }
  }, GUEST_HOOK_STDIN_TIMEOUT);
}

function getPathHash(filePath) {
  const norm = path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
  return crypto.createHash('sha256').update(norm).digest('hex').substring(0, 12);
}

function validateAndExit(target, mode) {
  const projectRoot = findProjectRoot(target, SCRIPT_DIR);
  
  // 🚀 N2/B2 核心物理零污染哨兵：在最终执行核心拦截逻辑前，若不属于 ASA 项目，瞬间 Fail-Open 100% 放行！ 🚀
  if (!fs.existsSync(path.join(projectRoot, '.asa/matrix.yaml'))) {
    allowWithCleanup(projectRoot, target, mode, '非 ASA 项目，直接放行 (Fail-Open)。');
    return;
  }

  let resolvedPath = '';

  try {
    resolvedPath = path.isAbsolute(target) ? path.resolve(target) : path.join(projectRoot, target);
    const relative = path.relative(projectRoot, resolvedPath);
    const normalizedRelative = relative.replace(/\\/g, '/');
    const isInsideProject = !relative.startsWith('..') && !path.isAbsolute(relative);

    // 3. 结构化加载 matrix.yaml 并进行版本上限守护
    const matrixPath = path.join(projectRoot, '.asa/matrix.yaml');
    if (fs.existsSync(matrixPath)) {
      try {
        const { loadMatrix } = require('../lib/matrix.js');
        const originalCwd = process.cwd;
        process.cwd = () => projectRoot;
        const matrix = loadMatrix();
        process.cwd = originalCwd;

        if (matrix && matrix.meta) {
          const { MAX_SUPPORTED_SCHEMA } = require('../version.js');
          const sv = matrix.meta.schemaVersion || 1;
          if (sv > MAX_SUPPORTED_SCHEMA) {
            denyWithRollback(projectRoot, resolvedPath, mode, `[ASA 拦截] ❌ 引擎版本过低，无法安全修改更高 Schema 版本（${sv}）的项目，请升级全局 ASA 引擎。`);
            return;
          }
        }
      } catch (e) {
        denyWithRollback(projectRoot, resolvedPath, mode, `[ASA 拦截] 核心元数据 .asa/matrix.yaml 损坏且无法加载。错误: ${e.message}。请运行 reconcile 恢复数据。`);
        return;
      }
    }

    // 物理放行白名单范围（如果文件是在项目根内白名单路径下，不进行节点契约检查，直接放行并清理备份）
    let isWhitelisted = false;
    if (isInsideProject) {
      if (normalizedRelative.startsWith('.asa/') || normalizedRelative.startsWith('docs/')) {
        // 仅当不属于节点文件（.yaml）时放行白名单，YAML 节点仍需严格校验契约
        if (!target.endsWith('.yaml')) {
          isWhitelisted = true;
        }
      }
    }

    if (isWhitelisted) {
      allowWithCleanup(projectRoot, resolvedPath, mode);
      return;
    }

    // 仅对项目内的 YAML 节点进行强规范约束
    if (!isInsideProject || !target.endsWith('.yaml')) {
      allowWithCleanup(projectRoot, resolvedPath, mode);
      return;
    }

    if (!fs.existsSync(resolvedPath)) {
      allowWithCleanup(projectRoot, resolvedPath, mode);
      return;
    }

    const text = fs.readFileSync(resolvedPath, 'utf-8');

    // 优先用真实解析器校验（捕获缩进、Tab、冒号空格等结构性语法错误）
    if (parseAsaYaml) {
      try {
        const data = parseAsaYaml(text);
        
        // 强校验核心节点契约标准
        const baseName = path.basename(resolvedPath);
        const isReq = baseName.startsWith('REQ-');
        const isArch = baseName.startsWith('ARCH-');
        const isTask = baseName.startsWith('TASK-');

        if (isReq || isArch || isTask) {
          if (!data.id) throw new Error('缺失 id 字段');
          if (!data.title) throw new Error('缺失 title 字段');
          if (!data.status) throw new Error('缺失 status 字段');

          // 按分类强校验状态值合法性
          let validStates;
          if (isReq) {
            validStates = new Set(['proposed', 'approved', 'rejected', 'modified', 'deprecated', 'implemented']);
          } else if (isArch) {
            validStates = new Set(['draft', 'reviewed', 'approved', 'superseded']);
          } else {
            validStates = new Set(['pending', 'in_progress', 'blocked', 'awaiting-confirmation', 'completed', 'verified', 'cancelled']);
          }
          if (!validStates.has(data.status)) {
            throw new Error(`非法的 status 状态值: "${data.status}"`);
          }

          // TASK 节点强契约补齐检验
          if (isTask) {
            if (!Array.isArray(data.linkedReqs)) throw new Error('TASK 节点缺失 linkedReqs 数组');
            if (!Array.isArray(data.changedFiles)) throw new Error('TASK 节点缺失 changedFiles 数组');
          }
        }

        allowWithCleanup(projectRoot, resolvedPath, mode, `✅ YAML 通过: ${target}`);
      } catch (e) {
        denyWithRollback(projectRoot, resolvedPath, mode, `YAML 契约校验失败: ${target} — ${e.message}`);
      }
      return;
    }

    // 降级：浅层字符校验
    const lines = text.split('\n').filter(l => {
      const s = l.trim();
      return s !== '' && !s.startsWith('#') && !s.startsWith('---');
    });
    if (lines.length === 0 || !lines.some(l => l.includes(':'))) {
      denyWithRollback(projectRoot, resolvedPath, mode, `YAML 格式错误: ${target} — 没有找到有效的 key: value 结构`);
      return;
    }
    allowWithCleanup(projectRoot, resolvedPath, mode, `✅ YAML 通过 (降级): ${target}`);
  } catch (err) {
    denyWithRollback(projectRoot, resolvedPath, mode, `validate-yaml Hook 运行中抛出异常: ${err.message}`);
  }
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

function getInvocationBackupPaths(projectRoot, hash) {
  const txDir = path.join(projectRoot, '.asa/transactions');
  fs.mkdirSync(txDir, { recursive: true });
  const invocationFile = path.join(txDir, `invocation-${hash}.json`);
  let invocationId = 'unknown';
  let invocationIds = [];
  let parseFailed = false;

  const lockKey = lockFile(invocationFile);
  if (fs.existsSync(invocationFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(invocationFile, 'utf-8'));
      if (data && Array.isArray(data.invocationIds)) {
        invocationIds = data.invocationIds;
        if (invocationIds.length > 0) {
          invocationId = invocationIds.shift(); // 先进先出 FIFO 出队
        }
      }
    } catch (e) {
      parseFailed = true;
    }

    try {
      if (parseFailed) {
        throw new Error(`检测到损坏的 invocation 映射文件: ${invocationFile}。拒绝静默删除，保留现场。`);
      } else if (invocationIds.length === 0) {
        fs.unlinkSync(invocationFile);
      } else {
        const tmpFile = invocationFile + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify({ invocationIds }, null, 2), 'utf-8');
        fs.renameSync(tmpFile, invocationFile);
      }
    } catch (e) {
      unlockFile(lockKey);
      throw e;
    }
  }
  unlockFile(lockKey);

  const backupPath = path.join(txDir, `hook-${hash}-${invocationId}.bak`);
  const markerPath = path.join(txDir, `hook-${hash}-${invocationId}.created`);
  return { backupPath, markerPath, invocationFile, invocationIds };
}

function allowWithCleanup(projectRoot, resolvedPath, mode, msg) {
  // 校验成功，物理清理临时 Hook 备份及标记，避免空间泄露
  if (resolvedPath && projectRoot) {
    const hash = getPathHash(resolvedPath);
    const { backupPath, markerPath } = getInvocationBackupPaths(projectRoot, hash);
    try {
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
    } catch (e) {}
  }

  if (mode === 'gemini') {
    const res = { decision: 'allow' };
    if (msg) res.systemMessage = `[ASA 放行] ${msg}`;
    console.log(JSON.stringify(res));
  } else if (msg) console.log(`[ASA 放行] ${msg}`);
  process.exit(0);
}

function denyWithRollback(projectRoot, resolvedPath, mode, reason) {
  // 校验失败，执行写后强回滚协议，原子级恢复数据
  if (resolvedPath && projectRoot) {
    const hash = getPathHash(resolvedPath);

    try {
      const { backupPath, markerPath } = getInvocationBackupPaths(projectRoot, hash);

      if (fs.existsSync(markerPath)) {
        // 如果文件 is 新创建的，物理删除它
        if (fs.existsSync(resolvedPath)) fs.unlinkSync(resolvedPath);
      } else if (fs.existsSync(backupPath)) {
        // 如果文件已存在，物理覆盖还原原貌
        fs.copyFileSync(backupPath, resolvedPath);
      }

      // 清理备份残留
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
    } catch (err) {
      console.error(`[ASA Hook Rollback Exception] 还原备份失败: ${err.message}`);
    }
  }

  const marked = `[ASA 拦截] ${reason}`;
  if (mode === 'gemini') {
    console.log(JSON.stringify({ decision: 'deny', reason: marked, systemMessage: marked }));
    process.exit(0);
  } else {
    console.error(marked);
    process.exit(2); // 统一 2 阻断 (符合 Claude Code 阻断规范)
  }
}

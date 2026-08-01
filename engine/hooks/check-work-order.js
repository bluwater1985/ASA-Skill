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

// ── 自定位：以脚本自身所在目录为锚点寻找项目根目录 ──
function findProjectRoot(fromDir) {
  let dir = fromDir || process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, '.asa/matrix.yaml'))) return path.resolve(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd()); // 兜底
}

// 从脚本自身所在目录开始搜索，不受 CWD 影响
const SCRIPT_DIR = path.dirname(process.argv[1] || '.');
const PROJECT_ROOT = findProjectRoot(SCRIPT_DIR);
const matrixPath = path.join(PROJECT_ROOT, '.asa/matrix.yaml');

// ── 入口分流 ──
// argv[2] 是真实文件路径 → Claude argv 模式
// argv[2] 为空/flag/未展开的 $FILE_PATH 字面量 → stdin JSON 模式（Claude Code 官方协议）
if (process.argv[2] && !process.argv[2].startsWith('-') && !process.argv[2].startsWith('$')) {
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
        // 提取不到文件路径 → fail-open，避免误拦截全部写入
        console.log(JSON.stringify({ decision: 'allow', systemMessage: '[ASA 放行] 未能识别文件路径，放行' }));
        process.exit(0);
      }
      checkAndExit(filePath, 'gemini');
    } catch (e) {
      console.log(JSON.stringify({ decision: 'allow', systemMessage: '[ASA 放行] hook 解析失败，放行' }));
      process.exit(0);
    }
  });
  setTimeout(() => {
    console.log(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }, 15000);
}

// ── 核心检查 ──
function checkAndExit(target, mode) {
  // 归一化反斜杠，兼容 Windows 路径
  if (target) target = target.replace(/\\/g, '/');

  if (!fs.existsSync(matrixPath)) {
    allow(mode);
    return;
  }

  const content = fs.readFileSync(matrixPath, 'utf-8');
  // 过滤注释行后再匹配，避免命中注释里的陈旧值
  const codeLines = content.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  const activeTask = codeLines.match(/activeTask:\s*"?([^"\n\s]+)"?/)?.[1];
  const phase = codeLines.match(/phase:\s*"?([^"\n\s]+)"?/)?.[1];

  if (target && target.includes('.asa/')) { allow(mode); return; }
  if (['init', 'discovery', 'architecture', 'task-breakdown'].includes(phase)) { allow(mode); return; }

  // (none) 或空字符串视为「无活跃任务」
  if (!activeTask || activeTask === '(none)') {
    deny(mode, `当前没有活跃 Task（phase: ${phase}）。可能原因：其它会话已释放任务或状态过期。请先运行 node .asa/index.js reconcile 刷新状态摘要，再用 node .asa/index.js set active-task <TASK-ID> 激活任务。`);
    return;
  }

  allow(mode);
}

function allow(mode, msg) {
  if (mode === 'gemini') {
    const res = { decision: 'allow' };
    // 始终带标记，让用户区分「hook 放行」与「hook 未运行/报错」
    if (msg) res.systemMessage = `[ASA 放行] ${msg}`;
    console.log(JSON.stringify(res));
  } else if (msg) console.log(`[ASA 放行] ${msg}`);
  process.exit(0);
}

function deny(mode, reason) {
  const marked = `[ASA 拦截] ${reason}`;
  if (mode === 'gemini') {
    // 拦截信息必须明确输出，避免与 hook 报错混淆
    console.log(JSON.stringify({ decision: 'deny', reason: marked, systemMessage: marked }));
    process.exit(0);
  } else {
    console.error(marked);
    process.exit(2);
  }
}

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
if (process.argv[2] && !process.argv[2].includes('--')) {
  checkAndExit(process.argv[1] || '', 'claude');
} else {
  let data = '';
  process.stdin.on('data', chunk => { data += chunk; });
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(data);
      const filePath = payload?.arguments?.file_path
        || payload?.arguments?.path
        || payload?.toolInput?.file_path
        || payload?.file_path
        || '';
      checkAndExit(filePath, 'gemini');
    } catch (e) {
      console.log(JSON.stringify({ decision: 'allow' }));
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
  if (!fs.existsSync(matrixPath)) {
    allow(mode);
    return;
  }

  const content = fs.readFileSync(matrixPath, 'utf-8');
  const activeTask = content.match(/activeTask:\s*"?([^"\n\s]+)"?/)?.[1];
  const phase = content.match(/phase:\s*"?([^"\n\s]+)"?/)?.[1];

  if (target && target.includes('.asa/')) { allow(mode); return; }
  if (['discovery', 'architecture', 'task-breakdown'].includes(phase)) { allow(mode); return; }

  if (!activeTask) {
    deny(mode, `ASA 拦截：当前没有活跃 Task（phase: ${phase}）。可能原因：其它会话已释放任务或状态过期。请立即运行 node .asa/index.js reconcile 刷新状态摘要，然后通过 "激活任务 TSK-XXX" 启动新任务。`);
    return;
  }

  allow(mode);
}

function allow(mode) {
  if (mode === 'gemini') console.log(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}

function deny(mode, reason) {
  if (mode === 'gemini') {
    console.log(JSON.stringify({ decision: 'deny', reason }));
    process.exit(0);
  } else {
    console.error(`[ASA] 拦截: ${reason}`);
    process.exit(2);
  }
}

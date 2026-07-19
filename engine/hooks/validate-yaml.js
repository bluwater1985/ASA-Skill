#!/usr/bin/env node
// .asa/hooks/validate-yaml.js — ASA YAML 合法性校验器
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
  return path.resolve(process.cwd());
}

const SCRIPT_DIR = path.dirname(process.argv[1] || '.');
const PROJECT_ROOT = findProjectRoot(SCRIPT_DIR);

// ── 入口分流 ──
if (process.argv[2] && !process.argv[2].includes('--')) {
  validateAndExit(process.argv[1] || '', 'claude');
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
      validateAndExit(filePath, 'gemini');
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

function validateAndExit(target, mode) {
  if (!target || !target.includes('.asa/') || (!target.endsWith('.yaml') && !target.endsWith('.yml'))) {
    allow(mode);
    return;
  }

  const fullPath = path.join(PROJECT_ROOT, target);
  if (!fs.existsSync(fullPath)) { allow(mode); return; }

  const text = fs.readFileSync(fullPath, 'utf-8');
  const lines = text.split('\n').filter(l => {
    const s = l.trim();
    return s !== '' && !s.startsWith('#') && !s.startsWith('---');
  });

  if (lines.length === 0 || !lines.some(l => l.includes(':'))) {
    deny(mode, `YAML 格式错误: ${target} — 没有找到有效的 key: value 结构`);
    return;
  }

  allow(mode, `✅ YAML 通过: ${target}`);
}

function allow(mode, msg) {
  if (mode === 'gemini') {
    const res = { decision: 'allow' };
    if (msg) res.systemMessage = msg;
    console.log(JSON.stringify(res));
  } else if (msg) console.log(`[ASA] ${msg}`);
  process.exit(0);
}

function deny(mode, reason) {
  if (mode === 'gemini') {
    console.log(JSON.stringify({ decision: 'deny', reason }));
    process.exit(0);
  } else {
    console.error(`[ASA] ❌ ${reason}`);
    process.exit(2);
  }
}

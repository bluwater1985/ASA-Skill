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
// 复用引擎真实 YAML 解析器（.asa/lib/yaml.js），而非浅层正则
let parseAsaYaml = null;
try { ({ parseAsaYaml } = require('../lib/yaml.js')); } catch (e) { parseAsaYaml = null; }

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
// argv[2] 是真实文件路径 → Claude argv 模式
// argv[2] 为空/flag/未展开的 $FILE_PATH 字面量 → stdin JSON 模式（Claude Code 官方协议）
if (process.argv[2] && !process.argv[2].startsWith('-') && !process.argv[2].startsWith('$')) {
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

  // 兼容绝对路径与相对路径：绝对路径直接使用，相对路径锚定到项目根
  const fullPath = path.isAbsolute(target) ? target : path.join(PROJECT_ROOT, target);
  if (!fs.existsSync(fullPath)) { allow(mode); return; }

  const text = fs.readFileSync(fullPath, 'utf-8');

  // 优先用真实解析器校验（能捕获 Tab 缩进、坏缩进等结构错误）
  if (parseAsaYaml) {
    try {
      parseAsaYaml(text);
      allow(mode, `✅ YAML 通过: ${target}`);
    } catch (e) {
      deny(mode, `YAML 格式错误: ${target} — ${e.message}`);
    }
    return;
  }

  // 降级：无解析器时的浅层检查
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

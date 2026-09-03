// engine/lib/io.js — 全局输出降噪开关（--quiet / --json），零外部依赖
//
// 设计原则：
//   - **opt-in**：默认（无任何 flag）输出与旧版逐字节一致，不影响既有测试与脚本。
//   - `--quiet`（或 -q）：抑制 info/infoLine 这类"信息/装饰"行，只保留最终结果与错误，用于省 token。
//   - `--json`：让汇总类命令（list / plan / overview / journal / diagnose / doctor / search / history / validate）
//     直接输出一行紧凑 JSON，供 DSH / 脚本机器可读，避免把人读的排版文本灌进上下文。
//   - 引擎顶层在 index.js 用 `configure(process.argv)` 一次性开启。

const OPTS = { quiet: false, json: false };

function hasFlag(argv, names) {
  return (argv || []).some(a => names.includes(a));
}

// 从 process.argv 探测全局开关
function configure(argv) {
  OPTS.quiet = hasFlag(argv, ['--quiet', '-q']);
  OPTS.json = hasFlag(argv, ['--json']);
  return OPTS;
}

function isQuiet() { return OPTS.quiet; }
function isJson() { return OPTS.json; }

// info：信息 / 装饰 / 进度行 → quiet 时抑制（省 token 的主体）
function info(...a) { if (!OPTS.quiet) console.log(...a); }

// line：最终结论 / 结果行 → 始终输出（已足够精简，属于必须给 AI 的核心结论）
function line(...a) { console.log(...a); }

// err：错误 → 始终输出到 stderr
function err(...a) { console.error(...a); }

/**
 * jsonOut：结构化输出。
 *  - json 模式：打印一行紧凑 JSON，返回 true（调用方不应再打印排版文本）；
 *  - 否则：返回 false，调用方继续按原排版打印。
 */
function jsonOut(obj) {
  if (OPTS.json) {
    console.log(JSON.stringify(obj));
    return true;
  }
  return false;
}

module.exports = { configure, isQuiet, isJson, info, line, err, jsonOut };

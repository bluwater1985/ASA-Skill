#!/usr/bin/env node
// .asa/hooks/session-start.js — ASA SessionStart 纯只读会话启动诊断器
// 跨平台、无外部依赖，不加锁、不写盘，对所有数据/docs mtime 100% 保持不变

const fs = require('fs');
const path = require('path');

// 统一复用已建立的真实 YAML 解析器
let parseAsaYaml = null;
try {
  ({ parseAsaYaml } = require('../lib/yaml.js'));
} catch (e) {
  try {
    ({ parseAsaYaml } = require('../../lib/yaml.js'));
  } catch (err) {}
}

function findProjectRoot(startDir) {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, '.asa/matrix.yaml'))) return path.resolve(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd());
}

const SCRIPT_DIR = path.dirname(process.argv[1] || '.');

function run() {
  // 1. 优先读取 stdin 传递的 cwd 以定位项目
  let data = '';
  let finished = false;

  process.stdin.on('data', chunk => { data += chunk; });
  process.stdin.on('end', () => {
    if (finished) return;
    finished = true;
    let stdinCwd = '';
    try {
      if (data.trim()) {
        const payload = JSON.parse(data);
        stdinCwd = payload.cwd || payload.arguments?.cwd || '';
      }
    } catch (e) {}

    const projectRoot = findProjectRoot(stdinCwd || SCRIPT_DIR);
    executeDiagnostics(projectRoot);
  });

  // 超时 1000ms 兜底时，若 !finished，设置 finished = true，调用 process.stdin.destroy() 并执行诊断 (N3 修复)
  setTimeout(() => {
    if (!finished) {
      finished = true;
      try {
        process.stdin.destroy();
      } catch (e) {}
      const projectRoot = findProjectRoot(SCRIPT_DIR);
      executeDiagnostics(projectRoot);
    }
  }, 1000);
}

function executeDiagnostics(projectRoot) {
  const matrixPath = path.join(projectRoot, '.asa/matrix.yaml');

  if (!fs.existsSync(matrixPath)) {
    // 找不到项目根目录，静默放行，绝对不输出任何提示
    process.exit(0);
  }

  let matrix = null; // 作用域提升：将 executeDiagnostics 内 of matrix 变量声明由块级（const）提升为函数级首部的 let matrix = null;

  try {
    const text = fs.readFileSync(matrixPath, 'utf-8');

    // 2. 结构化加载并解析 YAML
    let awaitingCount = 0;
    let phase = 'discovery';
    let activeTask = '(none)';

    if (parseAsaYaml) {
      try {
        matrix = parseAsaYaml(text);
        phase = matrix.meta?.phase || 'discovery';
        activeTask = matrix.meta?.activeTask || '(none)';
        if (matrix.tasks) {
          for (const task of Object.values(matrix.tasks)) {
            if (task.status === 'awaiting-confirmation') {
              awaitingCount++;
            }
          }
        }
      } catch (yamlErr) {
        // 解析失败降级
        awaitingCount = 0;
      }
    }

    console.log(`[ASA STATUS] Phase: ${phase} | ActiveTask: ${activeTask} | AwaitingConfirmation: ${awaitingCount}`);

    // 3. 引用底层计算并显式传入 projectRoot 参数
    let calculateNodesDigest = null;
    let calculateDocsDigest = null;
    try {
      ({ calculateNodesDigest, calculateDocsDigest } = require('../lib/matrix.js'));
    } catch (e) {
      try {
        ({ calculateNodesDigest, calculateDocsDigest } = require('../../lib/matrix.js'));
      } catch (err) {}
    }

    if (calculateNodesDigest && calculateDocsDigest) {
      const currentNodesDigest = calculateNodesDigest(projectRoot);
      const docsExpectedDigest = matrix?.meta?.compiledDocsExpectedDigest || matrix?.meta?.docsExpectedDigest || 'sha256:empty';
      const docsActualDigest = calculateDocsDigest(projectRoot);

      // 1. 01/03 编译摘要比对
      if (docsExpectedDigest !== docsActualDigest) {
        console.log(`[ASA STATUS] ⚠️ 编译文档已发生篡改或过期，请运行 compile 重新对账。`);
      }

      // 2. 00/02 叙事概览/设计锚点比对
      let narrativeExpired = false;
      const checkDocBasedOn = (filename) => {
        const p = path.join(projectRoot, 'docs', filename);
        if (fs.existsSync(p)) {
          const content = fs.readFileSync(p, 'utf8');
          const match = content.match(/<!-- ASA-BASED-ON: (.*?) -->/);
          if (match) {
            if (match[1] !== currentNodesDigest) {
              narrativeExpired = true;
            }
          } else {
            narrativeExpired = true;
          }
        }
      };
      checkDocBasedOn('00-overview.md');
      checkDocBasedOn('02-architecture.md');

      if (narrativeExpired) {
        console.log(`[ASA STATUS] ⚠️ 叙事概览/架构设计（00/02）已过期，请运行 update-overview 重新生成并交由模型更新。`);
      }
    }
  } catch (e) {
    // 捕获可能抛出的 ReferenceError，防止默默崩溃
  }

  process.exit(0);
}

run();

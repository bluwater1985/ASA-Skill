#!/usr/bin/env node
// asa-init.js — ASA v3 初始化脚本（跨平台，兼容 Windows/Mac/Linux）
// 用法: node asa-init.js [tier1|tier2|tier3] [project-name]
//
// 重跑安全：
//   - 项目数据文件（matrix.yaml, GEMINI.md, nodes/）→ 不覆盖
//   - 引擎文件（index.js, hooks/）→ 更新
//   - 配置文件（settings.json, pre-commit）→ 更新

const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const forceFlag = args.includes('--force');
const tier = args.find(a => /^tier[123]$/.test(a)) || 'tier2';
const projectName = args.find(a => a.startsWith('--name='))?.split('=')[1] || path.basename(process.cwd());
const tierNum = { tier1: 1, tier2: 2, tier3: 3 }[tier] || 2;
const homeAsa = path.join(os.homedir(), '.asa');

// 检测是否重跑
const isReInit = fs.existsSync('.asa/matrix.yaml');
if (isReInit) {
  console.log(`🔄 检测到项目已初始化，正在更新引擎文件（项目数据不受影响）...\n`);
} else {
  console.log(`🚀 ASA v3 ${tier} 初始化\n`);
}

// 创建目录结构
['.asa/nodes/requirements', '.asa/nodes/architecture', '.asa/nodes/tasks', '.asa/hooks'].forEach(d =>
  fs.mkdirSync(d, { recursive: true })
);

// ── 项目数据文件（不覆盖） ──
let dataSkipped = 0;

// 1. matrix.yaml
const matrixPath = '.asa/matrix.yaml';
if (!fs.existsSync(matrixPath)) {
  const matrixYaml = `meta:
  project: "${projectName}"
  phase: "discovery"
  docsExpectedDigest: "sha256:empty"
  docsActualDigest: "sha256:empty"
risks: []
requirements: {}
architecture: {}
tasks: {}
edges: []
`;
  fs.writeFileSync(matrixPath, matrixYaml);
  console.log('✅ matrix.yaml（新建）');
} else {
  dataSkipped++;
}

// 2. GEMINI.md（默认跳过，--force 时备份后重新生成）
const geminiMd = 'GEMINI.md';
const templateFile = path.join(homeAsa, 'templates', `gemini-tier${tierNum}.md`);
if (fs.existsSync(templateFile)) {
  if (!fs.existsSync(geminiMd)) {
    fs.copyFileSync(templateFile, geminiMd);
    console.log('✅ GEMINI.md（新建）');
  } else if (forceFlag) {
    // --force 模式：备份旧文件后重新生成
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    const backup = `${geminiMd}.bak.${ts}`;
    fs.copyFileSync(geminiMd, backup);
    fs.copyFileSync(templateFile, geminiMd);
    console.log(`✅ GEMINI.md（已备份旧文件至 ${backup}，重新生成）`);
  } else {
    console.log(`ℹ️  GEMINI.md 已存在，跳过（使用 --force 可重新生成，旧文件会自动备份）`);
    dataSkipped++;
  }
}

// ── 引擎文件（始终更新） ──
let engineUpdated = 0;

// 3. index.js
const engineSrc = path.join(homeAsa, 'index.js');
if (fs.existsSync(engineSrc)) {
  fs.copyFileSync(engineSrc, '.asa/index.js');
  engineUpdated++;
}

// 4. commands/
['commands', 'lib'].forEach(dir => {
  const srcDir = path.join(homeAsa, dir);
  const destDir = path.join('.asa', dir);
  if (fs.existsSync(srcDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    for (const f of fs.readdirSync(srcDir).filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))) {
      fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
    }
    engineUpdated++;
  }
});

// 5. Hook 脚本
const hookDir = path.join(homeAsa, 'hooks');
if (fs.existsSync(hookDir)) {
  for (const f of fs.readdirSync(hookDir).filter(f => f.endsWith('.js'))) {
    fs.copyFileSync(path.join(hookDir, f), path.join('.asa/hooks/', f));
  }
  engineUpdated++;
}

// ── 配置文件（精准覆盖：按 name 更新，不重复追加） ──
if (tier !== 'tier1') {
  const ASA_HOOKS = {
    'asa-check-work-order': {
      matcher: 'write_file|replace|edit_file|patch_file|apply_diff|move_file',
      group: 'BeforeTool',
      def: {
        name: 'asa-check-work-order', type: 'command',
        command: 'node ' + path.resolve(process.cwd(), '.asa/hooks/check-work-order.js'),
        timeout: 5000, description: 'ASA: 无活跃 Task 时阻止修改'
      }
    },
    'asa-validate-yaml': {
      matcher: 'write_file|replace|edit_file|patch_file|apply_diff|move_file',
      group: 'AfterTool',
      def: {
        name: 'asa-validate-yaml', type: 'command',
        command: 'node ' + path.resolve(process.cwd(), '.asa/hooks/validate-yaml.js'),
        timeout: 5000, description: 'ASA: 写入后校验 YAML'
      }
    }
  };

  fs.mkdirSync('.gemini', { recursive: true });

  // 读取现有配置，或创建空壳
  let settings = { hooks: { BeforeTool: [], AfterTool: [] } };
  const settingsPath = '.gemini/settings.json';
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (!settings.hooks) settings.hooks = { BeforeTool: [], AfterTool: [] };
    } catch { /* 解析失败用默认空壳 */ }
  }

  // 对每个 ASA Hook：按 name 查找更新，不存在则追加
  for (const [, cfg] of Object.entries(ASA_HOOKS)) {
    const group = settings.hooks[cfg.group] || [];
    const existing = group.find(g => g.hooks?.some(h => h.name === cfg.def.name));
    if (existing) {
      // 更新已有 Hook 的 command 路径
      const hook = existing.hooks.find(h => h.name === cfg.def.name);
      if (hook) hook.command = cfg.def.command;
    } else {
      // 新增 matcher 组 + Hook
      group.push({ matcher: cfg.matcher, hooks: [cfg.def] });
    }
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  // pre-commit
  fs.mkdirSync('.husky', { recursive: true });
  fs.writeFileSync('.husky/pre-commit', 'node .asa/index.js validate || exit 1\n');
  try { fs.chmodSync('.husky/pre-commit', '755'); } catch {}
}

// ── 总结 ──
if (isReInit) {
  const updated = engineUpdated + 2; // +2 for settings.json and pre-commit
  console.log(`\n🔄 重跑完成：${dataSkipped} 个数据文件已保留，${updated} 个引擎/配置文件已更新`);
  console.log('   项目中的需求、任务、架构数据不受影响');
} else {
  console.log('\n✅ ASA ' + tier + ' 初始化完成');
  console.log('\n💡 开始聊需求：我的项目是...');
}

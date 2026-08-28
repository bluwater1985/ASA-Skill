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

// GEMINI.md 契约合并模块（来自引擎库 engine/lib/contract-merge.js）
// 缺失（旧版全局引擎）时降级为保守跳过，提示重跑 install.js。
let mergeMod = null;
try { mergeMod = require(path.join(homeAsa, 'lib', 'contract-merge.js')); } catch (e) { mergeMod = null; }

// 生成带秒级时间戳的备份路径（避免同日覆盖）
function backupPath(file) {
  const now = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad2(now.getMonth()+1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return `${file}.bak.${ts}`;
}

// 合并 GEMINI.md/CLAUDE.md（平台无关）。
// 返回：
//   'skip'              → 契约一致，无需更新
//   'error'             → 无法定位标准契约段 / 合并模块缺失，调用方应保守保留原文件
//   { backup, text }    → 已做备份，text 为合并后的完整内容
function mergeContractFile(mdPath, templateText) {
  if (!mergeMod) return 'error';
  const tb = mergeMod.extractContractBlock(templateText);
  if (!tb) return 'error';
  const existingText = fs.readFileSync(geminiMdPath, 'utf-8');
  if (mergeMod.contractUnchanged(existingText, tb.block)) return 'skip';
  const merged = mergeMod.mergeContract(existingText, tb.block);
  if (merged === null) return 'error';
  const backup = backupPath(geminiMdPath);
  fs.copyFileSync(geminiMdPath, backup);
  return { backup, text: merged };
}

// 检测是否重跑
const isReInit = fs.existsSync('.asa/matrix.yaml');
if (isReInit) {
  console.log(`🔄 检测到项目已初始化，正在更新引擎文件（项目数据不受影响）...\n`);
} else {
  console.log(`🚀 ASA v3 ${tier} 初始化\n`);
}

// 创建目录结构（knowledge/ 供 tier3 知识管理使用）
['.asa/nodes/requirements', '.asa/nodes/architecture', '.asa/nodes/tasks', '.asa/nodes/issues', '.asa/hooks', '.asa/knowledge', '.asa/rules'].forEach(d =>
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
  schemaVersion: 4
  engineVersion: "3.x"
  compiledDocsExpectedDigest: "sha256:empty"
  compiledDocsActualDigest: "sha256:empty"
risks: []
requirements: {}
architecture: {}
tasks: {}
issues: {}
edges: []
`;
  fs.writeFileSync(matrixPath, matrixYaml);
  console.log('✅ matrix.yaml（新建）');
} else {
  dataSkipped++;
}

// 2. GEMINI.md
// 默认：契约一致 → 跳过；契约升级 → 先备份 + 段落级合并（保留项目自定义规约）
// --force：整文件重建（同样先备份）
const geminiMd = 'GEMINI.md';
const templateFile = path.join(homeAsa, 'templates', `gemini-tier${tierNum}.md`);
if (fs.existsSync(templateFile)) {
  const templateText = fs.readFileSync(templateFile, 'utf-8');
  if (!fs.existsSync(geminiMd)) {
    fs.writeFileSync(geminiMd, templateText);
    console.log('✅ GEMINI.md（新建）');
  } else if (forceFlag) {
    const backup = backupPath(geminiMd);
    fs.copyFileSync(geminiMd, backup);
    fs.writeFileSync(geminiMd, templateText);
    console.log(`✅ GEMINI.md（已备份旧文件至 ${backup}，整文件重新生成）`);
  } else {
    const merged = mergeContractFile(geminiMd, templateText);
    if (merged === 'skip') {
      console.log('ℹ️  GEMINI.md 契约一致，跳过（默认保留项目自定义内容）');
      dataSkipped++;
    } else if (merged === 'error') {
      console.log('ℹ️  GEMINI.md 无法自动合并，已保留原文件（可用 --force 整文件重建，旧文件自动备份；若为引擎库缺失请重跑 node install.js）');
      dataSkipped++;
    } else {
      fs.writeFileSync(geminiMd, merged.text);
      console.log(`✅ GEMINI.md 契约已随模板升级（已备份旧文件至 ${merged.backup}，项目自定义内容已保留）`);
    }
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

// 3.5 version.js
const versionSrc = path.join(homeAsa, 'version.js');
if (fs.existsSync(versionSrc)) {
  fs.copyFileSync(versionSrc, '.asa/version.js');
  engineUpdated++;
}

// 4. commands/
['commands', 'lib'].forEach(dir => {
  const srcDir = path.join(homeAsa, dir);
  const destDir = path.join('.asa', dir);
  if (fs.existsSync(srcDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    for (const f of fs.readdirSync(srcDir).filter(f => f.endsWith('.js') && !f.endsWith('.test.js') && !f.endsWith('helpers.js'))) {
      fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
    }
    engineUpdated++;
  } else if (fs.existsSync(path.join(homeAsa, 'index.js'))) {
    // 引擎存在但缺 commands/lib → 旧版引擎，提示重跑 install
    console.warn(`⚠️  ~/.asa/${dir}/ 缺失：当前是旧版引擎。请重新运行 node install.js 更新全局引擎。`);
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

// 5.5 增量方法库规则（to-spec / to-tickets，始终更新）
const rulesDir = path.join(homeAsa, 'rules');
if (fs.existsSync(rulesDir)) {
  fs.mkdirSync('.asa/rules', { recursive: true });
  for (const f of fs.readdirSync(rulesDir).filter(f => f.endsWith('.md'))) {
    fs.copyFileSync(path.join(rulesDir, f), path.join('.asa/rules', f));
  }
  engineUpdated++;
} else {
  console.warn(`⚠️  ~/.asa/rules/ 缺失：增量方法库（to-spec/to-tickets）未复制。请重跑 node install.js 更新全局引擎。`);
}

// ── 配置文件（精准覆盖：按 name 更新，不重复追加） ──
if (tier !== 'tier1') {
  const ASA_HOOKS = {
    'asa-check-work-order': {
      matcher: 'write_file|replace|edit_file|patch_file|apply_diff|move_file',
      group: 'BeforeTool',
      def: {
        name: 'asa-check-work-order', type: 'command',
        command: 'node "' + path.resolve(process.cwd(), '.asa/hooks/check-work-order.js') + '"',
        timeout: 15000, description: 'ASA: 无活跃 Task 时阻止修改'
      }
    },
    'asa-validate-yaml': {
      matcher: 'write_file|replace|edit_file|patch_file|apply_diff|move_file',
      group: 'AfterTool',
      def: {
        name: 'asa-validate-yaml', type: 'command',
        command: 'node "' + path.resolve(process.cwd(), '.asa/hooks/validate-yaml.js') + '"',
        timeout: 15000, description: 'ASA: 写入后校验 YAML'
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
    // 先落位 group 数组，避免缺键时 push 到游离数组导致 hook 丢弃
    if (!settings.hooks[cfg.group]) settings.hooks[cfg.group] = [];
    const group = settings.hooks[cfg.group];
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
  // settings.json + pre-commit 仅在 tier2/3 写入
  const updated = engineUpdated + (tier !== 'tier1' ? 2 : 0);
  console.log(`\n🔄 重跑完成：${dataSkipped} 个数据文件已保留，${updated} 个引擎/配置文件已更新`);
  console.log('   项目中的需求、任务、架构数据不受影响');
} else {
  console.log('\n✅ ASA ' + tier + ' 初始化完成');
  console.log('\n💡 开始聊需求：我的项目是...');
}

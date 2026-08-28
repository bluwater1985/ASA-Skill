#!/usr/bin/env node
// install.js — ASA 跨平台安装脚本
// 用法: node install.js [claude|gemini|dsh]
// 不指定参数则询问

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const homedir = os.homedir();
const isWindows = process.platform === 'win32';

// 检测可用的 AI 客户端
const NULL_DEV = isWindows ? 'nul' : '/dev/null';
const hasClaude = (() => {
  try { return !!process.env.CLAUDE_PROJECT_DIR || execSync(`which claude 2>${NULL_DEV} || where claude 2>${NULL_DEV}`, { stdio: 'ignore' }) && true; } catch { return false; }
})();
const hasGemini = (() => {
  try { return execSync(`which gemini 2>${NULL_DEV} || where gemini 2>${NULL_DEV}`, { stdio: 'ignore' }) && true; } catch { return false; }
})();
// DSH（DeepSeek Harness）：通过技能目录 ~/.dsh/skills 探测（存在即视为已安装）
const hasDsh = fs.existsSync(path.join(homedir, '.dsh'));

let client = args[0];
if (!client) {
  const present = [];
  if (hasClaude) present.push('claude');
  if (hasGemini) present.push('gemini');
  if (hasDsh) present.push('dsh');
  if (present.length >= 2) {
    console.log(`检测到多个目标: ${present.join(' / ')}，请指定: ${present.map(c => `node install.js ${c}`).join(' 或 ')}`);
    process.exit(1);
  } else if (present.length === 1) {
    client = present[0];
  } else {
    console.log('未检测到 AI 客户端，默认安装 Gemini CLI 版');
    client = 'gemini';
  }
}

if (!['claude', 'gemini', 'dsh'].includes(client)) {
  console.error('参数错误: 请指定 claude、gemini 或 dsh');
  process.exit(1);
}

const clientLabel = { claude: 'Claude Code', gemini: 'Gemini CLI', dsh: 'DeepSeek Harness (DSH)' }[client];
console.log(`🚀 安装 ASA — ${clientLabel} 版\n`);

const srcDir = __dirname;
const errors = [];

// 1. 复制引擎到 ~/.asa（递归复制 engine/ 全部内容）
const engineDest = path.join(homedir, '.asa');
fs.mkdirSync(path.join(engineDest, 'commands'), { recursive: true });
fs.mkdirSync(path.join(engineDest, 'lib'), { recursive: true });
fs.mkdirSync(path.join(engineDest, 'hooks'), { recursive: true });
fs.mkdirSync(path.join(engineDest, 'templates'), { recursive: true });
fs.mkdirSync(path.join(engineDest, 'skeleton'), { recursive: true });

// 复制 index.js
copyIfExists('engine/index.js', engineDest, 'index.js');
// 复制 version.js
copyIfExists('engine/version.js', engineDest, 'version.js');
// 复制 commands/（跳过测试文件与测试辅助）
for (const f of readDirIfExists('engine/commands') || []) {
  if (isTestFile(f)) continue;
  copyIfExists(`engine/commands/${f}`, path.join(engineDest, 'commands'), f);
}
// 复制 lib/
for (const f of readDirIfExists('engine/lib') || []) {
  if (isTestFile(f)) continue;
  copyIfExists(`engine/lib/${f}`, path.join(engineDest, 'lib'), f);
}
// 复制 hooks/
for (const f of readDirIfExists('engine/hooks') || []) {
  if (isTestFile(f)) continue;
  copyIfExists(`engine/hooks/${f}`, path.join(engineDest, 'hooks'), f);
}

function isTestFile(name) {
  return name.endsWith('.test.js') || name === 'helpers.js';
}

function copyIfExists(srcRel, destDir, destName) {
  const srcFull = path.join(srcDir, srcRel);
  if (!fs.existsSync(srcFull)) return;
  try { fs.copyFileSync(srcFull, path.join(destDir, destName)); }
  catch (e) { errors.push(`${srcRel}: ${e.message}`); }
}

function readDirIfExists(dirRel) {
  const full = path.join(srcDir, dirRel);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full);
}
console.log(`✅ 引擎 → ${engineDest}`);

// 2. 复制模板
for (const f of fs.readdirSync(path.join(srcDir, 'templates'))) {
  try { fs.copyFileSync(path.join(srcDir, 'templates', f), path.join(engineDest, 'templates', f)); }
  catch (e) { errors.push(`templates/${f}: ${e.message}`); }
}
console.log(`✅ 模板 → ${engineDest}/templates/`);

// 3. 复制 skeleton
for (const f of fs.readdirSync(path.join(srcDir, 'skeleton'))) {
  try { fs.copyFileSync(path.join(srcDir, 'skeleton', f), path.join(engineDest, 'skeleton', f)); }
  catch (e) { errors.push(`skeleton/${f}: ${e.message}`); }
}
console.log(`✅ 骨架 → ${engineDest}/skeleton/`);

// 3.5 复制增量方法库规则（to-spec / to-tickets，按需加载）
const rulesSrc = path.join(srcDir, 'rules');
if (fs.existsSync(rulesSrc)) {
  const rulesDest = path.join(engineDest, 'rules');
  fs.mkdirSync(rulesDest, { recursive: true });
  for (const f of fs.readdirSync(rulesSrc).filter(f => f.endsWith('.md'))) {
    try { fs.copyFileSync(path.join(rulesSrc, f), path.join(rulesDest, f)); }
    catch (e) { errors.push(`rules/${f}: ${e.message}`); }
  }
  console.log(`✅ 增量方法库 → ${engineDest}/rules/`);
}

// 4. 复制 Skill 定义
if (client === 'claude') {
  const skillDest = path.join(homedir, '.claude', 'skills', 'asa');
  const scriptDest = path.join(skillDest, 'scripts');
  fs.mkdirSync(scriptDest, { recursive: true });
  try {
    fs.copyFileSync(path.join(srcDir, 'clients', 'claude', '.claude', 'skills', 'asa', 'SKILL.md'),
                    path.join(skillDest, 'SKILL.md'));
    fs.copyFileSync(path.join(srcDir, 'clients', 'claude', '.claude', 'skills', 'asa', 'scripts', 'asa-init.js'),
                    path.join(scriptDest, 'asa-init.js'));
    console.log(`✅ Skill → ${skillDest}`);
    console.log(`✅ 初始化脚本 → ${scriptDest}/`);
  } catch (e) { errors.push(`SKILL.md or asa-init.js: ${e.message}`); }

  // 🚀 物理去中心化自洁：清理可能残留于全局的 settings.local.json 旧 hooks，全面转移至项目级 `.asa init` 高契约配置 🚀
  const settingsPath = path.join(homedir, '.claude', 'settings.local.json');
  if (fs.existsSync(settingsPath)) {
    try {
      let settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (settings.hooks) {
        if (Array.isArray(settings.hooks.SessionStart)) {
          settings.hooks.SessionStart = settings.hooks.SessionStart.filter(h => h.name !== 'asa-session-start');
        }
        if (Array.isArray(settings.hooks.PreToolUse)) {
          settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(h => h.name !== 'asa-check-work-order');
        }
        if (Array.isArray(settings.hooks.PostToolUse)) {
          settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(h => h.name !== 'asa-validate-yaml');
        }
      }
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      console.log(`🧹 已自适应清理可能残留于全局的 Claude Hooks (已全面解耦转入项目级配置) → ${settingsPath}`);
    } catch (e) {}
  }
} else if (client === 'dsh') {
  const skillDest = path.join(homedir, '.dsh', 'skills', 'asa');
  const scriptDest = path.join(skillDest, 'scripts');
  fs.mkdirSync(scriptDest, { recursive: true });
  try {
    fs.copyFileSync(path.join(srcDir, 'clients', 'dsh', '.dsh', 'skills', 'asa', 'SKILL.md'),
                    path.join(skillDest, 'SKILL.md'));
    fs.copyFileSync(path.join(srcDir, 'clients', 'dsh', '.dsh', 'skills', 'asa', 'scripts', 'asa-init.js'),
                    path.join(scriptDest, 'asa-init.js'));
    console.log(`✅ Skill → ${skillDest}`);
    console.log(`✅ 初始化脚本 → ${scriptDest}/`);
  } catch (e) { errors.push(`dsh skill: ${e.message}`); }
  // DSH 通过扫描 ~/.dsh/skills 自动发现技能到目录（无需 settings 注册）
} else {
  const skillDest = path.join(homedir, '.gemini', 'skills', 'asa');
  const scriptDest = path.join(skillDest, 'scripts');
  fs.mkdirSync(scriptDest, { recursive: true });
  try {
    fs.copyFileSync(path.join(srcDir, 'clients', 'gemini', '.gemini', 'skills', 'asa', 'SKILL.md'),
                    path.join(skillDest, 'SKILL.md'));
    fs.copyFileSync(path.join(srcDir, 'clients', 'gemini', '.gemini', 'skills', 'asa', 'scripts', 'asa-init.js'),
                    path.join(scriptDest, 'asa-init.js'));
    console.log(`✅ Skill → ${skillDest}`);
    console.log(`✅ 初始化脚本 → ${scriptDest}/`);
  } catch (e) { errors.push(`gemini skill: ${e.message}`); }

  // 启用实验性 Skill
  const settingsPath = path.join(homedir, '.gemini', 'settings.json');
  try {
    let settings = { experimental: { skills: true } };
    if (fs.existsSync(settingsPath)) {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
    }
    if (!settings.experimental) settings.experimental = {};
    settings.experimental.skills = true;
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log(`✅ 已启用 Skill → ${settingsPath}`);
  } catch (e) { errors.push(`settings.json: ${e.message}`); }
}

// 🚀 自洁发行源：如果项目根目录（srcDir）下由于先前误写残留了 .claude 伪目录，自动物理抹除 (B2/P0 修复)
const rawSourceClaudeDir = path.join(srcDir, '.claude');
if (fs.existsSync(rawSourceClaudeDir)) {
  try {
    fs.rmSync(rawSourceClaudeDir, { recursive: true, force: true });
    console.log(`🧹 已自动清除源码树残留伪配置目录 → ${rawSourceClaudeDir}`);
  } catch (e) {}
}

// ── 总结 ──
if (errors.length) {
  console.log(`\n⚠️  部分文件安装失败:`);
  errors.forEach(e => console.log(`   ${e}`));
} else {
  console.log(`\n✅ ASA ${clientLabel} 版安装完成`);
  console.log('');
  const hints = {
    claude: '  启动 Claude Code 后输入:  /asa init',
    gemini: '  启动 Gemini CLI 后输入:  初始化 ASA',
    dsh: '  在 DeepSeek Harness 中对助手说: 初始化 ASA 或 asa init',
  };
  console.log(hints[client]);
}

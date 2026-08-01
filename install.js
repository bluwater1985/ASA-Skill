#!/usr/bin/env node
// install.js — ASA 跨平台安装脚本
// 用法: node install.js [claude|gemini]
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

let client = args[0];
if (!client) {
  if (hasClaude && hasGemini) {
    console.log('检测到 Claude Code 和 Gemini CLI 均已安装，请指定: node install.js claude 或 node install.js gemini');
    process.exit(1);
  } else if (hasClaude) client = 'claude';
  else if (hasGemini) client = 'gemini';
  else {
    console.log('未检测到 AI 客户端，默认安装 Gemini CLI 版');
    client = 'gemini';
  }
}

if (client !== 'claude' && client !== 'gemini') {
  console.error('参数错误: 请指定 claude 或 gemini');
  process.exit(1);
}

console.log(`🚀 安装 ASA — ${client === 'claude' ? 'Claude Code' : 'Gemini CLI'} 版\n`);

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

// 4. 复制 Skill 定义
if (client === 'claude') {
  const skillDest = path.join(homedir, '.claude', 'skills', 'asa');
  fs.mkdirSync(skillDest, { recursive: true });
  try {
    fs.copyFileSync(path.join(srcDir, 'clients', 'claude', '.claude', 'skills', 'asa', 'SKILL.md'),
                    path.join(skillDest, 'SKILL.md'));
    console.log(`✅ Skill → ${skillDest}`);
  } catch (e) { errors.push(`SKILL.md: ${e.message}`); }
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

// ── 总结 ──
if (errors.length) {
  console.log(`\n⚠️  部分文件安装失败:`);
  errors.forEach(e => console.log(`   ${e}`));
} else {
  console.log(`\n✅ ASA ${client === 'claude' ? 'Claude Code' : 'Gemini CLI'} 版安装完成`);
  console.log('');
  if (client === 'claude') {
    console.log('  启动 Claude Code 后输入:  /asa init');
  } else {
    console.log('  启动 Gemini CLI 后输入:  初始化 ASA');
  }
}

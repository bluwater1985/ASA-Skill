---
name: asa
description: AI Software Architect（ASA）—— 在项目中初始化 ASA 工程管理流程。支持 Tier 1（探索验证）、Tier 2（离线防御）、Tier 3（强契约）三级渐进式启用。用户说"初始化 ASA"时触发，自动搭建 .asa/ 引擎目录、生成 GEMINI.md 项目指令、配置 BeforeTool/AfterTool hooks 和 pre-commit。
---

# ASA — AI Software Architect 初始化

在任意项目中初始化 ASA 工程管理流程。

## 用法

在当前项目目录中，告诉 AI：

> 初始化 ASA
> 或者：初始化 ASA Tier 2

AI 会询问选择哪个 Tier，然后自动搭建。

## 初始化流程

当用户要求初始化 ASA 时，按以下步骤执行：

### Step 1: 确认 Tier

询问用户：

> 你的项目适合哪个级别？
> 1. **Tier 1 探索验证** — 个人 Demo / MVP，不设防御，直接开干
> 2. **Tier 2 离线防御** — 小团队，BeforeTool Hook + pre-commit 兜底
> 3. **Tier 3 强契约** — 多团队，CI 硬校验

### Step 2: 运行初始化脚本

优先使用 `node ~/.gemini/skills/asa/scripts/asa-init.js` 完成初始化。如果脚本不存在，按后续步骤手动搭建。

```bash
# 根据所选 Tier 运行（tier1 / tier2 / tier3）
node ~/.gemini/skills/asa/scripts/asa-init.js tier2

# 加 --force 可重新生成 GEMINI.md（旧文件自动备份）
node ~/.gemini/skills/asa/scripts/asa-init.js tier2 --force
```

初始化脚本会自动完成：
- 创建 `.asa/` 目录结构和引擎文件
- 生成 `matrix.yaml` 和 `GEMINI.md`
- 配置 `.gemini/settings.json`（Hook 命令写为绝对路径）
- 配置 `.husky/pre-commit`

> **重跑安全（幂等性）**：无论执行多少次初始化，项目数据不会丢失：
> - **`matrix.yaml`** → 存在即跳过，不覆盖
> - **`GEMINI.md`** → 默认跳过，如需重新生成可加 `--force`（备份旧文件），或由 AI 执行语义化合并（见下文）
> - **`.gemini/settings.json`** → 按 Hook `name` 精准匹配：已存在则更新 command 路径，不存在则追加。不会重复插入
> - **`index.js` + `hooks/`** → 引擎文件始终更新到最新

### Step 3（备选）：手动搭建

如果初始化脚本不可用，按以下步骤手动搭建：

#### 创建目录结构
```bash
mkdir -p .asa/nodes/requirements .asa/nodes/architecture .asa/nodes/tasks .asa/hooks
```

#### 复制引擎
```bash
cp ~/.asa/index.js .asa/index.js
cp ~/.asa/hooks/check-work-order.js .asa/hooks/
cp ~/.asa/hooks/validate-yaml.js .asa/hooks/
chmod +x .asa/hooks/*.js
```

#### 创建 matrix.yaml
```yaml
# .asa/matrix.yaml
meta:
  project: "<项目名称>"
  phase: "discovery"
  docsExpectedDigest: "sha256:empty"
  docsActualDigest: "sha256:empty"
risks: []
requirements: {}
architecture: {}
tasks: {}
edges: []
```

#### 生成/合并 GEMINI.md
- **文件不存在**：从 `~/.asa/templates/gemini-tier{1,2,3}.md` 读取对应模板创建
- **文件已存在**：AI 使用 `view_file` 读取既有内容，完整剥离并保留用户手写的特定规约，剔除/升级重复陈旧的启动序列段落后重新写入。实现刚性内容更新 + 柔性语义去重

#### 配置 Gemini CLI Hooks（Tier 2/3）
创建 `.gemini/settings.json`，使用**绝对路径**：

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "write_file|replace|edit_file|patch_file|apply_diff|move_file",
        "hooks": [{
          "name": "asa-check-work-order",
          "type": "command",
          "command": "node <项目绝对路径>/.asa/hooks/check-work-order.js",
          "timeout": 5000,
          "description": "ASA：无活跃 Task 时阻止修改"
        }]
      }
    ],
    "AfterTool": [
      {
        "matcher": "write_file|replace|edit_file|patch_file|apply_diff|move_file",
        "hooks": [{
          "name": "asa-validate-yaml",
          "type": "command",
          "command": "node <项目绝对路径>/.asa/hooks/validate-yaml.js",
          "timeout": 5000,
          "description": "ASA：写入后校验 YAML"
        }]
      }
    ]
  }
}
```

#### 配置 pre-commit（Tier 2/3）
```bash
mkdir -p .husky
echo "node .asa/index.js validate || exit 1" > .husky/pre-commit
chmod +x .husky/pre-commit
```

### Step 4: 确认 Skill 已启用

确保 `~/.gemini/settings.json` 中包含：

```json
{
  "experimental": { "skills": true }
}
```

### Step 5: 总结

> ✅ ASA Tier {n} 初始化完成！
>
> 引擎 : .asa/index.js
> 状态 : .asa/matrix.yaml
> 指令 : GEMINI.md
> Hooks : 已配置（绝对路径）
> 提交门禁 : 已配置
>
> 现在可以开始聊需求了。请告诉我你想做什么项目？

## 各 Tier 差异速查

| 内容 | T1 | T2 | T3 |
|------|----|----|----|
| matrix.yaml | ✅ | ✅ | ✅ |
| index.js | ✅ | ✅ | ✅ |
| GEMINI.md | ✅ | ✅ | ✅ |
| Hooks | ❌ | ✅ | ✅ |
| pre-commit | ❌ | ✅ | ✅ |
| CI | ❌ | ❌ | ✅ |

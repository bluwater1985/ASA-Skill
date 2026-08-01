---
name: asa
description: AI Software Architect（ASA）—— 在项目中初始化 ASA 工程管理流程。支持 Tier 1（探索验证）、Tier 2（离线防御）、Tier 3（强契约）三级渐进式启用。用户输入 "/asa init"、"/asa" 或说"初始化 ASA"时触发，自动搭建 .asa/ 引擎目录、生成 GEMINI.md 项目指令、配置 BeforeTool/AfterTool hooks 和 pre-commit。
---

# ASA — AI Software Architect 初始化

在任意项目中初始化 ASA 工程管理流程。

## 用法

支持两种触发方式（与 Claude Code 保持一致）：

### 方式一：斜杠命令（推荐，与 Claude Code 相同）

```
/asa init            ← 初始化（会问选哪个 Tier）
/asa init tier1      ← 直接指定 Tier 1
/asa init tier2      ← 直接指定 Tier 2
/asa init tier3      ← 直接指定 Tier 3
```

### 方式二：自然语言

> 初始化 ASA
> 或者：初始化 ASA Tier 2

AI 会询问选择哪个 Tier，然后自动搭建。

> **版本要求**：斜杠命令 `/asa` 需要 Gemini CLI 支持「技能斜杠激活」的版本（2026 年起已支持）。若你的版本不支持 `/asa`，请用自然语言「初始化 ASA」触发，或升级 Gemini CLI。

## 初始化流程

当用户要求初始化 ASA 时，按以下步骤执行：

### Step 1: 确认 Tier

如果用户**在命令中指定了 Tier**（如 `/asa init tier2` 或「初始化 ASA Tier 2」），**直接使用该 Tier，不再询问**。

否则询问用户：

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

初始化脚本会自动完成（**幂等**：已有文件不覆盖）：
- 创建 `.asa/` 目录结构和引擎文件
- `matrix.yaml` 和 `GEMINI.md` → 存在即跳过，不覆盖已有数据
- 配置 `.gemini/settings.json`（按 name 更新，不重复注册）
- 配置 `.husky/pre-commit`

> **重跑安全**：无论执行多少次初始化：
> - **`nodes/`**（需求、任务、架构）→ 永远不碰，这是不可丢的数据
> - **`matrix.yaml`**（摘要索引）→ 可更新，摘要从 nodes/ 重建（edges/meta 需备份）
> - **`GEMINI.md`**（项目指令）→ 默认语义化合并保留用户规约，`--force` 可备份后重新生成
> - **`.gemini/settings.json`** → 按 Hook `name` 精准更新，不重复注册
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
mkdir -p .asa/commands .asa/lib
cp ~/.asa/commands/*.js .asa/commands/ 2>/dev/null
cp ~/.asa/lib/*.js .asa/lib/ 2>/dev/null
cp ~/.asa/hooks/check-work-order.js .asa/hooks/
cp ~/.asa/hooks/validate-yaml.js .asa/hooks/
chmod +x .asa/hooks/*.js
```

#### 创建/更新 matrix.yaml

> matrix.yaml 是 nodes/ 的摘要索引，数据主体在 nodes/ 中。reconcile 可从 nodes/ 重建 requirements/architecture/tasks 摘要；但 edges 依赖关系与 meta 元数据只存在于 matrix.yaml，损坏后需从备份恢复。

```yaml
# .asa/matrix.yaml
meta:
  project: "<项目名称>"
  phase: "discovery"
  schemaVersion: 2
  docsExpectedDigest: "sha256:empty"
  docsActualDigest: "sha256:empty"
risks: []
requirements: {}
architecture: {}
tasks: {}
edges: []
```

#### 生成/合并 GEMINI.md

**文件不存在时**：从 `~/.asa/templates/gemini-tier{1,2,3}.md` 读取对应模板创建。

**文件已存在时**：执行以下步骤完成语义化合并：

```
Step 1: 用 read_file 读取已存在的 GEMINI.md 全文
Step 2: 用 read_file 读取 ~/.asa/templates/gemini-tier{N}.md 模板全文
Step 3: 对比两份内容，识别差异：
  - 用户手写规约（项目禁忌、开发规范、人工追加的规则）→ 保留
  - ASA 标准启动序列段落 → 用模板最新版本替换
  - 重复或陈旧的内容 → 剔除
Step 4: 将合并后的内容写入 GEMINI.md
```

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
          "command": "node \"<项目绝对路径>/.asa/hooks/check-work-order.js\"",
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
          "command": "node \"<项目绝对路径>/.asa/hooks/validate-yaml.js\"",
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

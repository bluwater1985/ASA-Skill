---
name: asa
description: >-
  AI Software Architect (ASA) — 在任意项目中初始化 ASA 工程管理流程。
  支持 Tier 1（探索验证）、Tier 2（离线防御）、Tier 3（强契约）三级渐进式启用。
  初始化时询问用户选择 Tier，然后自动搭建 .asa/ 引擎目录、
  语义化合并 CLAUDE.md、配置 hooks 和 pre-commit。
  所有操作幂等，多次运行不丢数据、不重复注册 Hook。
metadata:
  origin: custom
---

# ASA — AI Software Architect 初始化技能

在任意项目中初始化 ASA 工程管理流程。

## 用法

```
/asa init            ← 在当前项目中初始化 ASA（会问选哪个 Tier）
/asa init tier1      ← 直接指定 Tier 1
/asa init tier2      ← 直接指定 Tier 2
/asa init tier3      ← 直接指定 Tier 3
```

## 全局模板路径

ASA 的引擎代码和模板文件存储在 `~/.asa/` 目录下：

```
~/.asa/
├── index.js                    # CLI 路由（零依赖）
├── commands/                   # 命令模块
├── lib/                        # 库模块
├── hooks/
│   ├── check-work-order.js     # PreToolUse 状态拦截（双模脚本）
│   └── validate-yaml.js        # PostToolUse YAML 校验（双模脚本）
├── skeleton/
│   └── matrix.yaml             # 空矩阵骨架
└── templates/
    ├── CLAUDE-tier1.md         # Tier 1 CLAUDE.md 模板
    ├── CLAUDE-tier2.md         # Tier 2 CLAUDE.md 模板
    └── CLAUDE-tier3.md         # Tier 3 CLAUDE.md 模板
```

## 初始化流程

当用户调用 `/asa init` 时，按以下步骤执行：

### Step 1: 确认 Tier

如果用户没有指定 Tier，询问：

> 你的项目适合哪个级别？
>
> 1. **Tier 1 探索验证** — 个人 Demo / MVP，不设防御，ai 直接编码
> 2. **Tier 2 离线防御** — 小团队，有人用 Cursor，pre-commit 兜底
> 3. **Tier 3 强契约** — 多团队长期项目，CI 硬校验

### Step 2: 创建 .asa/ 目录

```bash
mkdir -p .asa/nodes/requirements .asa/nodes/architecture .asa/nodes/tasks .asa/hooks
```

### Step 3: 复制引擎、模块和 Hook 脚本

```bash
# 主入口
cp ~/.asa/index.js .asa/index.js
# 命令模块
mkdir -p .asa/commands
cp ~/.asa/commands/*.js .asa/commands/
# 库模块
mkdir -p .asa/lib
cp ~/.asa/lib/*.js .asa/lib/
# Hook 脚本
cp ~/.asa/hooks/check-work-order.js .asa/hooks/
cp ~/.asa/hooks/validate-yaml.js .asa/hooks/
```

### Step 4: 创建/更新 matrix.yaml

> matrix.yaml 是 nodes/ 的摘要索引，数据主体在 nodes/ 中。清空或损坏后运行 `node .asa/index.js reconcile` 即可从 nodes/ 重建。

```yaml
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

### Step 5: 语义化合并 CLAUDE.md

幂等：如果 `CLAUDE.md` 已存在，**不直接覆盖**，执行语义化合并：

1. 用 `read` 工具读取已存在的 `CLAUDE.md`
2. 识别并保留用户手写的特定规约（项目禁忌、开发规范、人工追加的规则）
3. 剔除/升级重复陈旧的 ASA 启动序列段落
4. 用模板中的最新内容替换标准段落
5. 重新写入

如果 `CLAUDE.md` 不存在，直接从 `~/.asa/templates/CLAUDE-tier{1,2,3}.md` 创建。

如需完全重新生成（放弃旧内容），可让用户确认后手动删除旧文件再运行 `/asa init`。

### Step 6: 配置 hooks（Tier 2/3 需要）

幂等：如果 `.claude/settings.local.json` 已存在，按 Hook `name` 精准更新，不重复插入。

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Write|Edit|Replace|ApplyDiff|MoveFile",
      "command": "node .asa/hooks/check-work-order.js \"$FILE_PATH\"",
      "description": "ASA 状态拦截：无活跃 Task 时阻止文件修改"
    }],
    "PostToolUse": [{
      "matcher": "Write|Edit|Replace|ApplyDiff|MoveFile",
      "command": "node .asa/hooks/validate-yaml.js \"$FILE_PATH\"",
      "description": "ASA YAML 校验：写入后自动校验"
    }]
  }
}
```

更新策略：
- 读取现有 JSON
- 检查 hooks 数组中是否已有 `description` 包含 `"ASA"` 的条目
- 有则更新其 `command` 路径
- 无则追加新条目

### Step 7: 配置 pre-commit（Tier 2/3 需要）

```bash
mkdir -p .husky
echo "node .asa/index.js validate || exit 1" > .husky/pre-commit
chmod +x .husky/pre-commit
```

如果项目还没有安装 husky：
```bash
npx husky init
echo "node .asa/index.js validate" > .husky/pre-commit
```

### Step 8: 总结

> ✅ ASA Tier {n} 初始化完成！
>
> 引擎: .asa/index.js
> 状态: .asa/matrix.yaml（不覆盖）
> 任务节点: .asa/nodes/
> CLAUDE.md: 已生成（不覆盖用户规约）
> Hooks: 已配置（幂等注册）
> Pre-commit: 已配置
>
> 现在可以开始聊需求了。请告诉我你想做什么项目？

## 各 Tier 差异速查

| 步骤 | Tier 1 | Tier 2 | Tier 3 |
|------|--------|--------|--------|
| matrix.yaml | 创建 | 创建 | 创建 |
| index.js | ✅ | ✅ | ✅ |
| hooks | ❌ | ✅ | ✅ |
| pre-commit | ❌ | ✅ | ✅ |
| CLAUDE.md | tier1 模板 | tier2 模板 | tier3 模板 |
| nodes/ | ❌ | ✅ | ✅ |
| knowledge/ | ❌ | ❌ | ✅ |

## 重跑安全

所有操作幂等：无论执行多少次 `/asa init`：
- **`nodes/`**（需求、任务、架构）→ 永远不碰，这是不可丢的数据
- **`matrix.yaml`**（摘要索引）→ 可更新，数据可从 nodes/ 重建（`node .asa/index.js reconcile`）
- **`CLAUDE.md`**（项目指令）→ 语义化合并，保留用户手写规约
- **`settings.local.json`** → 按 name 更新，不重复注册
- **`index.js` + `hooks/`** → 始终更新到最新引擎版本

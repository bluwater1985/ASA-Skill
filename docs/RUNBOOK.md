# 使用与排障手册（RUNBOOK）

面向使用 ASA（AI Software Architect）的工程师。覆盖安装、日常使用、完整工作流、常见问题与恢复。

---

## 1. 安装

### 快速安装（推荐）

```bash
# Claude Code 用户
node install.js claude

# Gemini CLI 用户
node install.js gemini
```

- 要求 Node.js 18+
- 自动部署引擎、模板、Skill 定义
- Gemini 用户自动启用 `experimental.skills`

### 验证安装

```bash
# 全局引擎已就位
ls ~/.asa/index.js

# Claude 用户
claude   # 输入 /asa init

# Gemini 用户
gemini chat   # 说"初始化 ASA"
```

### 升级引擎

```bash
# 拉取最新代码后，重跑安装脚本
node install.js claude   # 或 gemini

# 已初始化的项目：重跑 asa-init.js 会更新引擎，不覆盖项目数据
node ~/.gemini/skills/asa/scripts/asa-init.js tier2
```

---

## 2. 初始化一个项目

### Claude Code

```
/asa init
# 或指定级别
/asa init tier2
```

### Gemini CLI

```
初始化 ASA
# 或
初始化 ASA Tier 2
```

### Tier 说明

| Tier | 定位 | 防御强度 |
|------|------|---------|
| Tier 1 探索验证 | 个人 Demo / MVP | 无 hooks，直接编码 |
| Tier 2 离线防御 | 小团队 | PreToolUse hook + pre-commit |
| Tier 3 强契约 | 多团队长期项目 | 强 CI 校验 + 知识管理 |

初始化幂等：**多次运行不丢数据**。`nodes/`（需求/任务/架构）永不覆盖；`matrix.yaml` 可重建；CLAUDE/GEMINI.md 语义化合并保留手写规约。

---

## 3. 完整工作流

ASA 的核心是「需求 → 架构 → 任务 → 实现 → 验证」的闭环。以下是推荐流程：

```
初始化项目
   │
   ├─ 1. 添加需求
   │      node .asa/index.js add-req "规则检查引擎" --priority P1
   │      node .asa/index.js add-arch "规则引擎架构"
   │      node .asa/index.js add-task "实现原子函数"
   │
   ├─ 2. 建立依赖
   │      node .asa/index.js edge add REQ-001 ARCH-001 --type depends
   │      node .asa/index.js edge add ARCH-001 TASK-001 --type refines
   │
   ├─ 3. 推进状态
   │      node .asa/index.js status REQ-001 approved
   │      node .asa/index.js set phase implementation
   │      node .asa/index.js set active-task TASK-001
   │
   ├─ 4. 实现代码（AI 编码，check-work-order hook 保证"做完一个再下一个"）
   │
   ├─ 5. 事务闭环
   │      node .asa/index.js compile    # 节点 → docs
   │      node .asa/index.js validate   # 健康检查 + CI 门禁（应 exit 0）
   │
   └─ 6. 变更传播（需求变了）
          node .asa/index.js change-req REQ-001     # 备份快照
          # 编辑节点，追加 pendingPropagation
          node .asa/index.js impact REQ-001         # 看影响范围
          node .asa/index.js propagate REQ-001      # 幂等传播
          node .asa/index.js validate               # 再次通过
```

### 启动序列（每轮对话）

Tier 2/3 的 CLAUDE.md / GEMINI.md 强制要求：

```bash
node .asa/index.js reconcile && node .asa/index.js patch
```

- `reconcile`：事务对账 + 状态摘要（`[ASA STATUS]` 行包含阶段与活跃任务）
- `patch`：docs 反向同步

---

## 4. 日常命令速查

| 场景 | 命令 |
|------|------|
| 看状态 | `node .asa/index.js reconcile` |
| 加需求 | `add-req <title> [--priority P1]` |
| 推进状态 | `status <id> <new-status>` |
| 建依赖 | `edge add <from> <to> --type depends` |
| 影响分析 | `impact <id>` |
| 传播变更 | `propagate <id>` |
| 编译文档 | `compile` |
| CI 门禁 | `validate` |
| 变更历史 | `journal` / `history <id>` |
| 废弃节点 | `deprecate <id>` |
| 切换阶段 | `set phase <phase>` |
| 激活任务 | `set active-task <TASK-ID>` |

---

## 5. 常见问题与排障

### 5.1 `validate` 失败：docs/ 已被篡改或未运行 compile

```bash
node .asa/index.js compile
node .asa/index.js validate
```

### 5.2 `validate` 失败：节点文件已变更但未重新 compile

节点文件被直接编辑（未走命令），docs 未同步：

```bash
node .asa/index.js compile
```

### 5.3 `validate` 失败：存在未完成的传播条目

某个节点有 `pendingPropagation` 未执行完：

```bash
# 查看哪个节点
node .asa/index.js history <疑似节点>
# 执行传播
node .asa/index.js propagate <源节点>
# 或人工处理失败动作后重跑
```

### 5.4 hook 拦截：当前没有活跃 Task

处于 implementation/review 阶段但没有激活任务：

```bash
node .asa/index.js set active-task TASK-001
```

### 5.5 hook 输出 `[ASA 拦截]` vs `[ASA 放行]`

- `[ASA 拦截]`：hook 主动拒绝（无活跃任务、YAML 非法）
- `[ASA 放行]`：hook 校验通过
- 无输出：hook 未运行（检查 settings.json 配置）

### 5.6 matrix.yaml 损坏 / 缺失

```bash
# 从骨架 + nodes 重建（edges 依赖关系需从备份恢复）
node .asa/index.js reconcile
```

若无法解析，先备份损坏文件：

```bash
mv .asa/matrix.yaml /tmp/matrix.yaml.bak
node .asa/index.js reconcile
```

### 5.7 单个节点 YAML 损坏（如 Tab 缩进）

所有命令报「N 个节点文件解析失败」：

```bash
# 错误信息会列出具体文件和原因，修复后重试
# 或用 validate-yaml hook 定位
node .asa/hooks/validate-yaml.js .asa/nodes/xxx.yaml
```

### 5.8 hook 未生效

- 确认 `.claude/settings.local.json` 或 `.gemini/settings.json` 配置了 hooks
- 确认 hook 路径正确（路径含空格时需加引号）
- Gemini：确认 `experimental.skills: true`

### 5.9 Windows 下 pre-commit 不生效

需要 Git Bash 或 WSL 环境。没有的话可跳过 pre-commit，改在 CI 中跑 `validate`。

---

## 6. 数据模型速览

```
.asa/
├── matrix.yaml        # 摘要索引（meta/requirements/architecture/tasks/edges/digests）
├── nodes/             # 数据主体（真实节点文件）
│   ├── requirements/*.yaml
│   ├── architecture/*.yaml
│   └── tasks/*.yaml
└── backups/           # change-req 快照
```

**一致性保障**：

| 机制 | 说明 |
|------|------|
| docs digest | docs/ 内容 SHA-256，检测篡改/未编译 |
| nodes digest | nodes/ 内容 SHA-256，检测节点漂移 |
| reconcile | 从 nodes 重建摘要，修复不一致 |
| atomic write | 写文件先 `.tmp` 再 rename，防半写损坏 |

---

## 7. 备份与恢复

- 关键数据：`.asa/nodes/`（不可重建，务必备份/提交）
- 可重建：`matrix.yaml`（reconcile 自举）、`docs/`（compile 重新生成）
- `change-req` 自动在 `.asa/backups/` 创建快照

建议把 `.asa/` 纳入版本控制（除 `backups/` 和临时文件）。

---

## 8. 安全与权限

- hook `check-work-order`：无活跃 Task 时阻止非 `.asa/` 文件写入（Tier 2/3）
- hook `validate-yaml`：写入后校验 YAML 合法性
- `set active-task` 只接受 TASK 节点、拒绝终态任务
- 边管理有循环检测，禁止创建循环依赖

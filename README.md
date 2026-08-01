# ASA — AI Software Architect

> 把 AI 从"代码生成器"变成"项目负责人"。
> Spec-Driven + Document-Driven + AI-Driven Development。

支持 **Claude Code** 和 **Gemini CLI** 双平台。Windows / Mac / Linux 通用。

---

## 快速安装

### 方式一：安装脚本（推荐，跨平台）

```bash
# Claude Code 用户
node install.js claude

# Gemini CLI 用户
node install.js gemini
```

> 要求 Node.js 18+。自动复制引擎、模板、Skill 定义，Gemini 用户还会自动启用 experimental.skills。

### 方式二：手动安装

**Claude Code 用户：**
```bash
# Mac / Linux
cp -r clients/claude/.claude ~/
cp -r engine ~/.asa

# Windows (PowerShell)
Copy-Item -Recurse clients/claude/.claude -Destination $env:USERPROFILE\.claude
Copy-Item -Recurse engine -Destination $env:USERPROFILE\.asa
```

**Gemini CLI 用户：**
```bash
# Mac / Linux
cp -r clients/gemini/.gemini ~/
cp -r engine ~/.asa

# Windows (PowerShell)
Copy-Item -Recurse clients/gemini/.gemini -Destination $env:USERPROFILE\.gemini
Copy-Item -Recurse engine -Destination $env:USERPROFILE\.asa
```

> **Windows 注意**：`pre-commit` 文件需要 Git Bash 或 WSL 环境。如果没有，可以手动跳过。

### 方式三：从源码一键安装

```bash
node install.js
# 脚本会自动检测已安装的 AI 客户端并选择对应版本
```

---

## 目录结构

```
asa/
├── install.js                       # 跨平台安装脚本（推荐）
├── README.md
├── engine/                          # 共用引擎（零外部依赖）
│   ├── index.js                     # CLI 路由（17 个命令）
│   ├── commands/                    # 命令模块（每个命令独立文件）
│   │   ├── compile.js  patch.js  traverse.js  reconcile.js  validate.js
│   │   ├── status.js  impact.js  edge.js  propagate.js  change.js  deprecate.js
│   │   ├── add.js  journal.js  history.js  set.js
│   │   └── commands.test.js         # 命令集成测试（沙箱 + 子进程）
│   ├── lib/                         # 库模块
│   │   ├── yaml.js  matrix.js  graph.js  state-machine.js  changelog.js
│   │   └── *.test.js                # 单元测试
│   └── hooks/
│       ├── check-work-order.js      # PreToolUse 状态拦截器（Claude argv / Gemini stdin）
│       ├── validate-yaml.js         # PostToolUse YAML 校验器（双协议）
│       └── hooks.test.js            # hook 双协议测试
├── templates/                       # 项目指令模板
│   ├── CLAUDE-tier1~3.md
│   └── gemini-tier1~3.md
├── skeleton/matrix.yaml             # 空矩阵骨架
└── clients/
    ├── claude/.claude/skills/asa/SKILL.md
    └── gemini/.gemini/skills/asa/
        ├── SKILL.md
        └── scripts/asa-init.js
```

---

## 使用

| 客户端 | 启动方式 | 初始化命令 |
|--------|----------|-----------|
| Claude Code | `claude` | `/asa init` |
| Gemini CLI | `gemini chat` | 说"初始化 ASA" |

---

## 引擎命令（两边通用）

> 在项目根目录运行 `node .asa/index.js <命令>`（引擎已安装到 `.asa/`）。

### 基础

| 命令 | 说明 |
|------|------|
| `compile` | 节点 → docs 编译（保留用户手写头尾/节点间笔记） |
| `patch` | docs → 节点反向同步（反写 acceptanceCriteria） |
| `reconcile` | 事务对账 + 状态摘要 + 存量迁移（matrix 缺失时自举） |
| `validate` | 健康检查 + CI 门禁（digest、节点漂移、未完成传播） |
| `traverse <id>` | 图 BFS 遍历（输出 blast radius JSON） |

### 状态机

| 命令 | 说明 |
|------|------|
| `status <id> <new-status>` | 按状态机规则推进节点状态（非法跳转拒绝，同状态幂等） |
| `deprecate <id>` | 废弃节点（REQ→deprecated / ARCH→superseded / TASK→cancelled），级联下游 TASK |
| `set phase <phase>` | 设置项目阶段（init/discovery/architecture/task-breakdown/implementation/review） |
| `set active-task <TASK-ID>` | 激活任务（hook 写入门禁依赖它）；`set active-task clear` 清除 |

### 影响与传播链

| 命令 | 说明 |
|------|------|
| `impact <id>` | 影响分析报告（上游依赖 + 下游影响） |
| `propagate <id>` | 幂等执行 pendingPropagation 动作（失败保留 partial） |
| `change-req <id>` / `change-arch` / `change-task` | 变更入口（备份快照 + 引导） |

### 节点管理

| 命令 | 说明 |
|------|------|
| `add-req <title> [--priority P1]` | 新增需求节点（自动分配 ID + compile） |
| `add-arch <title>` | 新增架构节点 |
| `add-task <title>` | 新增任务节点 |

### 查询与边

| 命令 | 说明 |
|------|------|
| `journal` | 全项目变更历史 |
| `history <id>` | 单节点变更沿革 |
| `edge add <from> <to> --type depends\|extends\|refines` | 新增依赖边（循环检测） |
| `edge rm <from> <to>` | 删除依赖边 |

---

## 跨平台兼容性

| 组件 | Mac | Linux | Windows |
|------|-----|-------|---------|
| 引擎 index.js | ✅ | ✅ | ✅ |
| 命令/库模块 | ✅ | ✅ | ✅ |
| Hook 脚本 | ✅ | ✅ | ✅ |
| asa-init.js | ✅ | ✅ | ✅ |
| install.js | ✅ | ✅ | ✅ |
| 模板 / 文档 | ✅ | ✅ | ✅ |
| pre-commit | ✅ | ✅ | ⚠️ 需 Git Bash |

---

## 核心特性

- **全链路变更管理**：需求新增（add-req）→ 状态机推进（status）→ 影响分析（impact）→ 幂等传播（propagate）→ 编译（compile）
- **节点状态机**：REQ（proposed/approved/modified/implemented/rejected/deprecated）、ARCH（draft/reviewed/approved/superseded）、TASK（pending/in_progress/completed/verified/blocked/cancelled），非法跳转拒绝
- **结构化传播**：`pendingPropagation` 定义动作（set_status/append_to_array/set_field/replace_in_array），幂等执行、失败保留 partial
- **CI 门禁**：`validate` 校验 docs digest、节点↔docs 漂移（nodesDigest）、未完成传播
- **幂等初始化**：多次运行不丢失项目数据
- **语义化合并**：CLAUDE.md / GEMINI.md 已存在时保留用户手写规约
- **跨平台 Hook**：同一套脚本兼容 Claude Code（argv）和 Gemini CLI（stdin JSON），拦截/放行输出明确标记
- **自定位寻址**：脚本自动定位项目根目录，不依赖 CWD
- **换行符兼容**：哈希计算前标准化 CRLF/LF
- **测试保障**：127 个测试（单元 + 命令集成 + hook 双协议），整体覆盖率 87.5%

## 文档

| 文档 | 说明 |
|------|------|
| `docs/ASA-GUIDE.html` | **完整可视化指南**（浏览器打开）：项目结构、实现方式、功能、快速上手、完整工作流、实现原理、FAQ |
| `docs/RUNBOOK.md` | 使用与排障手册：安装、日常操作、完整工作流、常见问题恢复 |
| `docs/CONTRIBUTING.md` | 开发者贡献指南：环境、测试、架构约定、PR 清单 |
| `ASA-v3-changelife-design.md` | v3 全链路变更管理设计文档 |

> `docs/ASA-GUIDE.html` 是自包含单文件（内联 CSS/JS），可直接本地双击打开，也可部署到 GitHub Pages。

## 许可证

MIT

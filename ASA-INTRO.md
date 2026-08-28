# ASA · AI Software Architect — 项目全生命周期架构师

> **一句话认识它**：ASA（AI Software Architect）是一个把 AI 从"代码生成器"升级为"对项目全生命周期行为负责的严谨架构师"的工程管理框架。它用 **Spec-Driven（规格驱动）** + **Document-Driven（文档驱动）** 的方式，让 AI 在开发前先想清楚"为什么做、怎么做、哪些任务"，开发中守住秩序，开发后完成审核闭环，把"需求 → 架构 → 任务 → 实现 → 验收审计"全部管起来。

支持 **Claude Code** 与 **Gemini CLI** 双平台，Windows / Mac / Linux 通用，**零外部依赖**（只用 Node.js 18+ 内置能力），MIT 开源。

---

## 目录

1. [它到底解决什么问题？](#1-它到底解决什么问题)
2. [我需不需要它？](#2-我需不需要它)
3. [它实现了哪些核心功能？](#3-它实现了哪些核心功能)
4. [三种使用模式（Tier 1/2/3）怎么选](#4-三种使用模式tier-123怎么选)
5. [如何部署（安装）](#5-如何部署安装)
6. [如何初始化一个项目](#6-如何初始化一个项目)
7. [如何用它完成日常工作（完整工作流）](#7-如何用它完成日常工作完整工作流)
8. [命令速查表](#8-命令速查表)
9. [崩溃自愈与常见排障](#9-崩溃自愈与常见排障)
10. [常见问题 FAQ](#10-常见问题-faq)

---

## 1. 它到底解决什么问题？

很多人在用 AI 写代码时都会遇到这些痛点：

- **AI 只写代码，不管为什么写**：它常常直接"开干"，跳过了需求确认、架构设计，导致写出来的东西和真实目标对不上。
- **越改越乱，没有人能说清楚项目全貌**：需求在哪、架构长什么样、还剩哪些任务没做，全靠人脑记忆，多人协作时更是各说各话。
- **改一个需求，不知道会炸哪里**：需求一变，架构和任务怎么联动没人管，经常改完一处又漏一处。
- **AI 自己判断"写完了"，却没人验收**：缺少"谁来做最后把关"的机制，代码跟需求是否对齐完全靠自觉。
- **写坏了没法回滚**：进程一崩、电一断，配置文件半写坏就救不回来了。

**ASA 的答案**：把一个项目组织成一张**"节点数据图 + 状态机"**：
- 三种节点：**REQ（需求）→ ARCH（架构）→ TASK（任务）**，用边（depends/extends/refines）表达它们之间的关系。
- 一个**状态机**：每个节点都有明确的生命周期，只能按规定路径推进，跳级会被拦截。
- **AI 全程在"框架内"干活**：通过 Hook 在"写代码前"强制它先激活任务、在"写完后"校验并对责任闭环，人来当最终审核者。

> 一句话：**ASA 让 AI 从"想到哪写到哪"变成"按规格、按任务、按审核"地干活，同时给你一张永远最新的项目地图和一套崩溃自愈保险。**

---

## 2. 我需不需要它？

### ✅ 适合你（推荐）
- 你在用 **Claude Code / Gemini CLI** 做软件项目，经常感觉 AI"失控"、乱改、说不清进度。
- 你有 **需求梳理 → 架构设计 → 任务拆解 → 实现 → 验收** 这样的正规开发流程诉求（哪怕只是单人）。
- 你在做**多人协作 / 企业级 / 需要可审计**的工程，希望代码改动有据可查、有责任人。
- 你经常改需求，希望**自动知道影响范围**并**级联传播**到架构和任务。
- 你受够了配置文件被 AI 或断电写坏、无法回滚。

### ⚠️ 需要权衡
- 它**需要 Node.js 18+ 环境**，并依赖 Claude Code 或 Gemini CLI 作为载体。
- Tier 2/3 模式下有**流程约束**（写代码前须激活任务、完成后须人审核），多一层"纪律"，不适合完全放飞。
- 初次上手有少量学习成本（命令略多），但日常核心动作其实只有几个。

### ❌ 可能不适合
- 只是一个几十分钟的**一次性脚本/临时 Demo**，不想引入任何流程（这种情况可以只用 Tier 1 极简模式，甚至不必启用）。
- 你没有 Claude Code / Gemini CLI，也不想装。

---

## 3. 它实现了哪些核心功能？

### 3.1 项目管理的数据模型（节点 + 边 + 状态机）
- **三类节点**：需求 `REQ-xxx`、架构 `ARCH-xxx`、任务 `TASK-xxx`，各自独立存放于 `.asa/nodes/` 下。
- **依赖边**：`edge add/rm` 建立 `depends / extends / refines` 关系；加边前做**逆向 BFS 强环路检测**，从源头杜绝循环依赖。
- **强状态机**：`status` 命令按规则原子推进状态，**拒绝非法跳转**（比如没审核就直跳 completed），同状态幂等。
- **节点查重**：新增需求时做相似度判重（Bigram Dice，相似度 > 0.9 拦截），防多人协作产生冗余节点；确实需要可走 `--by` 审计豁免并留痕 `allowSimilar`。

### 3.2 Spec-Driven / Document-Driven 双向同步
- **正向编译 `compile`**：把 nodes 编译成 `docs/` 里的 Markdown（需求、架构、任务），**完美保留你手写的开头/结尾/注释**；叙事型文档（overview、architecture）不参与强制哈希，你可以自由润色长文。
- **反向同步 `patch`**：把你在 Markdown 里人工补充的验收标准等反写回节点 YAML，打通"数据 ↔ 文档"双向流动。
- **CI 门禁 `validate`**：静态指纹＋节点漂移＋未完传播三项校验，作为 CI/CD 拦截卡点（Tier 3）。

### 3.3 变更影响与级联传播
- **`impact <id>`**：变更分析报告——上游深度依赖溯源 + 下游影响"爆炸半径"计算，让你知道改一处会影响哪些。
- **`change-req/arch/task`**：结构化变更请求入口，**自动生成备份快照**再进入引导式变更。
- **`propagate <id>`**：把变更按 `pendingPropagation` 预设动作**级联、幂等**地传播到下游；某条失败会局部保留为 `partial` 方便排障。
- **`traverse <id>`**：BFS 拓扑遍历，输出下游影响层级 JSON。

### 3.4 任务生命周期 + 架构师审核闭环
- **`plan-tasks`**：对全部非取消任务做拓扑排序，自动输出"先并行哪些、后依赖哪些"的编排规划。
- **`set active-task <id>` / `set phase <phase>`**：声明当前阶段与正在开发的任务（工作令）。
- **提审闭环**：AI 完成任务后 `status <id> awaiting-confirmation` 挂起 → **由人类架构师**用 `confirm-task`（通过→completed）或 `reject-task`（驳回→in_progress 并附原因）裁决，**AI 不能自己通过**，保证审计链闭环。
- **`cancel-task` / `deprecate`**：安全取消任务 / 级联废弃节点。

### 3.5 崩溃自愈与安全防护（v3 标志特性）
- **ACID 持久化崩溃自愈事务**：任何写操作前先建 `.asa/transactions/<TX>` 事务目录、备份原始文件；进程闪退/断电后，下一次运行任何命令会自动 `rollbackAllIncomplete()` **原子回滚未提交的脏事务**，根绝半写损坏。
- **Hook 写后还原物理协议**：Claude / Gemini 会话级 BeforeTool / AfterTool Hook——未激活任务就写文件、YAML 写坏等非法写入会被拦截并**物理还原 / 擦除**，防止脏代码残留。
- **`session-start.js` 纯只读启动诊断**：会话开始时只读地提示当前有待架构师确认的任务数，不写盘、不加锁、不改 mtime。
- **Schema 三阶段迁移**：旧项目向上兼容到 v3，自动补齐缺失默认值。
- **进程级独占文件锁 + 全局崩溃兜底**：写命令加锁，`process.exit` 也保证事务先安全提交或回滚。

### 3.6 诊断与查询
- **`diagnose`**（纯只读自检）、**`doctor`**（全维度健康审计：坏格式/环路/孤岛/失效依赖/未完传播）、**`reconcile`**（对账，matrix.yaml 丢失时自举重建）。
- **`journal` / `history <id>`**：全局 / 单节点历史沿革审计。
- **`search-req` / `list-req` / `list-arch` / `list-task` / `update-overview`**：相似搜索、列表、总览。

> **工程质量**：内置约 30+ 条命令；测试覆盖率高（约 87%），采用 Node 原生 `node:test`，物理隔离沙盒，无任何第三方依赖。

---

## 4. 三种使用模式（Tier 1/2/3）怎么选

| 级别 | 名称 | 定位 | 核心机制 | 适合谁 |
| :-- | :-- | :-- | :-- | :-- |
| **Tier 1** | 探索验证 Starter | 极简、无防御 | AI 每会话读 `matrix.yaml` 按阶段/activeTask 自律跟进；**无 Hook 强管控** | 个人 Demo、MVP、微型项目 |
| **Tier 2** | 离线防御 Defender | 中度防守 | 启用 `check-work-order` 写入门禁 + Git pre-commit | 小团队、独立大中型模块 |
| **Tier 3** | 强契约 Strong Contract | 硬核防守 | 在 Tier 2 基础上再加 CI/CD `validate` 强校验 | 多人协同、企业级关键工程 |

> 一句话选型：**开发初期/个人→Tier 1，正式团队→Tier 2，关键/多团队→Tier 3。** 之后可对项目重跑初始化升级，不会丢数据。

---

## 5. 如何部署（安装）

### 5.1 前置要求
- **Node.js 18+**（必须）
- 已安装 **Claude Code** 或 **Gemini CLI** 其中之一（作为 skill 载体）

### 5.2 一键安装（推荐）
在 ASA 源码根目录执行：

```bash
# 自动检测本地已装的 AI 客户端并集成
node install.js

# 指定 Claude Code 平台
node install.js claude

# 指定 Gemini CLI 平台
node install.js gemini
```

安装脚本会自动：把**共用引擎**复制到 `~/.asa`，把 Skill 定义和初始化脚本注册到 `~/.claude/skills/asa` 或 `~/.gemini/skills/asa`，并将模板、骨架一并装好；Gemini 会自动开启 `experimental.skills` 支持。

### 5.3 手动安装（可选，不推荐日常用）
```bash
# Claude Code
Copy-Item -Recurse clients/claude/.claude -Destination $env:USERPROFILE\.claude   # PowerShell
Copy-Item -Recurse engine -Destination $env:USERPROFILE\.asa

# Gemini CLI
Copy-Item -Recurse clients/gemini/.gemini -Destination $env:USERPROFILE\.gemini   # PowerShell
Copy-Item -Recurse engine -Destination $env:USERPROFILE\.asa
```

> **Windows 提示**：Git pre-commit Hook 需要 Git Bash / WSL 环境；若没有，可跳过 pre-commit，改在 CI/CD 里用 `validate` 把关。

### 5.4 验证安装
```bash
node ~/.asa/index.js diagnose        # 引擎是否就绪
claude                              # 然后输入 /asa init 测试
# 或
gemini chat                          # 然后输入 /asa init 或说"初始化 ASA"
```

### 5.5 升级
拉取最新代码后重跑 `node install.js`；对已初始化的项目可重跑初始化脚本就地升级（**不会覆盖已有项目数据**）。

---

## 6. 如何初始化一个项目

进入你的**项目目录**，在 Claude Code 或 Gemini CLI 里执行：

```bash
/asa init            # 交互式，问你选哪个 Tier
/asa init tier2      # 直接指定 Tier 2
# Gemini 也可用自然语言：初始化 ASA / 初始化 ASA Tier 2
```

初始化会自动搭建（幂等，重跑不覆盖数据）：
- 创建 `.asa/` 目录结构、引擎文件、`matrix.yaml`（Schema v3）。
- 生成项目指令文件（Claude 用 `CLAUDE.md`，Gemini 用 `GEMINI.md`），按所选 Tier 套用对应模板。
- 配置 BeforeTool/AfterTool Hook 与 pre-commit（Tier 2/3）。
- **`.asa/nodes/`（你的真实数据）永远不碰**：重跑初始化、升级都不会丢节点。

---

## 7. 如何用它完成日常工作（完整工作流）

日常其实就 **6 步**（下面用 `node .asa/index.js` 简写为 `asa`，实际在项目里跑命令即可）：

```
【1. 建节点】	add-req / add-arch / add-task；edge add 连依赖；plan-tasks 排任务
【2. 进阶段】	set phase implementation；set active-task TASK-xxx
【3. 写代码】	AI 激活任务后修改代码（Tier2/3 下未激活会被 Hook 拦截）
【4. 收尾】		record-changes 记录改动文件 → status TASK-xxx awaiting-confirmation → set active-task clear
【5. 文档】		compile 编译 docs；validate 跑门禁
【6. 审核】		(人) confirm-task / reject-task 裁决 → 进入下一任务
```

### 逐步演示

**① 梳理需求、架构、任务**
```bash
node .asa/index.js add-req "支持微信扫码登录" --priority P1
node .asa/index.js add-arch "基于 OAuth2 的扫码认证模块"
node .asa/index.js add-task "实现扫码登录后端接口"
node .asa/index.js edge add REQ-001 ARCH-001 --type refines
node .asa/index.js edge add ARCH-001 TASK-001 --type depends
node .asa/index.js plan-tasks
```

**② 进入实现阶段并激活要做的任务**
```bash
node .asa/index.js set phase implementation
node .asa/index.js set active-task TASK-001
```

**③ 让 AI 开始写代码**（此刻被 Hook 盯住，只允许改激活任务相关的文件）

**④ 写完后挂起提审**
```bash
node .asa/index.js record-changes TASK-001 src/auth/oauth.js src/auth/middleware.js
node .asa/index.js status TASK-001 awaiting-confirmation
node .asa/index.js set active-task clear
```

**⑤ 编译 + 门禁**
```bash
node .asa/index.js compile
node .asa/index.js validate
```

**⑥ 架构师审核**——**这一步必须由人来做**
```bash
# 通过：
node .asa/index.js confirm-task TASK-001 --by 你的名字
# 驳回（附原因让 AI 返工）：
node .asa/index.js reject-task TASK-001 --by 你的名字 --reason "验收标准三未通过"
```

### 需求变更时
```bash
node .asa/index.js change-req REQ-001     # 生成备份快照，进入引导式变更
node .asa/index.js impact REQ-001          # 看影响范围（爆炸半径）
node .asa/index.js propagate REQ-001       # 级联、幂等地把变更传到下游
```

---

## 8. 命令速查表

| 分类 | 命令 | 作用 |
| :-- | :-- | :-- |
| **自愈/诊断** | `diagnose` | 纯只读自检，发现崩溃脏事务 |
| | `doctor` | 全维度健康审计（坏格式/环路/孤岛/失效依赖） |
| | `reconcile` | 事务对账，matrix.yaml 缺失时自举重建 |
| **文档同步** | `compile` | 节点 → docs Markdown（保留手写内容） |
| | `patch` | docs → 节点反写（验收标准等） |
| | `validate [--json]` | CI 门禁：指纹/漂移/未完传播 |
| | `traverse <id>` | BFS 拓扑遍历，输出影响 JSON |
| **状态推进** | `status <id> <状态>` | 按状态机原子推进，拦截非法跳转 |
| | `set phase <阶段>` | 设开发阶段 |
| | `set active-task <id>`/`clear` | 激活/清除工作令 |
| | `deprecate <id>` | 级联废弃节点 |
| **审核闭环** | `confirm-task <id> --by <u>` | (人) 确认通过→completed |
| | `reject-task <id> --by <u> --reason <m>` | (人) 驳回→in_progress |
| | `cancel-task <id> --by <u>` | 安全取消任务 |
| **变更传播** | `change-req/arch/task <id>` | 变更请求 + 备份快照 |
| | `impact <id>` | 影响范围/爆炸半径分析 |
| | `propagate <id>` | 级联幂等传播 |
| **节点/边** | `add-req/arch/task <title> [--by]` | 新增节点（带查重/豁免） |
| | `edge add/rm ... --type t` | 建/删依赖边（防环路） |
| **编排/查询** | `plan-tasks` | 拓扑排序编排任务 |
| | `link-task <TASK> <REQ>` | 任务关联需求 |
| | `record-changes <TASK> <files>` | 记录任务改动文件 |
| | `journal` / `history <id>` | 全局/单点历史审计 |
| | `search-req / list-req / list-arch / list-task` | 搜索与列表 |
| | `update-overview` | 只读项目总览 |

---

## 9. 崩溃自愈与常见排障

- **进程闪退 / 断电导致文件写坏**：不用管。下次执行任意 ASA 命令会自动回滚未提交脏事务，物理还原旧文件（见终端 `🔄 自愈` 提示）。
- **新增节点被"重复"拦截**：`[ASA] ❌ 拦截 ... 相似度 95%`——先判断是否该合并进原节点；确需新增则追加 `--by 操作人` 走审计豁免（留痕 `allowSimilar`）。
- **写文件被 Hook 还原/擦除**：多半是在 implementation 阶段**没激活任务**就写代码。先 `reconcile` 看阶段，再 `set active-task TASK-xxx` 后重写。
- **`validate` 哈希失败**：改了节点没重新编译 → 跑 `compile` 再 `validate` 即可。（注意：叙事型 00/02 文档已被解耦，可自由编辑不触发哈希。）
- **`validate` 报未完传播**：对该节点跑 `propagate <id>`；若有个别动作 partial，查看对应 YAML 修复后重跑。
- **启动提示 `AwaitingConfirmation: N`**：就是有 N 个任务等你审核，用 `confirm-task` / `reject-task` 处理（纯提示，不阻塞）。

---

## 10. 常见问题 FAQ

**Q：这需要装外部依赖吗？**
A：不需要。只用 Node.js 18+ 内置能力，无 npm 第三方包，跨平台一致。

**Q：会覆盖我已有的代码或数据吗？**
A：不会。`.asa/nodes/` 是你的节点数据，永远受保护；重跑初始化、升级、`compile` 都只是合并/新增，不覆盖手写内容。

**Q：AI 能自己"通过"任务吗？**
A：不能。确认/驳回/取消都要求人类架构师显式执行（带 `--by` 审计参数），保证"谁批准谁负责"。

**Q：我不想被管太严可以吗？**
A：可以。选 **Tier 1**（极简、无 Hook 拦截）即可，先让 AI 自律跟进，需要时再升级到 Tier 2/3。

**Q：它支持中文吗？**
A：完全支持。文档、命令输出、验收标准等都原生支持中文。

**Q：工程上可靠吗？**
A：内置 ACID 崩溃自愈事务、写后还原 Hook、文件锁、三阶段 Schema 迁移与一整套单元/集成测试（覆盖率约 87%），面向生产可用。

---

## 结语

ASA 的核心主张很简单：**给 AI 一个负责任的施工框架**——让它先想清楚再动手、守规矩地动手、干完活接受审核，同时给你一张永远同步的项目地图和一套崩溃自愈保险。如果你正在用 AI 做软件、又受够了"失控式开发"，不妨从 `node install.js` 开始，5 分钟跑通一个 Tier 2 项目体验一下。

- 更详细的**日常排障手册**见 `docs/RUNBOOK.md`
- 双平台**完整指南**（可视化单文件）见 `docs/ASA-GUIDE.html`
- 核心开发者/架构师贡献规范见 `docs/CONTRIBUTING.md`
- 项目总览与命令明细见 `README.md`

> 开源协议：MIT

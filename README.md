# ASA — AI Software Architect

> 把 AI 从 "代码生成器" 变成对 "项目全生命周期行为负责" 的严谨架构师。
> Spec-Driven + Document-Driven + AI-Driven Development。

支持 **Claude Code** 和 **Gemini CLI** 双平台。Windows / Mac / Linux 通用。
物理零外部依赖（Zero External Dependencies），基于 Node.js 18+ 内置 API 高效驱动。

---

## 快速安装

### 方式一：安装脚本（推荐，跨平台自适应）

```bash
# 自动检测本地已安装的 AI 客户端并进行一键 Skill/配置集成
node install.js

# Claude Code 用户单独集成
node install.js claude

# Gemini CLI 用户单独集成
node install.js gemini

# DeepSeek Harness (DSH) 用户单独集成
node install.js dsh
```

> 要求 Node.js 18+。安装脚本会自动将引擎复制到 `~/.asa` 目录，并注册客户端本地 Skill 定义与 Hook 配置。Gemini 用户还会自动启用 `experimental.skills` 模式；DSH 用户则把 skill 装入 `~/.dsh/skills/asa`，由 DeepSeek Harness 扫描自动发现。

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

**DeepSeek Harness (DSH) 用户：**
```bash
# Mac / Linux
cp -r clients/dsh/.dsh ~/.dsh
cp -r engine ~/.asa

# Windows (PowerShell)
Copy-Item -Recurse clients/dsh/.dsh -Destination $env:USERPROFILE\.dsh
Copy-Item -Recurse engine -Destination $env:USERPROFILE\.asa
```

> **Windows 适配提示**：`pre-commit` 文件需要 Git Bash 或 WSL 环境支持。如果本地无对应环境，可以跳过 Git pre-commit Hook，转在 CI/CD 中通过 `validate` 命令进行拦截把关。

---

## 目录结构

```
asa/
├── install.js                       # 跨平台一键安装脚本（推荐）
├── README.md                        # 项目总览
├── engine/                          # 核心共用引擎（零外部依赖）
│   ├── index.js                     # CLI 路由入口（包含 17+ 核心指令，内置崩溃自愈事务扫描）
│   ├── version.js                   # 引擎版本与最大 Schema 版本（v3）定义
│   ├── commands/                    # 命令模块（高内聚、每命令独立文件）
│   │   ├── compile.js  patch.js  traverse.js  reconcile.js  validate.js
│   │   ├── status.js  impact.js  edge.js  propagate.js  change.js  deprecate.js
│   │   ├── add.js  journal.js  history.js  set.js  cancel.js  confirm.js  reject.js
│   │   ├── search.js  list.js  link.js  record-changes.js  plan.js  overview.js
│   │   ├── diagnose.js  doctor.js
│   │   └── commands.test.js         # 命令级集成沙盒测试
│   ├── lib/                         # 底层库模块
│   │   ├── yaml.js  matrix.js  graph.js  state-machine.js  changelog.js
│   │   ├── transaction.js           # ACID 持久化崩溃自愈事务系统
│   │   ├── lock.js                  # 进程级独占文件锁
│   │   └── *.test.js                # 单元测试
│   └── hooks/
│       ├── check-work-order.js      # PreToolUse 状态拦截 Hook（Claude argv / Gemini stdin 双协议）
│       ├── validate-yaml.js         # PostToolUse YAML 安全校验 Hook（写后物理还原协议）
│       ├── session-start.js         # 纯只读启动诊断 Hook 契约（AwaitingConfirmation 待确认检测）
│       └── hooks.test.js            # Hook 适配测试
├── templates/                       # 渐进式运行层级项目指令模板
│   ├── CLAUDE-tier1~3.md
│   └── gemini-tier1~3.md
├── skeleton/matrix.yaml             # 空数据矩阵骨架
└── clients/
    ├── claude/.claude/skills/asa/SKILL.md
    ├── gemini/.gemini/skills/asa/
    │   ├── SKILL.md
    │   └── scripts/asa-init.js
    └── dsh/.dsh/skills/asa/
        ├── SKILL.md
        └── scripts/asa-init.js
```

---

## 🧩 增量方法库（按需加载）

ASA 内置两套**按需加载**的增量方法，初始化为项目时自动复制到 `.asa/rules/`：

| 方法 | 触发时机（用户明确要求时） | 规则文件 | 关键产出 |
|------|--------------------------|---------|---------|
| **to-spec**（需求分析/规格化） | 说「开始需求分析 / 拆需求 / 把这个需求规格化 / 写 PRD」 | `.asa/rules/to-spec.md` | 含 `## Further Notes` 的七节完整 Spec，落盘 `spec: |` 至 REQ 节点 |
| **to-tickets**（任务拆解/垂直切片） | 说「任务拆解 / 拆任务 / 拆 tickets」 | `.asa/rules/to-tickets.md` | Tracer-Bullet 垂直切片 + **拆解后交用户确认** + `edge add`/`link-task`/`plan-tasks` 建图 |

完整规约平时**不加载**到上下文，只有用户明确触发时才读取执行（详见 `CLAUDE.md` / `GEMINI.md` 的「增量方法库」段）。调整模板/流程时直接改 `.asa/rules/*.md` 即可，无需改动常驻指令。

---

## 快速使用

| 客户端 | 启动运行方式 | 初始化命令 |
|--------|--------------|------------|
| Claude Code | 在终端运行 `claude` | 输入 `/asa init` 触发引导 |
| Gemini CLI | 在终端运行 `gemini chat` | 运行 `/asa init` 或说 "初始化 ASA" |
| DeepSeek Harness | 在 DSH Web GUI 打开会话 | 对助手说 "初始化 ASA" 或 "asa init" |

---

## 核心引擎命令

> 引擎会被安装在项目的 `.asa/` 目录下。您可在项目根目录通过 `node .asa/index.js <命令>` 进行调度。

### A. 基础与自愈

| 命令 | 说明 |
|------|------|
| `diagnose` | 快速评估系统状态，进行只读自诊断。**不写盘、不加锁**，检测持久化崩溃事务。 |
| `doctor` | 一键全面健康审计（格式校验、环路边、孤岛、失效依赖、未完成传播等全维检测）。 |
| `reconcile` | 事务对账 + 状态摘要输出。若 `matrix.yaml` 损坏或缺失，将自举重建它。 |
| `compile` | 节点 → 编译产生 `docs/` Markdown（智能保留用户手写头尾和节点间非节点注释）。 |
| `patch` | docs → 节点反向同步（反写人工在 markdown 里补充的验收标准）。 |
| `validate [--json]` | CI/CD 拦截门禁。严格校验 docs 哈希（解耦叙事型）、节点漂移、未完成传播条目。 |
| `traverse <id>` | 图 BFS 物理拓扑遍历（输出 blast radius 影响层级 JSON 数据）。 |

### B. 状态机推进与审核

| 命令 | 说明 |
|------|------|
| `status <id> <new-status>` | 按设定状态机规则原子推进状态。非法跳转拒绝，同状态幂等拦截。**completed → pending/in_progress 返工回开须 `--by <user>` 审计；`verified` 为验收终态，不可回开。** |
| `confirm-task <TASK-ID> --by <user>` | **[架构师审核]** 确认已完成的任务，正式将其推进至 `completed` 终态。**内置实现落地门禁**：须 `record-changes` 登记且所列文件真实存在，否则拒绝；确无文件变更时用 `--allow-no-files "<理由>"` 显式豁免并留痕。 |
| `reject-task <TASK-ID> --by <user> [--reason <msg>]` | **[架构师审核]** 驳回提交的任务，附带原因并将其退回至 `in_progress`。 |
| `cancel-task <TASK-ID> --by <user> [--reason <msg>]` | 级联取消特定的开发任务，自动归零活跃状态。 |
| `deprecate <id>` | 级联废弃节点（REQ→deprecated / ARCH→superseded / TASK→cancelled），级联下游 TASK。 |
| `set phase <phase>` | 设置项目开发阶段（init/discovery/architecture/task-breakdown/implementation/review）。 |
| `set active-task <TASK-ID>` | 激活开发任务（Hook 拦截机制必须依赖此状态判断）；`set active-task clear` 可清除。 |

### C. 变更影响与传播链

| 命令 | 说明 |
|------|------|
| `impact <id>` | 深度变更分析报告（上游深度依赖溯源 + 下游影响爆炸半径计算）。 |
| `propagate <id>` | 逐条级联幂等执行 `pendingPropagation` 动作。失败则保留为局部 `partial` 以便排障。 |
| `change-req <id>` / `change-arch` / `change-task` | 结构化变更请求入口。自动生成快照备份并进入引导式变更。 |

### D. 节点管理与边

| 命令 | 说明 |
|------|------|
| `add-req <title> [--priority P1] [--by <user>]` | 新增需求节点（自动分配 ID 并触发 compile。支持相似度去重与豁免）。 |
| `add-arch <title> [--by <user>]` | 新增架构节点。 |
| `add-task <title> [--by <user>]` | 新增任务节点。 |
| `add-issue <title> [--category <bug\|requirement-clarification\|observation\|risk>] [--severity P0-P3] [--task <TASK-ID>] [--req <REQ-ID>] [--arch <ARCH-ID>]` | 新增问题(ISSUE)节点。默认 `observation / P2`，可用 `--category`/`--severity` 指定；`--task/--req/--arch` 会自动写入 `affects` 依赖边。提出问题时先做**分流**：确认 bug 则建修复 TASK、需求没写清则改/补需求文档、否则以 observation/risk 观察。 |
| `edge add <from> <to> --type depends\|extends\|refines\|affects\|resolves` | 新增依赖边。添加前利用逆向 BFS 机制运行强环路检测，防循环依赖。`affects`（问题影响到某节点）、`resolves`（任务解决某问题）为 ISSUE 相关边类型。 |
| `edge rm <from> <to>` | 物理删除依赖边。 |

### E. 关联、编排与查询

| 命令 | 说明 |
|------|------|
| `plan-tasks` | **[拓扑任务编排]** 对全量非取消任务运行拓扑排序，按阶段输出并行与前置依赖规划。 |
| `update-overview` | 只读总览摘要：输出架构组件/ARCH 依赖边/lessons + `Nodes Digest (当前)` + 叙事文档重写操作模板。需求/任务正文请用 `docs/01-requirements.md` 与 `docs/03-tasks.md` 作素材（不重复枚举），问题清单用 `docs/04-issues.md`。**不加文件锁**。 |
| `link-task <TASK-ID> <REQ-ID>` | 显式关联特定的开发任务与原始需求。 |
| `record-changes <TASK-ID> <files...>` | 记录当前任务在开发过程中所修改的文件列表。 |
| `journal` | 全项目全局系统历史审计。 |
| `history <id>` | 单节点的历史沿革与变更追溯。 |
| `search-req <query>` | 相似性搜索需求节点。 |
| `list-req` / `list-arch` / `list-task` | 快速列表展示各类型节点。 |

---

## v3 核心升级特性

### 1. `.asa/transactions/<TX-ID>` 持久化崩溃自愈事务系统
在进行任何结构性、状态写操作（包含节点新增、状态跳转、依赖更新和编译等）时，系统会启动 ACID 级物理微事务。在事务生成时，将在本地临时生成 `manifest.json`，并持久化备份待改写文件的原始物理副本。在进程异常闪退、强制杀死、或服务器断电后，下一次任何 ASA 引擎指令执行被拉起时，最顶层会优先运行 `rollbackAllIncomplete()`，智能扫描并原子回滚未提交的脏事务，彻底根绝数据格式半损坏、崩坏的情况。

### 2. `--allow-similar` 相似度查重与审计豁免契约
为了防止多方协同开发时产生冗余节点，引擎内置了高效文本相似度（两元语法 Bigram Dice 相似算法）判重拦截。当新增的需求与现有库中存量文本相似度 `maxScore > 0.9` 时会触发强拦截。如在特定架构场景确需特批，可通过在命令行提供 `--allow-similar <相似REQ-ID> --reason "<特批理由>" --by <操作人>` 三件套参数触发审计豁免契约，豁免通过后，系统会将该操作审计标记持久化在对应节点的 `allowSimilar` 嵌套属性对象中，确保审计的可回溯性。

### 3. BeforeTool/AfterTool Hook 写后还原物理协议
针对 Claude Code / Gemini CLI 会话级工具控制，当出现非法写入（如未激活任务而写文件、YAML 语法格式崩坏、不满足 Hook 验证）时，Hook 拦截器将启用物理还原协议：对被修改的文件自动制作 `hook-<PATH-HASH>.bak` 历史副本，若拦截失败/中断，会立即一键原子覆盖还原旧文件，或将物理新增的脏文件彻底擦除，防止 IDE 或 AI 引擎中间态在工作区残留脏代码。路径 Hash 完美适配大小写规整（Windows 路径兼容），防残留碰撞。

### 4. `session-start.js` 纯只读启动诊断 Hook 契约
在 IDE/CLI 客户端会话首位调度的诊断钩子。采用纯只读机制：不写盘、不加独占锁、不改变文件的修改时间（mtime）。在启动时快速计算项目中当前处于 `awaiting-confirmation` (待架构师确认) 状态的任务数量，并在终端最显眼处输出强提示，引导架构师尽快通过 `confirm-task` / `reject-task` 进行任务审核和审计推进。

### 5. 三阶段 Schema 迁移向上兼容
支持项目 `matrix.yaml` 和节点数据库版本向上迁移（Schema v3 升级）。在迁移操作中，使用 `migrationStage: prepared` -> `migrationStage: committing` -> `migrationStage: completed` 三阶段过程标记，最终阶段原子落盘改写 `schemaVersion`。在旧项目升级时，系统会自动后向兼容补全 TASK 节点缺失的 `linkedReqs` 和 `changedFiles` 默认值 `[]`，防止旧版本文件引发解析崩坏。

---

## v4 核心升级特性：ISSUE 问题管理（Schema v4）

### 1. 第 4 类节点：问题(ISSUE)
新增独立问题节点族 `ISSUE-xxx`（默认 `category: observation / severity: P2`）。提出问题时先做**分流(三态)**：确认为 bug → 建修复 TASK；需求没写清 → 改/补需求文档（`resolution.resolvedBy='requirement-update'`）；否则以 observation/risk 记录观察。适用场景：验证期发现缺陷、返工、被打回的合规问题、需求歧义、观察/风险。

**ISSUE 状态机**：`open → triaged → in_progress → resolved → verified`（`verified` 为吸收终态），另有 `cancelled`、`wontfix`。

### 2. ISSUE 状态门禁
- `status ISSUE-xxx resolved --note "<处置原因>"`：`in_progress→resolved` 为软门禁，**必须提供 `--note`**（记录处置）。
- `status ISSUE-xxx verified --by <user>`：`resolved→verified` **必须 `--by`**。
- 返工/误取消恢复 `resolved→open/in_progress`、`cancelled→open` **必须 `--by`**；`verified` 为吸收态不可回开。

### 3. 自动升 ISSUE（三处默认联动，`--no-issue` 逃生舱）
- `reject-task`：任务被打回（不合规）→ 自动建 ISSUE 记录。
- 落地门禁被拒（confirm-task changedFiles 为空/缺失）→ 给出 `add-issue` 提示。
- `status TASK-xxx pending/in_progress`（completed 返工回开）→ 自动建 ISSUE 记录"实现未落地"。
以上均可用 `--no-issue` 关闭自动建单。

### 4. 资产与文档联动
- `matrix.issues` 摘要 + `affects`（问题影响节点）/`resolves`（任务解决问题）边。
- `compile` 产出 `docs/04-issues.md` 并纳入文档 digest；`update-overview`、`validate`、`doctor` 均纳入未关闭问题统计/告警。
- 存量 v3 项目升级至 v4：`reconcile` 自动补 `matrix.issues`，向后兼容，无需人工迁移。


### 6. 解耦叙事型文档的编译哈希
优化了 `validate` 校验规则。将经常需要由人工深度设计、润色、扩展的散文叙事型文档（如 `00-overview.md` 和 `02-architecture.md`）解耦出强制哈希。哈希指纹仅强力检验完全由引擎根据节点编译生成的 `01-requirements.md` 和 `03-tasks.md` 等数据索引展现型文档，既为架构师提供了自由挥洒架构设计的空间，又完美保全了对关键元数据一致性的硬核把控。

### 7. 叙事文档重写闭环（`update-overview` / `doctor` / `validate`）
`00-overview.md` 与 `02-architecture.md` 由模型（LLM）编写，通过 `<!-- ASA-BASED-ON: <nodesDigest> -->` 锚点追踪过期，而非机械编译。生成这两份文档的**素材来源**：
- 需求 → `docs/01-requirements.md`（compile 编译自 REQ 节点，含 spec/AC/状态/优先级）。
- 任务（含完成/未完成状态） → `docs/03-tasks.md`（compile 编译自 TASK 节点）。
- 架构 / ARCH 依赖边 / lessons / 锚点 → `node .asa/index.js update-overview`。
- **`update-overview`** 只补齐架构/依赖边/lessons，并输出 `Nodes Digest (当前)`、可直接照抄的 `ASA-BASED-ON` 锚点与**标准操作模板**（读 01/03 → update-overview → 重写 00/02 → 写入锚点 → validate）；不重复枚举需求/任务清单。
- **`doctor` / `validate`** 在检出 00/02 锚点过期或缺失时（`NARRATIVE_OUTDATED`），告警文本内附同一份可复制操作模板，指引模型照抄执行。
- **首选自动播种**：`compile` 首次运行时若 `docs/00-overview.md` 或 `02-architecture.md` 缺失，会自动创建占位文件（顶部写入当前 digest 锚点），模型只需填充内容、**保持锚点不变**即可。已存在的文件绝不被覆盖。
- 共享模板与工具集中在 `engine/lib/narrative-sync.js`，三处措辞与步骤完全一致。

---

## 跨平台兼容性

| 组件 | Mac | Linux | Windows |
|------|-----|-------|---------|
| 引擎 index.js | ✅ | ✅ | ✅ |
| 命令/库模块 | ✅ | ✅ | ✅ |
| Hook 脚本 | ✅ | ✅ | ✅ |
| 崩溃自愈事务 | ✅ | ✅ | ✅ |
| 路径大小写规整 | ✅ | ✅ | ✅ |
| pre-commit | ✅ | ✅ | ⚠️ 建议在 Git Bash/WSL 运行 |

---

## 关联开发文档

- `docs/RUNBOOK.md` — 详细的日常使用、典型工作流与异常排障手册。
- `docs/CONTRIBUTING.md` — 核心开发者/架构师贡献指南。
- `docs/ASA-GUIDE.html` — 可视化单文件完整系统指南（建议在浏览器中直接双击打开）。
- `ASA-v3-changelife-design.md` — v3 全链路变更管理与 ACID 自愈事务设计文档。

## 许可证

MIT

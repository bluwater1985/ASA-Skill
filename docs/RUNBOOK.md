# 使用与排障手册（RUNBOOK）

面向使用 ASA（AI Software Architect）的架构师与开发工程师。覆盖系统安装、日常操作、完整工作流、典型故障自愈与物理恢复。

---

## 1. 安装与升级

### 快速安装（推荐）

```bash
# 自动探测双平台环境一键物理分发
node install.js

# Claude Code 平台单独部署
node install.js claude

# Gemini CLI 平台单独部署
node install.js gemini
```

- 要求本地 Node.js 18+ 环境。
- 自动向全局 `~/.asa`、`~/.gemini` 或 `~/.claude` 中部署共用引擎、指令模板、双平台客户端 Hook 与 `session-start.js` 启动诊断。
- 对于 Gemini，将自动修改配置以启用核心 `experimental.skills` 特性支持。

### 验证安装

```bash
# 验证全局共用引擎已就绪
node ~/.asa/index.js diagnose

# Claude Code 客户端验证
claude
# 终端直接输入 /asa init 进行初始化测试

# Gemini CLI 客户端验证
gemini chat
# 运行 /asa init 或自然语言说 "初始化 ASA"
```

### 升级引擎

```bash
# 拉取最新代码仓库，重新运行一键安装
node install.js

# 若要就地升级已初始化的特定项目，可以对该项目重跑初始化（不会覆盖已有项目数据）
node ~/.gemini/skills/asa/scripts/asa-init.js tier2
```

---

## 2. 初始化一个项目

两个平台都通过命令行输入 `/asa init` 激活交互式引导：

### Claude Code

```bash
/asa init            # 触发问询，选择具体的 Tier 模式
/asa init tier2      # 直接以 Tier 2 离线防御模式进行就地初始化
```

### Gemini CLI

```bash
/asa init            # 触发交互式引导
/asa init tier3      # 直接以 Tier 3 强契约模式进行就地初始化

# 若本地客户端因特殊版本不识别斜杠，可通过自然语言触发：
初始化 ASA
初始化 ASA Tier 2
```

### Tier 级别防守烈度

| Tier 级别 | 核心定位 | 核心防御强度与控制机制 |
|-----------|----------|------------------------|
| **Tier 1 探索验证** | 极简 Demo / 敏捷 MVP | **轻量防守**：无 Hook 强管控，无需激活 Task，由 AI 按 `matrix.yaml` 自律推进。 |
| **Tier 2 离线防御** | 小团队 / 独立大中型模块 | **中度防守**：启用 `check-work-order` PreToolUse 写入门禁拦截 与 Git `pre-commit` Hook。 |
| **Tier 3 强契约** | 多人协同 / 企业级关键工程 | **硬核防守**：在前置 Hook 控制上，引入严格的 CI/CD `validate` 静态编译指纹门禁。 |

> **初始化幂等保证**：对已初始化项目重跑初始化**绝对不会丢失或覆盖任何项目数据**。`.asa/nodes/` 内的存量数据受到物理保护，`matrix.yaml` 自动进行合并，`CLAUDE.md` / `GEMINI.md` 将执行语义化合并，完美保留用户手写的非冲突规约。

---

## 3. v3 规范核心工作流

ASA 通过“需求（REQ）→ 架构（ARCH）→ 任务（TASK） → 实现 → 审核验证”构成高可靠的开发闭环：

```
                    【 初始化项目 】
                           │
      ┌────────────────────┴────────────────────┐
  1.【节点新增（支持相似性排重豁免）】     2.【拓扑编排与依赖】
      add-req "新增功能" --priority P1        edge add REQ-001 ARCH-001
      add-arch "架构设计"                     edge add ARCH-001 TASK-001
      add-task "开发功能"                     plan-tasks (拓扑排序自动分步编排)
                           │
      ┌────────────────────┴────────────────────┐
  3.【状态推进与准备】                     4.【代码实现（Hook 锁死工作秩序）】
      status REQ-001 approved                 (IDE 启动 session-start 诊断 Awaiting)
      set phase implementation                set active-task TASK-001
      (准备开始开发编码)                      AI 修改代码 (未关联/未激活则被 Hook 拦截)
                           │
      ┌────────────────────┴────────────────────┐
  5.【提审与编译】                         6.【架构师审核闭环】
      compile (节点编译 docs，不锁叙事型)     confirm-task TASK-001 (通过，变 completed)
      validate (CI 门禁与校验)                 reject-task TASK-001 --reason (驳回 in_progress)
                           │
                    【 变更传播（需求变动）】
                      change-req REQ-001 (创建快照备份)
                      impact REQ-001 (爆炸半径深度分析)
                      propagate REQ-001 (级联动作原子传播)
```

---

## 4. 日常命令速查

| 场景分类 | 命令格式 | 说明与核心细节 |
|----------|----------|----------------|
| **自愈与诊断**| `node .asa/index.js diagnose` | 快速、**纯只读**自检。不加锁、不改变 mtime，自动发现断电半写未完结事务。 |
| | `node .asa/index.js doctor` | 全面深度系统健康审计。全维检测损坏格式、环路、任务孤岛与空悬边。 |
| | `node .asa/index.js reconcile` | 核心事务对账，当 `matrix.yaml` 丢失或被破坏时通过 nodes 自动自举重建。 |
| **文档同步** | `node .asa/index.js compile` | 节点 → Markdown。完美合并保留手写头尾散文，支持叙事型文档哈希解耦。 |
| | `node .asa/index.js patch` | Markdown → 节点。反向提取 docs 内人工修改的 `acceptanceCriteria` 同步写回。 |
| | `node .asa/index.js validate [--json]` | CI/CD 静态验证。指纹校验、节点漂移扫描、以及未处理传播动作审查。 |
| **拓扑编排** | `node .asa/index.js plan-tasks` | 对所有非取消任务按依赖边进行拓扑排序，给出完美的阶段性并行实施规划。 |
| **状态推进** | `node .asa/index.js status <id> <status>`| 按状态机原子改变节点状态，拦截非合规跳转。**已完成（completed）任务返工：`status <id> pending|in_progress --by <user>` 显式回开（无 --by 拒绝）；`verified` 为验收终态不可回开。** |
| **审计审核** | `node .asa/index.js confirm-task <id> --by <user> [--note <msg>]`| 架构师确认通过任务，将其从 `awaiting-confirmation` 推进至 `completed` 终态，自动清理关联的 activeTask。**实现落地门禁（N3/D2）：须已 `record-changes` 登记且所列文件在工作树真实存在，否则拒绝；确无文件变更时用 `--allow-no-files "<理由>"` 显式豁免并留痕。** |
| | `node .asa/index.js reject-task <id> --by <user> [--reason <msg>]` | 架构师驳回提交任务，添加被拒理由，重置该任务为 `in_progress` 状态以待 AI 修复。 |
| | `node .asa/index.js cancel-task <id> --by <user> [--reason <msg>]` | 架构师一键安全取消提审中任务，将其置为 `cancelled` 终态，自动清理关联的 activeTask。 |
| | `node .asa/index.js deprecate <id>` | 级联废弃（REQ 变 deprecated/ARCH 变 superseded/TASK 变 cancelled）。 |
| **环境与工作区**| `node .asa/index.js set phase <phase>` | 声明当前开发阶段。 |
| | `node .asa/index.js set active-task <id>`| 激活任务。激活后，AI 对受管代码文件的写入修改才可被 Hook 放行。 |
| | `node .asa/index.js set active-task clear`| 清理激活的任务状态。 |
| **节点/边管理** | `node .asa/index.js add-req <title> [--by operator]`| 增加需求，判定文本相似度 `> 0.9` 拦截；可用 `--by` 豁免并留存 `allowSimilar`。 |
| | `node .asa/index.js add-arch <title> [--by operator]`| 增加架构设计节点。 |
| | `node .asa/index.js add-task <title> [--by operator]`| 增加开发任务节点。 |
| | `node .asa/index.js edge add <from> <to> --type <t>` | 建立边（`depends/extends/refines`），前置环路强拦截，防循环依赖。 |
| | `node .asa/index.js edge rm <from> <to>` | 物理删除依赖边。 |
| **变更传播** | `node .asa/index.js change-req <id>`| 创建备份快照快照，开启引导变更流。 |
| | `node .asa/index.js impact <id>` | 爆炸半径报告。深度遍历下游影响层级与追溯上游核心依赖源。 |
| | `node .asa/index.js propagate <id>`| 级联幂等传播执行。执行 `pendingPropagation` 预设动作。 |
| **关联与查询** | `node .asa/index.js link-task <TASK> <REQ>`| 强关联特定任务与具体需求源。 |
| | `node .asa/index.js record-changes <TASK> <files>`| 记录特定任务所产生的代码变动文件清单。 |
| | `node .asa/index.js update-overview` | 快速输出项目状态与节点完成度统计。**纯只读、不加锁**，不干扰主 IDE。 |
| | `node .asa/index.js journal` / `history <id>`| 全局历史和单点历史深度沿革溯源。 |

---

## 5. v3 典型排障与崩溃恢复 (Disaster Recovery)

### 5.1 遭遇进程异常中断/系统突然断电：崩溃恢复与物理自愈
**现象**：由于 IDE 突然崩溃、服务器断电或 AI 进程遭遇物理强杀，导致正在进行的写操作中断，可能发生 `matrix.yaml` 半截写损坏。
**物理自愈流程**：
- ASA v3 引擎内置了坚硬的 **ACID 崩溃自愈事务子系统**。在进行任意写盘操作前，引擎会在 `.asa/transactions/<TX-ID>` 创建事务目录，将受改写文件原始内容及路径存入 `manifest.json`。
- **无需手动任何命令**：在发生异常中断后，下一次不论您还是 AI 调度执行任何一条 ASA 命令（例如 `node .asa/index.js diagnose` 或 `reconcile`），系统启动的最前端都会自动拉起全局自愈：
  ```bash
  [ASA] 🔄 发现未完成脏事务 (TX_XXXXX)，正在启动物理自愈机制...
  [ASA] 🟢 成功将 .asa/matrix.yaml 恢复至事务前物理状态
  [ASA] 🟢 脏事务回滚成功，物理环境已还原。
  ```
- 异常脏文件将一键覆盖、物理回滚还原，自愈完成，环境完美恢复。

### 5.2 相似度判重强力拦截：新增节点失败
**现象**：运行 `add-req`、`add-arch` 或 `add-task` 时，系统报错拦截：
```
[ASA] ❌ 拦截：新增需求与存量节点 REQ-002 文本极度相似 (95%)，请避免创建重复数据或使用 --by <operator> 触发审计豁免。
```
**恢复手段**：
1. 请先审查对应的 `REQ-002`，判断是否需要将新功能合并至原节点中（修改其验收标准）。
2. 若确实需要新增独立节点，请在命令最后添加 `--by <operator>` 指明特批架构师（例如：`node .asa/index.js add-req "实现通用原子函数" --by 大鹏`）。
3. 豁免机制将予以放行，并在生成的节点 YAML 属性中自动持久化写入 `allowSimilar: true`。

### 5.3 写入文件被 Hook 还原物理清除
**现象**：AI 修改工作区代码文件时，被 `check-work-order` 等拦截，且新写的修改内容物理丢失（或新创建的文件被物理删除了）。
**原理**：
- ASA 启动了 BeforeTool/AfterTool Hook “写后还原物理协议”。如果检测未通过，为了防止临时脏代码在工作区残留造成逻辑半损坏，Hook 会以 `hook-<PATH-HASH>.bak` 对拦截前的内容覆盖还原，并将新非法产生的文件一键抹除。
- 备份路径使用了 Hash 映射与严格的大小写规整（Windows 不 حساس 兼容），确保备份无遗留。
**恢复手段**：
1. 请务必先执行 `node .asa/index.js reconcile` 检查当前的项目阶段（phase）与激活的活跃任务（activeTask）。
2. 若处于 implementation 阶段，请明确激活对应的任务：`node .asa/index.js set active-task TASK-005` 后再由 AI 动手写代码。

### 5.4 `validate` 校验哈希失败
**现象**：运行 `validate` 时报“编译指纹摘要校验失败，docs/ 被手动篡改或未运行 compile”。
**原因与机制**：
- 节点数据 `nodes/` 更改后没有运行 `compile` 重新生成 docs。
- **注意**：ASA v3 编译哈希已**全面解耦叙事型文档（00-overview.md, 02-architecture.md）**。架构师可在 overview 和 architecture 文件里自由改写长文、插图而不会引发哈希报错；仅 `01-requirements.md` 与 `03-tasks.md` 等展示型文档参与哈希强校验。
**恢复手段**：
- 仅需重新运行编译命令重新落盘指纹即可：
  ```bash
  node .asa/index.js compile
  node .asa/index.js validate
  ```

### 5.5 `validate` 失败：有未完成的传播条目（Pending Propagation）
**现象**：`validate` 校验报有节点处于 “pending propagation” 级联悬空状态。
**恢复手段**：
- 级联变更尚未幂等执行。请对源节点运行传播：
  ```bash
  node .asa/index.js propagate REQ-001
  ```
- 如果传播中有动作执行部分失败，节点会变成 `partial` 状态，请查看对应的 YAML 文件，人工修复并清除或重新执行传播动作。

### 5.6 `session-start.js` 报告 AwaitingConfirmation
**现象**：IDE 开启新会话或 CLI 启动时输出：
```
```
[ASA STATUS] Phase: implementation | ActiveTask: (none) | AwaitingConfirmation: 3
```
**恢复手段**：
- 该 Hook 纯只读，不加独占锁、不改写 mtime，只是一个消息警示。
- 架构师应快速执行任务确认或驳回，推动状态机合规演进：
  ```bash
  # 验证通过并确认该任务已完成 (补充必填审计参数 --by)
  node .asa/index.js confirm-task TASK-001 --by 大鹏

  # 或者逻辑不合规，将其驳回并赋予修正原因
  node .asa/index.js reject-task TASK-001 --by 大鹏 --reason "验收标准三未完全跑通，请重新修复"
  ```

### 5.7 叙事文档 00/02 过期（`NARRATIVE_OUTDATED`）
**现象**：`validate` 报告 `NARRATIVE_OUTDATED`，或 `session-start` / `doctor` 提示“叙事概览/架构设计（00/02）已过期”。
**原因与机制**：
- 节点 `nodes/` 变更后 `nodesDigest` 已改变，而 `docs/00-overview.md` 与 `docs/02-architecture.md` 内的 `<!-- ASA-BASED-ON: ... -->` 锚点仍是旧 digest。
- 这两份是散文叙事文档，**不参与 compile 哈希强校验**，交由模型重写即可，不会引发哈希报错。
- 若文件原本就不存在：`compile` 首次运行会自动播种占位文件（顶部带当前 digest 锚点），详见下方恢复手段第 1 步。
**恢复手段（让模型照抄执行，`update-overview` 已附标准操作模板）**：
1. 读取 `docs/01-requirements.md` 与 `docs/03-tasks.md` — 需求/任务的真实素材（compile 编译自 `nodes/`，含 spec/AC/完成状态）。
2. `node .asa/index.js update-overview` — 读取架构组件/ARCH 依赖边/lessons，并输出 `Nodes Digest (当前)` 与可直接照抄的 `ASA-BASED-ON` 锚点。
3. `node .asa/index.js diagnose` — 再次确认当前 digest。
4. 用 `write_file` 重写 `docs/00-overview.md` 与 `docs/02-architecture.md`。
5. 每份文档顶部写入当前锚点：`<!-- ASA-BASED-ON: <当前 digest> -->`。
6. `node .asa/index.js validate` — 确认无 `NARRATIVE_OUTDATED` 告警。

---

## 6. 数据索引与持久化模型

```
[ 项目根目录 ]
  └── .asa/
        ├── matrix.yaml        # 数据核心索引（包含 schemaVersion、当前 meta 阶段、哈希指纹）
        ├── nodes/             # 真实分布式节点数据库（严禁由外部手动物理删除）
        │     ├── requirements/
        │     ├── architecture/
        │     └── tasks/
        ├── transactions/      # ACID 崩溃自愈临时脏事务备份池
        └── backups/           # 变更请求生成的节点历史快照库
```

**双重指纹校验防线**：
1. **docsDigest (文档指纹)**：计算 `01` 与 `03` 编译文档的 SHA-256，防御外界对展示结果的随意乱改。
2. **nodesDigest (节点指纹)**：计算 `nodes/` 目录下全部 yaml 文件内容的 SHA-256，用以感知任何未通过 CLI 命令进行的物理节点篡改。

---

## 7. 极致安全性保障机制

1. **防环路依赖体系**：在调用 `edge add` 时，系统在物理内存进行逆向 BFS 强环路检测，从源头绝阻断循环依赖。
2. **状态机强规则**：节点状态跃迁一律受内置状态机阻断，杜绝“无需求审核就执行任务、无任务完成就直跳 verified”的崩坏行为。
3. **工作令强制秩序**：Tier 2/3 下，`check-work-order` Hook 在实施阶段拦截任何未激活活跃任务的写盘，保障写盘对账的实效性与审计链追踪，锁死“单兵作战，完结一个任务再进入下一任务”的精益开发秩序。

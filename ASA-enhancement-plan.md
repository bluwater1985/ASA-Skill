# ASA 增强方案：查重 / 冲突 / 追溯 / 自动化 / 任务人工确认 / 垂直拆解

> 状态：**终审锁定（Final Architectural Freeze）** · 范围：一次性全部落地 · 平台：Claude Code + Gemini CLI

## Context（为什么做这个）

ASA（AI Software Architect）已能运转，但真实使用中存在以下痛点：

| 编号 | 痛点 | 根因 |
|---|---|---|
| P1 | 需求/任务重复 | `add-req` 盲追加（`getNextId` 只递增序号），无写前查重、无写前必读清单 |
| P2 | 新旧需求矛盾 | 无语义比较；"新需求覆盖旧需求"未用 `deprecate` + `edge refines` 建模，形成幽灵旧需求 |
| P3 | 代码与文档不符 | TASK 无 `linkedReqs` 追溯链；`validate` 只查 digest，不查语义与追溯一致性 |
| P4 | 每次手动说"用 ASA" | 触发靠 CLAUDE.md 软提示；无会话级自动启动 |
| P5 | 任务被模型自动标 completed | 模型自说自话标记完成，掩盖"执行后仍有问题/未达预期" |
| P6 | 复杂需求拆成单个大任务 | 无垂直拆解规则、无依赖排序工具 |

**用户已拍板的决策：**

- **无 embedding 基建**（无 Ollama、无云端端点）→ 放弃 MCP/embedding 语义层，采用**强归一化字符 Bigram + Dice 相似度算法 + 紧凑清单 + 模型判断**。
- **单仓库、项目相互独立** → 索引按项目本地化，无多仓库 manifest。
- **一次全部改完**，双平台都要支持。
- **P5 冻结语义 = 冻结当前活跃任务环境**：当前 Hook 只按 activeTask 做 all-or-nothing 拦截，不承诺文件级任务归属隔离。
- **查重门 = 标题相似度 >90% 硬拦截**。

**已核实的关键事实：**

- `status.js` 完全委托 `state-machine.js` 的 `validateTransition` → 状态机新增状态后，status 命令即支持。
- `changelog.js` 的 `isStatusChange` 是硬编码数组，**必须加入 `'awaiting-confirmation'`**，否则该状态变更不递增版本。
- Claude Code `SessionStart` hook 存在，stdout 会注入上下文；项目级 hook 放 `.claude/settings.local.json`（信任目录后生效）。
- Gemini CLI 无会话级 hook，自动化靠 `GEMINI.md` 规则 + `BeforeTool`/`AfterTool` 拦截。
- 测试：`node:test` + `node:assert/strict`，沙箱 + CLI 子进程（`helpers.js createSandbox`），覆盖率 ≥80%。
- 更新路径：`node install.js claude|gemini` → `~/.asa` 全量覆盖（跳过 `*.test.js`/`helpers.js`）；再 `/asa init` 刷项目 `.asa`。

## 设计总览

| # | 层 | 改动 | 解决 |
|---|---|---|---|
| ① | 状态机 | TASK 新增 `awaiting-confirmation` 状态，新增 `confirm-task` / `reject-task` / `cancel-task` 命令（awaiting 出口矩阵） + `deprecate` 级联矩阵 | P5 |
| ② | 确定性检索 | `similarity.js` + `search-req` + `list-req` + `add-req` 查重硬门（支持受控豁免） | P1/P2 |
| ③ | 追溯 | TASK 加 `linkedReqs`/`changedFiles` + `link-task`/`record-changes` + validate 聚合告警 | P3 |
| ④ | 强制 | `check-work-order` 拦截放行白名单 + `set.js` 守卫 + `SessionStart` diagnose 纯读路径 | P5/P4 |
| ⑤ | 行为基线 | 双平台模板加"新需求决策规则"+"任务确认规则" | 全部 |
| ⑥ | 垂直拆解+依赖排序 | `plan-tasks` （Kahn 拓扑排序 + depends 边过滤） + 模板"任务拆解规则" + validate 告警 | P6 |
| ⑦ | 自动文档 | `00-overview`+`02-architecture`（模型叙述 + `ASA-BASED-ON` 锚点）+ `03-tasks` + `update-overview` | 架构/总览不自动更新 |
| ⑧ | 写锁与防呆 | 引入项目级物理排他写锁（`.asa/lock`，10s 自愈租期） + schema 3 旧引擎写阻断 | 并发冲突与损坏防范 |

---

## ① 状态机（P5 核心）

`engine/lib/state-machine.js` — TASK：

```
pending → in_progress → awaiting-confirmation → completed → verified
awaiting-confirmation → in_progress（要求修改）/ cancelled（人工取消）
completed → verified（保持原样）
```

配套修改：

- `engine/lib/changelog.js` — `isStatusChange` 数组加入 `'awaiting-confirmation'`（状态变更触发递增版本并记录审计）。
- `engine/hooks/check-work-order.js` — **冻结当前活跃任务环境**：直接 `require` 项目内置的 YAML 解析器结构化解析 `matrix.yaml`，读取 `activeTask` 及其 `tasks[activeTask].status`；status ∈ `{awaiting-confirmation, completed, verified, cancelled}` → deny 任何非白名单路径的代码写入（消息引导：待确认任务需先确认或要求修改；终态任务需先 set active-task 切换）。当前版本不提供文件级任务归属隔离。
- `engine/commands/set.js` — `set active-task` 拒绝把 `awaiting-confirmation` 任务设为活跃（提示先让用户确认或要求修改）。
- **awaiting 出口矩阵（通用 `status` 对三出口全部物理阻断，只允许专用命令）**：
  - `awaiting-confirmation → completed` 唯一入口：`confirm-task`；
  - `awaiting-confirmation → in_progress` 唯一入口：`reject-task`；
  - `awaiting-confirmation → cancelled` 唯一入口：`cancel-task`。
  - 三命令均须校验目标状态为 `awaiting-confirmation`（否则幂等返回），均属写命令须获取写锁并处于 Hook 白名单内。
- 新 `engine/commands/confirm.js` — `confirm-task <TASK-ID> --by <user> --note "..."` 将 awaiting-confirmation 推进为 completed，写入 confirmation 审计；自动触发 compile。**清除 activeTask 仅当 `activeTask === <TASK-ID>`**，否则保持现值并提示（防多会话误清他人 activeTask）。
- 新 `engine/commands/reject.js` — `reject-task <TASK-ID> --by <user> --note "..."` 将 awaiting-confirmation 打回 in_progress，写入 changes-requested 审计并记录修改意见。
- 新 `engine/commands/cancel.js` — `cancel-task <TASK-ID> --by <user> --note "..."` 将 awaiting-confirmation 置为 cancelled，写入取消原因审计；**仅当 `activeTask === <TASK-ID>` 才清除 activeTask**。
- 通用确认审计元数据结构（`status` 枚举覆盖三出口）：
  ```yaml
  confirmation:
    status: confirmed | changes-requested | cancelled
    by: "user"
    at: "2026-08-21T15:30:00.000Z"
    note: "验收通过，确认合入"
  ```
- `engine/commands/status.js` — 通用 `status <TASK-ID>` 在来源状态是 awaiting-confirmation 时，对 `completed`/`in_progress`/`cancelled` 三出口**一律物理阻断并报错**（须走 confirm/reject/cancel），彻底杜绝模型自说自话。迁移到 awaiting-confirmation 时打印提示文案（"等待用户确认"）。

## ② 确定性检索（替代 MCP）

**新 `engine/lib/similarity.js`**（零依赖，纯函数，可单测）：

- `normalize(text)`：强力归一化。统一转小写，删除所有空格、Tab、换行，归一化或彻底剔除常见中英文标点和符号（`，。？！；：, . ! ; : - _ ( ) （ ） [ ] 【 】 、` 等），确保大字符二元组计算的绝对抗干扰能力。
- `bigrams(text)`：对归一化后的文本提取字符二元组（中英混排通用）。
- `dice(a, b)`：按多重集合（Multiset）求交集/并集规则，计算二元组 Dice 系数。
- `scoreReq(query, node)`：title 加权（×2）+ acceptanceCriteria/description 加权（×1）的 Dice 组合。
- `topCandidates(query, nodes, threshold)`：返回 `[{id, title, status, version, score}]`。正式剔除复杂的 BM25 机制以追求零依赖超轻量体验。

**新 `engine/commands/search.js`**：`search-req <query>` 输出排序候选（id/title/status/version/score），score ≥ 阈值才列出。

**新 `engine/commands/list.js`**：`list-req` / `list-task` / `list-arch` 紧凑清单（id/title/status/version/priority），供模型写前阅读。

**`engine/commands/add.js` 查重硬门**（>90%）：

- `add-req` 创建前对全部既有 REQ 跑 `scoreReq`；打印 score ≥ 0.3 的候选。
- 若 `maxScore > 0.9` 且没有受控豁免 → **exit 1 拒绝创建**，输出相似节点与引导（"该标题与 REQ-XXX 高度相似（92%），请用 change-req 更新旧需求，或确认后调整标题"）。
- 提供 `--allow-similar <REQ-ID> --reason "..."` 受控豁免。记录被豁免节点、原因和操作者，不能仅通过修改标题绕过查重。
- **不做文件写入 hook**——PreToolUse hook 会误伤 propagate/compile 对已有节点的合法重写；`add-req` 是模板规定的新增唯一入口，CLI 层拦截更可靠。
- `add-task` 不加查重门（任务重复由"必须 link-task + 拆分自 REQ 图"流程约束）。

## ③ 追溯（P3）

- `engine/commands/add.js` — TASK 模板加 `linkedReqs: []`、`changedFiles: []`。
- **新 `engine/commands/link.js`**：`link-task <TASK> <REQ>` 校验两节点存在，REQ 追加到 `task.linkedReqs`（幂等去重），将 TASK 版本递增，记录 changeLog 审计，自动 compile 落盘。被取消的 TASK 或 rejected/deprecated REQ 不允许进行新的关联。
- **新 `engine/commands/record-changes.js`**：`record-changes <TASK> <file_path1> [file_path2] ...` 校验 TASK 状态为 `pending` 或 `in_progress`（其余终态/awaiting 一律报错拒绝），路径统一为 `/`，幂等追加到 `changedFiles`。作为节点内容的实质性改动，它**必须递增 TASK 节点版本并追加 changeLog 审计日志**，随后自动调用 compile 刷新 `03-tasks.md`、matrix 与编译型 digest。
- `engine/commands/validate.js` — 使用 `blockingErrors[]` 与 `warnings[]` 聚合全部检查，只有存在 blocking error 时退出码为 1（程序异常为 2），确保非阻塞告警不被提前退出截断。新增**非阻塞告警**（ exit 0）：
  - 孤儿任务：TASK 非 cancelled 且无 `linkedReqs`。
  - 悬空需求：REQ 为 `approved`/`implemented`、`deliveryType` 为 `code`（默认）且没有任何 TASK `linkedReqs` 指向它。
  - 进度不一致：TASK `completed`/`verified` 但关联 REQ 非 `implemented`。
  - 缺变更记录：TASK `completed` 但 `changedFiles` 为空（提示记录改动文件）。
- `validate --json`：可选机器可读输出，供 CI、脚本和模型消费。**固定输出 schema**（字段名不许漂移）：
  ```json
  {
    "status": "ok | blocked",
    "blockingErrors": [{ "code": "...", "message": "...", "id": "...", "path": "..." }],
    "warnings": [{ "code": "...", "message": "...", "id": "...", "path": "..." }],
    "summary": { "nodes": 0, "tasks": 0, "awaitingConfirmation": 0 }
  }
  ```

## ④ 自动化 + 强制（P4/P5）

**新 `engine/hooks/session-start.js`**（Claude Code SessionStart，stdout 注入上下文）：

- 读 stdin JSON 取 `cwd` → 向上找 `.asa/matrix.yaml` 项目根。
- 在项目根运行纯只读诊断路径 `node .asa/index.js diagnose`（或 `reconcile --readonly` 纯读路由），打印 `[ASA STATUS]` 行 + 活跃任务 + **待确认任务数**（`awaiting-confirmation` 计数）。只读路径**严禁调用 `saveMatrix` 或覆写文件**，运行前后文件内容与 mtime 物理上保持不变。SessionStart **禁止自动执行写性质的 `patch`**。
- （并入 ⑦：`[ASA STATUS]` 同时比对 nodesDigest 与 00/02 的 `ASA-BASED-ON`，过期则追加"架构文档过期"提醒，引导运行 `update-overview`。）
- 找不到项目根或 index.js 缺失 → 静默 exit 0。

**`clients/claude/.claude/skills/asa/SKILL.md`**：

- Step 3 已拷贝全部 hooks（新 session-start.js 自动进项目）。
- Step 6 settings.local.json 增加 `SessionStart` 条目（嵌套 schema：`"SessionStart": [{"matcher":"startup","hooks":[{"type":"command","command":"node .asa/hooks/session-start.js"}]}]`）。幂等更新逻辑需同时覆盖该形状（按 description/name 匹配，避免重复注册）。
- 更新命令清单与 Tier 差异表。

**`clients/gemini/.gemini/skills/asa/SKILL.md`**：同步命令/规则文档；**无 SessionStart**（Gemini 无等价机制），自动化靠 GEMINI.md 规则 + 既有 BeforeTool 拦截。

## ⑤ 行为基线（双平台模板）

`templates/CLAUDE-tier1/2/3.md` + `templates/gemini-tier1/2/3.md` 各加两段（Tier 1 精简版）：

```
## 新需求决策规则（用户提出任何功能/变更需求时强制执行）
1. 写前必读：先 `node .asa/index.js search-req <关键词>` 检索现有需求，再决定新增 or 更新。
2. 高度相似（>90%）→ add-req 会被拒绝；如确有不同业务边界，使用 `--allow-similar <REQ-ID> --reason "..."` 记录豁免；否则改为 change-req → impact → propagate 更新既有需求。
3. 部分重叠 → 更新既有需求；确实新 → add-req。
4. 新需求取代旧需求 → `edge add <新> <旧> --type refines` + `deprecate <旧>`。
5. 拆任务时每条 add-task 必须 `link-task <TASK> <REQ>`，禁止孤儿任务。

## 任务确认规则
1. 任务编码完成后 → `record-changes <TASK> <file...>`，再 `status <TASK> awaiting-confirmation`（严禁自行 completed）。
2. 然后 `set active-task clear`，向用户汇报完成内容并等待明确确认；冻结语义是当前活跃任务环境的 all-or-nothing 拦截，当前版本不提供文件级任务归属隔离。
3. 用户确认完成 → `confirm-task <TASK> --by user --note "..."`；要求修改 → `reject-task <TASK> --by user --note "..."`；确认放弃/取消 → `cancel-task <TASK> --by user --note "..."`。
4. 存在 awaiting-confirmation 任务时，每次汇报先列出待确认任务提醒用户。

## 文档刷新规则（见 ⑦ 自动文档）
1. 新需求落库 / 任务状态变更后，运行 `node .asa/index.js update-overview`；若提示文档过期，刷新 00/02 叙述。
2. 00-overview.md / 02-architecture.md 由模型总结重写；01/03 由 compile 自动生成，勿手改。
3. 重写后更新文件头 `<!-- ASA-BASED-ON: ... -->` 标记。
```

同步更新模板中 TASK 状态列表（如 tier2/3 的"Task 三级体系"、状态机描述）。

## ⑥ 任务垂直拆解 + 依赖排序（P6）

**新 `engine/commands/plan.js`**：`plan-tasks [REQ-ID]`（零依赖，Kahn 拓扑 + 就绪判定）：

- 读取全部 TASK 节点 + `matrix.edges`；只考虑两端均为 TASK 且 `type === "depends"` 的边（`from` 为上游阻塞项）。
- 终态 = `{completed, verified, cancelled}`；`awaiting-confirmation` 视为"未完成且阻塞下游"。
- 对每个 TASK 算"上游阻塞项"（`to` 含它、`from` 为 TASK 且非终态的边）。
- 输出：
  - **就绪可执行**（无未完成上游，`ready`）——优先做这些。
  - **阻塞中**（列出各自未完成的阻塞上游，`blocked-by`）。
  - **建议执行顺序**（对未终态任务做 Kahn 拓扑序）。
  - 每个任务标注其 `linkedReqs` 归属需求。
- 可选 `plan-tasks <REQ-ID>` 只看某一需求的任务链。

**`engine/commands/validate.js` 追加拆解粒度告警**（非阻塞）：REQ 的 `acceptanceCriteria` ≥ 4 条却只有 1 个 `linkedReqs` 任务 → 提示"复杂需求疑似只拆了一个任务，建议垂直拆解"。

**模板任务拆解规则**（双平台，并入 ⑤ 的模板）：

```
## 任务拆解规则（task-breakdown 阶段）
1. 复杂需求必须垂直拆解：一个 REQ 拆成多个 S/M 级小任务，禁止拆成单个大任务。
2. 每步用 `edge add <前序TASK> <后序TASK> --type depends` 表达先后依赖；每个任务 `link-task <TASK> <REQ>` 归属需求。
3. 执行顺序：先做 `plan-tasks` 给出的"就绪"任务（无未完成上游）→ 逐步推进；有依赖先完成前面的阻塞任务。
4. 每完成一个任务 → `plan-tasks` 看下一个就绪任务，逐步推进。
```

**配套**：

- `engine/index.js` usage 块注册 `plan-tasks`。
- 测试：`engine/commands/commands.test.js` 加 plan-tasks（就绪/阻塞/拓扑序、awaiting-confirmation 阻塞下游）；validate 拆解粒度告警。
- docs：`RUNBOOK.md` / `README.md` / `ASA-GUIDE.html` 补 plan-tasks。

## ⑦ 自动文档（总览 / 架构 / 任务 文档集 + 知识汇总）— 新增痛点

**背景**：Tier 2/3 会生成 structure/skeleton 等，但每次更新只刷新需求/任务文档；架构与总览文档从不自动更新，项目整体视图缺失。用户诉求：提零散需求时，自动生成/刷新顶层架构文档，让人一眼看懂整个项目。

**已拍板决策**：

- 文档集 = `00-overview.md`（整体架构视图）+ `02-architecture.md`（架构组件清单）+ `03-tasks.md`（任务清单）+ 知识汇总。
- **分工：机器记账，模型写作**：
  - 数据型文档（`01-requirements.md` 现状、`03-tasks.md` 新增）→ compile 机械渲染。
  - 叙事型文档（`00-overview.md`、`02-architecture.md`）→ **模型根据需求总结重写**，不用 compile 堆砌（机械渲染只会产出报表，不是可读叙述）。
- **系统依赖**：从 ARCH nodes + `matrix.edges`（ARCH→ARCH `depends`）推导数据，由模型写成散文；**不定义 system_graph.yaml**（避免新增手写数据源——幽灵文件教训）。
- **知识沉淀**：`knowledge/lessons.yaml` 存在则只读列出（业务约束/禁忌），不存在则省略；不做 schema 约束。

**结构锚点（关键机制，防"模型按需写"退化成幽灵文件）**：

- 00/02 文件头埋 `<!-- ASA-BASED-ON: {nodesDigest} -->`，记录该叙述基于的节点快照。
- 机器（reconcile / validate / SessionStart）比对当前 `calculateNodesDigest()` 与文档 `ASA-BASED-ON`：
  - 一致 → 无提示；
  - 不一致 → `[ASA STATUS]` 打印 `⚠️ 架构文档已过期（基于 v12，当前 v18），建议运行 update-overview 刷新`。
- 模型重写叙述后更新 `ASA-BASED-ON` 为当前 digest → 警告消除。

**`update-overview` 命令**（新 `engine/commands/overview.js`，只读）：

- 输出紧凑摘要供模型重写：
  - 当前结构骨架：REQ/ARCH/TASK 清单（id/title/status/version/priority）；
  - ARCH edges 依赖视图（from → to + type）；
  - 自上次总结以来的变更摘要（新增 / 状态变更 / 废弃 of 节点）；
  - `knowledge/lessons.yaml` 内容（如存在）。
- 模型读摘要 → 重写 00/02 叙述 → 更新 ASA-BASED-ON。
- **只读边界（明确）**：`update-overview` **只输出摘要、绝不写 00/02**；00/02 的叙述重写是模型/用户显式执行的外部写入；写入后由 `validate`/`diagnose` 校验锚点与结构。SessionStart（只读诊断）**只能调用摘要/诊断路径，绝不触发文档重写**。
- 触发时机：SessionStart 过期提醒时、模板"新需求落库后 docs 过期则刷新"规则触发时、或用户主动要求。

**compile.js 扩展**：

- 渲染范围 = `01-requirements.md`（现状）+ `03-tasks.md`（新增：id/title/status/version/linkedReqs/depends 依赖链），沿用 ASA-NODE / ASA-FIELD / ASA-NODE-END 标记，patch 反向解析兼容。
- **patch 反向同步边界**：`patch.js` **只对 `01-requirements.md`（requirements 类节点）做反向同步**；`03-tasks.md` 为纯只读编译输出，**不参与反向同步**（对非目标文件 no-op 跳过，勿抛异常）。
- **绝不覆盖 00/02**（模型叙述），compile 只写数据型文档。

**digest 交互（重要）**：

- 新增独立的编译型 digest 函数，只哈希 `01-requirements.md` 和 `03-tasks.md`，不再把全部 `docs/*.md` 混入同一个硬门禁。
- `meta.compiledDocsExpectedDigest` 保存 compile 生成的期望值，`meta.compiledDocsActualDigest` 保存运行时实际值。
- 00/02 由模型主动编辑，**篡改检测只覆盖编译型文档（01/03）**；00/02 的"与节点是否同步"改用 `ASA-BASED-ON` 追踪，不参与 hand-edit 篡改告警。
- 旧项目的 `docsExpectedDigest` 由 reconcile 兼容读取，并在迁移时转换为编译型 digest 字段。

**模板规则**（并入 ⑤）：

```
## 文档刷新规则
1. 新需求落库 / 任务状态变更后，运行 `node .asa/index.js update-overview`；若提示文档过期，刷新 00/02 叙述.
2. 00-overview.md / 02-architecture.md 由模型总结重写；01/03 由 compile 自动生成，勿手改。
3. 重写后更新文件头 `<!-- ASA-BASED-ON: ... -->` 标记。
```

---

## ⑧ 项目级并发写锁与原子写入（新）

为了防范多会话、并发写操作（如 SessionStart 后台、add-*、status、compile 等）造成的物理文件覆盖或 ID 竞态分配冲突：
1. **轻量物理写锁**：写命令在核心业务逻辑执行前，自动在 `.asa/` 目录下创建 `.asa/lock` 排他锁文件，并在其中写入当前进程的 `PID` 和时间戳。
2. **跨平台存活探针**：检测写锁持有 PID 是否存活，用 Node.js 原生无依赖的 `process.kill(pid, 0)`（`try/catch` 包裹）：
   - 抛 `ESRCH` → 进程已死（判为陈旧锁）；
   - 抛 `EPERM` → 进程**存在但无权限 signal**（Windows 常见），**应判为存活**，不可误判为死锁；
   - 无异常 → 进程存活。
3. **陈旧锁回收（Stale Lock Threshold = 10s）**：若锁文件已存在，读取 PID 和时间戳：
  - 若该 PID 进程存活，**无论锁年龄是否超过 10 秒，都不得抢占**；写操作阻断退出，报错：`[ASA] ❌ 进程并发冲突：进程 ${PID} 正在写盘，当前操作被安全阻断`。
  - 若该 PID 已死且锁年龄超过 10 秒，才视为陈旧锁；新进程可原子删除并重新抢占。
  - 若该 PID 已死但锁年龄未超过 10 秒，先阻断并提示稍后重试，避免进程退出与清理之间的竞态窗口。
  - 若无法判断 PID 状态，本地默认阻断并提示人工处理；CI 必须阻断。10 秒是陈旧锁回收阈值，不是活进程最大执行时长。
  - 如需防止活进程永久持锁，使用心跳/续租更新时间戳，不得通过固定租期抢占活锁。
4. **单入口上锁 + 可重入**：锁只包在 CLI 对外命令入口（`index.js` 路由分发后）进行原子加锁与 `try/finally` 释放，**不在底层通用 `saveMatrix` 中重复上锁**，以支持进程内的嵌套流转（如 `deprecate → reconcile → compile`）。覆盖**含新增命令（confirm/reject/cancel/link-task/record-changes）在内的全部写命令**。
5. **写临时文件与原子替换**：所有节点、matrix、docs 写盘一律采用 `临时文件 (*.tmp) -> fs.renameSync()` 原子替换覆盖物理文件，规避写盘中途断电导致文件损坏。
6. **崩溃一致性（事务）**：`link-task`/`record-changes`/`confirm-task`/`reject-task`/`cancel-task`/`status` 涉及多文件（节点、matrix、01/03、digest）。要求：**写锁覆盖完整命令流程**；写前记录基线/备份；目标文件先写 tmp、全部成功后再统一替换；任一步失败恢复或**留下明确可恢复的 partial 状态**；由 `diagnose` 报告未完成事务，而非静默修复。

---

## ⑨ 钩子物理放行白名单与本地 Fail-Open（新）

1. **白名单物理放行范围**：在活跃任务挂起或清空（All-or-Nothing 冻结环境）下，Hook 必须保障 ASA 的自愈与文档编译功能。
   - 凡是写入的目标路径处于 `.asa/**` 目录（配置、写锁、YAML 节点、变更日志等）及 `docs/**` 目录（编译型 markdown 文档）下的，**Hook 一律豁免放行，不做任何阻断**。
  - 除上述路径外，冻结状态下其余项目路径一律按冻结规则拦截；**不使用源码后缀黑名单**，避免漏放 `.env`、`.json`、`.yaml`、配置和非标准源码。
2. **Hook 判定优先级**：
  - 能确定目标路径且目标在 `.asa/**` 或 `docs/**` → 放行。
  - 能确定目标路径且目标不在白名单 → 在冻结状态阻断。
  - 无法确定目标路径或项目根 → 冻结状态阻断未知写入；非冻结/非 implementation 阶段可兼容放行并打印警告。
3. **校验职责分层**：
  - `PreToolUse`：只检查目标路径、项目根、activeTask/任务状态和已有资产可读性；不宣称能验证工具即将写入的新 YAML。
  - `PostToolUse` / `validate-yaml`：读取写入后的 YAML，执行语法和节点契约校验；失败时恢复写入前备份，或写入 `invalid-write`/partial 标记并阻止后续 validate 通过。
  - CLI 写命令：在自身写入前后执行版本和节点契约校验，不能依赖 Hook 一定存在。
4. **环境自适应 Fail-Open 容错**：在 Hook 脚本中捕获运行异常：
  - 本地仅对环境/输入层异常（如引擎路径丢失、陈旧锁、非目标文件读取故障、无法解析非关键 hook 输入）容错放行，并打印 `⚠️ [ASA Hook Warning] 检测到本地环境异常，当前执行容错放行（Fail-Open）。`。
  - 无法确定目标路径、项目根或白名单归属时，冻结状态不得放行未知写入。
  - 当前待写 matrix/node/YAML 资产本身损坏时，不论本地还是 CI 都 Fail-Closed。
  - CI 环境（`CI=true`）发生任何 Hook 内部异常一律 Fail-Closed，报 exit 1 拦截构建。

---

## ⑩ `deprecate` 级联取消关系矩阵（冻结契约）

为避免 `refines`/`extends` 误触发任务级联取消，同时保留 REQ→TASK 历史兼容取消，`engine/commands/deprecate.js` 按以下矩阵执行：

| 起点 | 终点 | 边类型 | 是否级联取消下游 TASK | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| TASK | TASK | `depends` | **是** | 上游 TASK 进入 `cancelled` 时，下游 TASK 自动级联 `cancelled`。 |
| REQ/ARCH | TASK | `depends` 或 *无 type (legacy)* | **是** | 历史兼容通道：需求/架构被废弃（`deprecated`/`superseded`）时，直属下游实现 TASK 级联 `cancelled`。 |
| REQ/ARCH | REQ/ARCH | `refines` | **否** | 新旧替代，仅置 `deprecated`/`superseded` 并记 audit，绝不级联取消任务。 |
| REQ/ARCH | REQ/ARCH | `extends` | **否** | 继承扩展，不触发任何任务级联取消。 |
| 任意 | 任意 | *无 type (legacy)* | **否**（除 REQ→TASK 外） | 无 type 默认视为 `extends`（不级联），`validate` 非阻塞告警提示补齐 type。 |

**通用规则（兜底覆盖上表未显式列出的全部组合，每种端点组合补测试）：**
1. `cancelled` **只允许落到 TASK 端点**；非 TASK 端点一律走其状态机自身的 `deprecated`/`superseded`，绝不强转 `cancelled`（保留类型安全）。
2. 级联资格 = 源进入废弃/终态 **且**（边类型 ∈ {`depends`} ∪ {无 type legacy 且为 REQ/ARCH→TASK}）。
3. `refines`/`extends` **永不级联**（含 REQ→TASK(refines)、TASK→TASK(extends/refines)）。
4. `linkedReqs` **不自动转为 graph edge**，也不单独触发取消；关联到已废弃 REQ 的任务由 `validate` 给人工处理告警（而非静默取消）。

**实现口径澄清：**
- TASK 状态机**无 `failed` 态**（仅 pending/in_progress/awaiting-confirmation/completed/verified/blocked/cancelled），矩阵首行本期**仅指 `cancelled`**。
- 级联**唯一入口是 `deprecate`**（多节点废弃）；`status <TASK> cancelled` 为单节点操作、不级联。

---

## 迁移

`engine/commands/reconcile.js`：

- `schemaVersion 2 → 3` 时，对存量 TASK 幂等补齐 `linkedReqs: []`/`changedFiles: []`（缺失才补，不覆盖已有值）。
- 迁移时补齐 `meta.engineVersion: "3.x"`，旧 TASK `done` 状态平滑迁移为 `completed`，并打印状态转换清单。
- 迁移前备份 matrix、nodes 和 docs；迁移失败保留备份并返回非零退出码；重复运行不得重复追加日志或字段。
- 建立只读诊断命令 `diagnose`（复用内部只读读取逻辑），SessionStart 只能调用该路径。
- **engineVersion 单一来源**：新增 `engine/version.js`，导出 `ENGINE_VERSION` 与 `MIN_SCHEMA_VERSION` 为唯一判定来源。项目 `meta.engineVersion` 记录**最后一次写入它的引擎版本**；当前运行引擎版本来自本地 `version.js` 常量（非用户输入）；版本比较用明确 major/minor 规则。
- **旧引擎拒写（统一多入口）**：旧引擎在**所有写命令入口**拦截（不只 `doctor` 提示）：CLI 命令入口、`check-work-order` Hook、`validate-yaml` PostToolUse、手工编辑后 `reconcile`、直接运行项目内旧 `.asa/index.js`。Hook 管文件级流程拦截、CLI 管 schema/engine 兼容拦截，双契约不可互相绕过；`doctor` 本身只读、不得改 matrix"修复"版本。
- **迁移阶段标记（幂等可验证）**：不要只凭 `schemaVersion` 一次性判断，用可验证的阶段/迁移标记使每步幂等且可单独判断完成；迁移前后记录 nodes/docs 基线；发现 `.tmp`/未完成事务/备份目录先报告恢复状态；`meta.schemaVersion` 仅在升级**成功后才**更新。
- `[ASA STATUS]` 行追加 `AwaitingConfirmation: N`。
- `done` 计数保持 `['done','completed','verified']`（awaiting-confirmation 不计入完成）。
- ⑦ 的文档过期提醒走 `[ASA STATUS]` 打印，**无需 schemaVersion 变更**；`ASA-BASED-ON` 存在文档文件头，不入 matrix。

## 文档同步

- `engine/index.js` usage 块：注册并说明 `search-req` / `list-req` / `list-task` / `link-task` / `record-changes` / `confirm-task` / `reject-task` / `cancel-task` / `plan-tasks` / `update-overview` / `diagnose` / `doctor`。
- 文档集说明：`docs/` 下 `00-overview.md` + `02-architecture.md` 为模型叙述（`ASA-BASED-ON` 锚点）， `01-requirements.md` + `03-tasks.md` 为 compile 编译（`00`/`02` 不参与篡改检测，只按锚点追踪过期）。
- `README.md`：命令表 + TASK 状态集合。
- `docs/RUNBOOK.md`：第 3/4/6/8 节（工作流、命令速查、数据模型、set active-task 说明）。
- `docs/ASA-GUIDE.html`：命令/状态更新（CONTRIBUTING 要求）。
- `docs/CONTRIBUTING.md`：新命令清单补 search/list/link。
- `ASA-v3-changelife-design.md`：状态机章节标注 TASK 新增状态。

## 测试

沿用 `node:test` + 沙箱子进程模式（命令：`node --test engine/lib/*.test.js engine/commands/commands.test.js engine/hooks/hooks.test.js`，覆盖率 ≥80%）。

- 新 `engine/lib/similarity.test.js`：bigrams/dice/scoreReq/阈值。
- `similarity.test.js` 固定 normalize、标点归一化、空白处理、集合/多重集合规则和阈值边界。
- `engine/lib/state-machine.test.js`：TASK `awaiting-confirmation` 全转换。
- `engine/lib/changelog.test.js`：`awaiting-confirmation` 触发版本递增。
- `engine/commands/commands.test.js` 新增：
  - `search-req` 召回排序；`list-req` 输出。
  - `add-req` 高相似（>90%）→ 拒绝创建、exit 1；`--allow-similar` 记录豁免原因；`link-task` 写 linkedReqs 并递增版本。
  - `record-changes` 幂等记录 changedFiles、路径归一化、版本递增、changeLog 审计和 validate 闭环；**非 pending/in_progress 状态报错拒绝**。
  - TASK `in_progress → awaiting-confirmation → completed` 全流程；confirm/reject/**cancel-task** 三出口专用命令流转与审计；**通用 status 对 awaiting 三出口均阻断**；非法跳转拒绝。
  - `set active-task` 拒绝 awaiting-confirmation 任务。
  - **写锁并发互斥**：沙箱派生两个子进程并发 `add-req`，第二个因抢占锁失败非零退出、不覆盖已有 matrix，测试后锁文件自愈被清除。
  - **写锁租期边界**：活跃 PID 的锁即使超过 10 秒也不能被抢占；已死亡且超过 10 秒的锁可接管；已死亡但未超过 10 秒的锁先阻断；`EPERM` 视为 PID 存活。
  - `plan-tasks` 就绪/阻塞/拓扑序、awaiting-confirmation 阻塞下游（仅过滤两端为 TASK 且 type=depends 的边）。
  - reconcile schemaVersion 3 回填 `linkedReqs/changedFiles`。
  - `validate --json` 输出固定 schema 结构断言。
- `engine/hooks/hooks.test.js` 新增：check-work-order 结构化读取任务状态、对 awaiting-confirmation 活跃任务 deny、对 `.asa/**`/`docs/**` allow、对冻结状态未知路径 deny；本地允许的环境/输入异常 fail-open、未知目标路径冻结时不放行、资产损坏 fail-closed、CI 异常 fail-closed；diagnose/session-start.js 冒烟（stdout 含 `[ASA STATUS]` 且前后文件 mtime 不变）。
- **Hook 分层测试**：PreToolUse 只验证路径/状态/已有资产；PostToolUse 对写入后的坏 YAML 执行恢复或 `invalid-write`/partial 标记；CLI 写命令在无 Hook 环境下仍执行版本和节点契约校验。
- **冻结白名单 × 自动 compile 联调**：activeTask 处于 awaiting-confirmation 时，改写 `.asa/nodes/*.yaml` 并执行 compile 写 `docs/03-tasks.md` → 断言 100% 放行成功；同时向 `engine/` 或业务 `.js` 源码写任意字节 → 断言 Hook Fail-Closed 拦截。
- **`deprecate` 级联矩阵用例**：对 §⑩ 每种端点组合（3×3 端点 × 3 种 type）各写至少一条级联/不级联断言，含 REQ→ARCH、REQ→REQ、TASK→TASK(refines/extends)、无 type legacy 等边界。
- ⑦ 自动文档测试：compile 生成 `03-tasks.md`（含 linkedReqs/depends 关系渲染）；compile 后 00/02 叙述与 `ASA-BASED-ON` 保持不变；改节点 → reconcile/validate 报"架构文档过期"，更新 `ASA-BASED-ON` 后消除；`update-overview` 输出含结构骨架 + 变更摘要 + lessons 附注。
- `validate` 测试 blockingErrors/warnings 聚合、`--json` 输出和 deliveryType 豁免；编译型 digest 只覆盖 01/03。
- `doctor` 测试 schema/engineVersion 匹配和旧引擎拒绝写入。

## 更新路径（真实项目）

实现后：`node install.js claude` + `node install.js gemini` 刷全局 → 每个项目重跑 `/asa init` 刷 `.asa` + hooks + SessionStart → `node .asa/index.js reconcile` 迁移到 schemaVersion 3。

## 验证

1. 跑全量测试命令，确认全部通过、覆盖率 ≥80%。
2. 手动沙箱流程：建沙箱 → `add-req` 两条近似需求，第二条应被 >90% 门拒绝 → 使用受控豁免或 `search-req` 召回第一条 → `link-task`/`record-changes` → 任务走 `in_progress → awaiting-confirmation` → `confirm-task` 或 `reject-task`，确认闭环能刷新 docs → `diagnose` 输出 `AwaitingConfirmation: N` 且不写盘。
3. `node .asa/index.js validate` 输出追溯告警（孤儿任务等）且 exit 0。
4. SessionStart 冒烟：直接运行 `node .asa/hooks/session-start.js`（喂 stdin JSON）确认输出 `[ASA STATUS]`，且运行前后 matrix/nodes/docs 内容和 mtime 不变。
5. ⑦ 自动文档：建沙箱 → 造若干 REQ/ARCH/TASK + edges → `update-overview` 输出结构摘要 → 模拟模型重写 00/02 + 更新 `ASA-BASED-ON` → 再改节点 → reconcile 报"架构文档过期" → 跑 compile 确认 01/03 更新、00/02 保留。

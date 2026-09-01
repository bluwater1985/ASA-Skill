# to-tickets — 任务拆解 / 垂直切片（ASA 增量方法）

> **加载规则**：本文件是 ASA 的「任务拆解」增量方法。平时【不加载】；**只有当用户明确要求开始任务拆解 / 拆任务 / 拆 tickets / 做实施任务切片时，才读取本文件并严格执行**（严禁凭记忆跳步简写）。
> 一旦被触发，本文件全部约束成为本会话的活跃约束；会话结束后自动失效，下次需重新触发。
>
> 对应 CLI：`node .asa/index.js add-task` / `edge add` / `link-task` / `plan-tasks` / `set active-task`。产出物落盘于 `.asa/nodes/tasks/TASK-xxx.yaml` 与 `matrix.yaml` 依赖边。

---

## 流程

### 1. 收集上下文
从对话 / Spec（必要时读取已落盘的 REQ 节点 `spec` 与 `acceptanceCriteria`）/ plan 出发，理解要拆解的对象。

### 2. 探索 codebase（可选）
若尚未探索，先理解代码现状。寻找可 **prefactor（前置重构）** 的机会，让实现更易做——「先把改动变容易，再做容易的改动」。

### 3. 起草垂直切片（Tracer-Bullet）
把工作拆成 **tracer-bullet 垂直切片** ticket，遵循：

- 每个切片切透一条**窄而完整**的路径，覆盖所有层（Schema、API、UI、tests）——是**垂直**切片，不是某单一层的横向切片。
- 一个完成的切片可**独立演示 / 自动验证**。
- 每个切片大小能装入**单个新 context window**。
- 任何前置重构（prefactoring）应独立为**先行**的 ticket。
- 为每个 ticket 声明其**阻塞边**（必须先完成的前序 ticket）；无阻塞的 ticket 可立即开始。

**宽重构（Wide Refactor）例外**：当一次机械性改动（改名、重类型化共享符号等）的爆炸半径横跨整个 codebase，单次 edit 会瞬间破坏海量调用点、没有垂直切片能保持绿色时，不要硬套垂直切片，改用 **expand–contract** 序列：
- **Expand（TASK 1）**：并行引入新形态/符号，新旧并存，什么都不破坏。
- **Migrate（TASK 2..n）**：按爆炸半径分批（按包、按目录）迁移调用点，每批一个 ticket、被 Expand 阻塞，逐批保持 CI 绿色（因旧形态仍在）。
- **Contract（TASK n+1）**：再无调用者时物理删除旧形态，此 ticket 被所有 migrate 批次阻塞。
- 若即便分批也无法各自保持绿色，保留该序列，让它们共享一个集成分支，共同阻塞一个最终的 **integrate-and-verify** ticket（仅在此处承诺绿色）。

### 4. 【拆解后交用户确认】← 关键步骤（to-tickets 特有，必做）
把拆解结果以**编号清单**呈现给用户，每条展示：
- **Title**：统一 `<ID> - <名称>`（如 `TASK-003 - 实现登录接口`）；「名称」用**动词开头**讲"做什么"、可验收
- **Blocked by**：必须先完成的其它 ticket（无则为「None — can start immediately」）
- **What it delivers**：该 ticket 让哪段端到端行为可用（用户视角，而非逐层实现清单）

并向用户确认：**颗粒度是否合适（过粗/过细）？阻塞边是否正确（每条仅依赖真正 gate 它的 ticket）？是否需要合并或进一步拆分？**
**迭代直到用户批准拆解方案**，方可落盘。此步骤不可跳过——它正是防止「计划级错误在动工后才暴露」的关键闸门。

### 5. 将已批准的 tickets 落盘为 ASA TASK 节点 + 依赖边 + 关联
按用户批准的方案逐一落盘（**严禁"先建空节点、再手工回填"**——description/inputs/outputs 必须一次写全）：
- **准备各 ticket 内容**：`description` 写入 `.asa/specs/<ticket>.md`；`inputs` / `outputs` 可各写一个"每行一条"的文件，也可直接逗号分隔传参。
- **建节点（全量字段一次写入）**：`node .asa/index.js add-task "<标题>" --desc .asa/specs/<ticket>.md --inputs <文件|a,b> --outputs <文件|c,d> --req <REQ-xxx> --by <操作人>`（生成 `TASK-xxx`，状态 `pending`，`description/inputs/outputs/linkedReqs` 一次落盘）
- **绑依赖边**：`node .asa/index.js edge add <from> <to> --type depends`（前置强环路检测）
- **关联需求**：已在 `--req` 写入 `linkedReqs` 的 ticket 无需再调 `link-task`；如需补关联继续用 `link-task <TASK-xxx> <REQ-xxx>`
- **编排拓扑**：`node .asa/index.js plan-tasks` 输出 Kahn 拓扑就绪序列（就绪 / 待确认 / 被阻塞 / 建议执行序）

> **忠实转录**：`description` 必须**逐字保留**给用户确认的那份 ticket 交付描述，禁止缩写/概括/删细节；有几条 `inputs` / `outputs` 就写几条，禁止用占位省略。AI 有"为省 token 压缩"的倾向，这里必须**宁可写长，不可写短**。

> 落盘时按依赖序（blockers 在前）推进，避免孤儿 ticket。不要修改 / 关闭任何父级需求节点。

### 6. 认领 Frontier 并实现
**开发时只在 Frontier（无 blockers 的就绪最前线）认领并激活任务**：
`node .asa/index.js set active-task <TASK-xxx>`，单任务实现 → 跑通测试 → `record-changes` → `status <id> awaiting-confirmation` → 交架构师 `confirm-task` / `reject-task` 审核通过后才进入下一任务。一个切片一个切片地做，每次清空上下文。

---

## 落盘任务节点（YAML 骨架）

> 引擎的 YAML 解析器**不支持块标量 `|`**（GEMINI.md 铁律），`description` 用**引号多行串**（`\n` 转义）存储；推荐直接用 `add-task --desc <文件>` 写入，命令自动处理转义。

```yaml
id: TASK-001
title: "<名称>"  # 统一显示为 `<ID> - <名称>`，如 `TASK-003 - 实现登录接口`；名称用动词开头讲"做什么"
status: pending
version: 1
inputs: []
outputs: []
linkedReqs:
  - REQ-001
changedFiles: []
description: "<该 ticket 的端到端交付描述，用户视角；务必逐字保留给用户确认的版本，禁止压缩>"
changeLog: []
pendingPropagation: []
```

> 完成本方法（或用户未再要求继续）后，方法自动失效；后续拆分需重新触发。

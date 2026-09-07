# ASA 问题记录深化蓝图：to-issues 增量方法 + add-issue 详情承载引擎改造

> 更新日期：2026-08-23
> 执笔：AI Software Architect (ASA)
> 基线：针对「add-issue 建出的 ISSUE 节点只有 id / title / linkedTask，description 恒为空、缺失前因后果」这一痛点，补齐问题记录的方法论规则与引擎落盘入口，并打通「记问题 → 拆修复任务」的连贯流水线。
> 核心目标：新增 rules/to-issues.md 增量方法（与 to-spec / to-tickets 平级、按需加载），并给 add-issue 补齐详情承载的 --desc 运载工具，按问题类别分级衔接 to-tickets / to-spec，从根本上解决「issue 太简单」。
> 本文档为设计蓝图（方案稿），不直接改动引擎；批准后再进入实施。

---

## 一、现状与问题陈述（为什么这样做）

### 1.1 用户观察到的现象
- 通过 add-issue 新建的 ISSUE 节点只有 id、title、linkedTask，description 为空，没有问题详情、前因后果、复现步骤、影响面。

### 1.2 根因（代码实证）
- schema 本来就支持详情：engine/commands/add.js 的 ISSUE 模板自带 description 字段；ISSUE 节点与 REQ/TASK 一样，description 支持多行存储。不是装不下，是没入口。
- 命令缺运载工具：add-issue 的参数解析只有 --category/--severity/--req/--task/--arch，没有 --desc/--description。--desc 目前只被 add-task 消费。因此 add-issue 建的 issue 必然 description 为空。
- 反例：自动升 ISSUE 的路径（reject、confirm 门禁被拒、status 返工）都已带 description（如 reject.js 写入「任务 X 被驳回，原因…」）。说明引擎不是不能存，只是 add-issue 命令没有暴露。
- 命名规范契合：ISSUE 标题只讲「现象 + 受影响场景、不预设修复」；前因后果、根因、影响面天然属于 description / 结构化字段。当前缺的正是这一层。

### 1.3 缺的不是"新字段"，而是"规则 + 命令入口"的组合
- 只加规则：LLM 有指引但无落盘入口，add-issue 仍写不进 description → 问题依旧。
- 只加命令：有入口但无法保证「记录时按要求写全」→ 依赖每次人工输入。
- 结论：规则（方法论）与命令入口（运载工具）必须一起做，才是治本。

---

## 二、目标 / 非目标

### 目标
1. 新增 rules/to-issues.md：问题记录的统一方法论（现象/场景/复现/预期 vs 实际/影响/根因/处置），与 to-spec / to-tickets 平级、按需加载。
2. 给 add-issue 补齐 --desc（兼容"文件路径或内联字符串"，与 add-task --desc 行为一致），根治 description 恒空。
3. 建立分级衔接：bug → 完整记录后按 to-tickets 拆修复任务；requirement-clarification → 走 to-spec 改/补需求；observation/risk → 轻量记录观察。
4. 详情真值源唯一：落 .asa/nodes/issues/<id>.yaml 的 description，compile 渲染进 docs/04-issues.md，不另起平行文档。

### 非目标
- 不改 ISSUE 状态机（open→triaged→in_progress→resolved→verified 不动）。
- 不改变自动升 ISSUE（reject/confirm/status）的既有行为（本就带 description）。
- 不做大规模 schema 改版（不新增一堆零散结构化字段，保持单 description 大字段的扩展性与低侵入）。
- 不强制所有问题（含 trivial observation）都跑完整 to-tickets 仪式。

---

## 三、设计决策（ADR）

### [ ] ADR-1: 新增 rules/to-issues.md 增量方法（并行于 to-spec / to-tickets）
- 决策：仿照 to-spec.md / to-tickets.md，新增 rules/to-issues.md。平时不加载，仅当用户明确要求「记录/新增问题」「报 bug」「记 issue」「把这个问题归档」时读取并严格执行，会话结束自动失效。产出物落 .asa/nodes/issues/ISSUE-xxx.yaml。
- 理由：与既有「增量方法库按需加载」机制完全对称，避免常驻污染上下文；同时把「怎么记问题」固化成可执行、可审计的方法。

### [ ] ADR-2: 引擎 add-issue 补齐 --desc 运载工具（根因修复）
- 决策：在 add.js 的 issueOpts 中加入 desc，解析 --desc（可选 --description 别名）；在 ISSUE 分支写 node.description = existsOrInline(issueOpts.desc)。existsOrInline（add.js:84）支持「传文件路径 → 读文件正文」或「传内联字符串 → 直接用」，与 add-task --desc 完全一致。
- 理由：这是根治 description 恒空的关键；一份充分记录的问题详情可落 .asa/specs/<id>-issue.md 作可审阅真值源后 --desc 引用，也可直接内联。与 to-spec 的 --spec 精神一致。
- 兼容：--desc 缺省时保持现状（description 为空），不破坏旧调用；空 description 的观察类快速记录仍可用 add-issue "<标题>" --category observation。

### [ ] ADR-3: 详情用单一 description Markdown 大字段，不碎片化 schema
- 决策：to-issues 的「现象/复现/预期 vs 实际/影响/根因/处置」全部组织进 description 一份结构化 Markdown（带小标题），而不是拆成 reproSteps / rootCause 等多个 YAML 字段。
- 理由：保持 ISSUE 节点 schema 稳定（无需 schema 版本升级、无需 migrate）；与人直读、docs/04-issues.md 全文渲染天然契合；根因可能与复现都未定，Markdown 叙述更容忍。命名规范里"不预设修复"由规则保证（正文可含根因假设，但标题不写死方案）。

### [ ] ADR-4: 分级衔接 to-tickets / to-spec（分流管线）
- 决策（对应既有「分流处置」）：
  - bug → 完整记录（含复现/预期/影响/根因假设）→ 按 to-tickets.md 拆修复 TASK（用 --task/affects 关联）。
  - requirement-clarification → 不改 ISSUE 成修复工单，而是走 to-spec.md 改/补需求文档（REQ 节点），再以 requirement-update 结算。
  - observation / risk → 轻量记录现象，不强制拆任务；后续若要处置再升 bug / 建修复 TASK。
- 理由：避免「所有问题一刀切全拆任务」的过度工程；bug 才值得完整 to-tickets 仪式。

### [ ] ADR-5: 文档一致性对齐（顺手清理）
- 决策：rules/to-tickets.md:62-64 目前写「引擎 YAML 解析器不支持块标量 |」，但实证 engine/lib/yaml.js 已支持并在序列化侧用 |- 字面量块（blockScalarLines / consumeBlockScalar）。本方案落地时同步把该注解改为「description 直接以 |- 块存储，或用 add-task --desc <文件> 自动转义」，消除规则与引擎契约的矛盾。
- 理由：to-issues 模板将用 |- 块演示，若 to-tickets 仍写"不支持块标量"会自相矛盾，误导后续拆分。

---

## 四、新增文件：rules/to-issues.md（全文草案）

> 风格对齐 to-spec.md / to-tickets.md：# 标题 + 「加载规则」引用块 + 核心原则 + 流程 + 模板/骨架。

```markdown
# to-issues — 问题记录 / 问题归档（ASA 增量方法）

> **加载规则**：本文件是 ASA 的「问题记录」增量方法。平时【不加载】；**只有当用户明确要求记录/新增问题、报 bug、记 issue、把某个问题归档进问题管理时，才读取本文件并严格执行**（严禁凭记忆跳步简写）。
> 一旦被触发，本文件全部约束成为本会话的活跃约束；会话结束后自动失效，下次需重新触发。
>
> 对应 CLI：`node .asa/index.js add-issue` / `status ISSUE-xxx`。产出物落盘于 `.asa/nodes/issues/ISSUE-xxx.yaml`，`compile` 渲染进 `docs/04-issues.md`。

---

## 核心原则

1. **不采访**：不向用户反复提问采访，基于对话上下文与 codebase 现状自主合成问题描述。
2. **标题只讲现象，不预设修复**：ISSUE 标题 = 「现象 + 受影响场景」（如 `登录偶发500（手机端用户）`）；**标题绝不写死解决方案**（如不要叫 `修复登录500`）。
3. **详情要完整，宁可写长不可写短**：`description` 必须承载前因后果，禁止只写标题、禁止缩写压缩。AI 有"为省 token 压缩"的倾向，这里必须**宁可写长，不可写短**。
4. **忠实转录**：若从某段讨论/评审结论整理而来，`description` 需逐字保留关键现象与原始证据（日志、报错、复现步骤），禁止二次概括丢信息。
5. **分级处置**：记录后**先判断类别**再决定后续动作——bug → 拆修复任务；requirement-clarification → 改需求文档；observation/risk → 观察即可。

## 流程

### 1. 归类（category）与定级（severity）
- `add-issue "<标题>" --category <bug|requirement-clarification|observation|risk> --severity <P0-P3>`
- 默认 `observation / P2`；明确是功能缺陷 → `bug`；需求表述不清 → `requirement-clarification`；潜在风险 → `risk`。

### 2. 撰写完整 description（问题记录模板，`|-` 块，章节齐全）
按下方模板组织一份**结构化 Markdown**，写入 `.asa/specs/<ISSUE-ID>-issue.md`（可审阅真值源）后 `--desc` 引用，或直接内联传参。模板章节（缺什么如实说明，**不留无意义占位**）：

```markdown
## 现象 (Symptom)
直接影响下，用户/系统看到了什么、哪里坏了。

## 受影响场景 (Affected Scenarios)
哪条路径/哪个用户/哪端会踩中；事件窗口、频率、影响面。

## 复现步骤 (Repro Steps)
最小可复现的步骤；贴关键日志/报错/截图路径（存证据而非贴大段堆栈）。

## 预期 vs 实际 (Expected vs Actual)
期望行为 vs 实际行为的差异。

## 影响 (Impact)
受影响的功能面、数据、可用性、涉及 REQ/ARCH/TASK。

## 根因假设 (Root-Cause Hypothesis)
当前证据指向的根因假设（未证实则写明"待排查"），以及排查方向。
```

### 3. 落盘（真正把详情写进去）
`node .asa/index.js add-issue "<标题>" --category <...> --severity <...> --desc <文件|内联串> [--req <REQ>] [--task <TASK>] [--arch <ARCH>] [--by <操作人>]`
- `--desc` 支持文件路径（自动读正文）或内联字符串；ISSUE 节点 `description` 一次写全，**严禁"先建空节点再手工回填"**。
- `--req/--task/--arch` 自动写 `affects` 边。

### 4. 分流（关键，按类别决定下一步）
- `bug` → 确认根因方向后，**按 `.asa/rules/to-tickets.md` 把修复拆成 TASK**（建修复 TASK 并 `--task`/`affects` 关联回本 ISSUE）。
- `requirement-clarification` → 按 `.asa/rules/to-spec.md` 改/补需求（REQ 节点），再以 `requirement-update` 结算本 ISSUE。
- `observation` / `risk` → 不强制拆任务，登记观察即可；后续确需处置再升 bug 或建修复 TASK。

### 5. 状态推进（ISSUE 状态机）
`status ISSUE-xxx open→triaged→in_progress→resolved→verified`；`→resolved` 须 `--note "<处置>"`；非问题用 `wontfix`。

## 落盘节点（YAML 骨架）

```yaml
id: ISSUE-001
title: "登录偶发500（手机端用户）"   # 现象+受影响场景，不预设修复
status: open
version: 1
category: bug                      # bug | requirement-clarification | observation | risk
severity: P1                       # P0-P3
description: |-
  现象：...（分章节 Markdown，见模板，前因后果完整）
resolution: null
linkedReqs: []
linkedTasks:
  - TASK-001   # 修复 TASK，affects 边
linkedArch: []
changeLog: []
pendingPropagation: []
```

## 完成本方法的时机
完成记录并落地分流动作（或用户未再要求继续）后，本方法自动失效；后续记录新问题需重新触发。
```

---

## 五、引擎改动点（具体清单，批准后实施）

### engine/commands/add.js
1. **issueOpts 增加字段**（add.js:135）：从 { category, severity, req, task, arch } 扩展为 { category, severity, req, task, arch, desc }。
2. **参数解析增加分支**（add.js:139-159 循环内）：新增
   ```js
   else if (a === '--desc' || a === '--description') { issueOpts.desc = next(); }
   ```
   （与现有 --desc 消费互不冲突：taskOpts.desc 只在 p === 'TASK' 分支生效，issueOpts.desc 只在 p === 'ISSUE' 分支生效。）
3. **ISSUE 分支写入 description**（add.js:275-295 内，add-issue 段落）：
   ```js
   if (issueOpts.desc) node.description = existsOrInline(issueOpts.desc);
   ```
   existsOrInline（add.js:84）已具备「文件路径读正文 / 内联直用」能力，直接复用。
4. **（可选增强，需归档支撑）** 若走「.asa/specs/<ISSUE-ID>-issue.md 真值源」路线，仿 add-req --spec（add.js:252-265）在 ISSUE 分支归档原文件：mkdirSync('.asa/specs') + writeFileSync(.asa/specs/<id>-issue.md, sourceText)。建议：--desc 指向存在的文件时归档该文件为可审阅真值源；内联时仅写节点。

### 说明（不动的部分）
- engine/lib/issue.js 的 createIssue 已接受 opts.description，无需改；reject/confirm/status 自动升 ISSUE 已带描述，保持不动。
- compile.js 渲染 docs/04-issues.md 已读 ISSUE 节点（含 description），无需改。
- 无需 schema 版本升级 / migrate。

---

## 六、与既有流程的衔接

| 环节 | 现状 | 本方案后 |
|------|------|----------|
| add-issue | 无 --desc，description 恒空 | 支持 --desc，详情一次写全 |
| 问题详情真值源 | 缺失 | .asa/specs/<id>-issue.md（可选归档）+ 节点 description |
| 文档渲染 | docs/04-issues.md 已支持 | description 全文进文档（不另起平行文档） |
| bug 处置 | 铁律说"建修复 TASK"，但无方法指引 | 明确走 to-tickets.md 拆 TASK |
| 需求澄清 | — | 走 to-spec.md 改需求，requirement-update 结算 |
| observation/risk | — | 轻量记录，不强制拆任务 |

---

## 七、验证 / 测试（TDD，批准后补测）

在 engine/commands/issue.test.js 基础上新增用例：
1. add-issue "<标题>" --category bug --desc "多行\n详情" → 读回 .asa/nodes/issues/<id>.yaml，断言 description 完整等于输入（含 \n 换行、#、: 不被压扁）。
2. add-issue "<标题>" --desc .asa/specs/<file>.md → 断言读文件正文写入，且 <file> 归档为 <id>-issue.md（若采用增强）。
3. 无 --desc 时 description === ''（兼容性，不回归）。
4. --desc 与 --task 并存 → description 与 affects 边同时写入。
5. existsOrInline 对「不存在的路径」按内联字符串处理（与 add-task 一致）。
6. --category banana --desc x → 仍被 category 校验拦截（add.js:278-284），不写盘。
7. reconcile 后 description 块标量幂等（|- 往返不丢数据）。

---

## 八、影响与风险

- 低风险：纯增量改动；--desc 缺省行为不变，不破坏既有测试与旧调用。
- 文档一致性的坑：rules/to-tickets.md 的「不支持块标量」注解与引擎实现矛盾（ADR-5），需同步清理，否则 to-issues 的 |- 模板会与旧文档冲突误导实施。
- 规则按需加载的依赖：to-issues 生效依赖模型在"用户要求记问题"时主动读取；这与 to-spec/to-tickets 的既有触发机制一致，无需新机制。
- 过度工程风险：已通过「分级」缓解——只有 bug 强制完整 to-tickets，observation/risk 轻量。

---

## 九、实施步骤（Step-by-Step，批准后执行）

- [ ] Step 1：新增 rules/to-issues.md（第四节内容，含模板与骨架）。
- [ ] Step 2：engine/commands/add.js 加 --desc（issueOpts + 解析 + ISSUE 分支写入）。
- [ ] Step 3：（可选增强）add-issue --desc <文件> 归档 .asa/specs/<id>-issue.md。
- [ ] Step 4：同步清理 rules/to-tickets.md:62-64 的块标量注解。
- [ ] Step 5：在 engine/commands/issue.test.js 补齐第七节用例，跑通全套测试。
- [ ] Step 6：更新 skill 说明/GEMINI.md 的「增量方法库」段，登记 to-issues 触发词（「记录/新增问题」「报 bug」「记 issue」）。
- [ ] Step 7：check-work-order 白名单确认（.asa/specs/ 与 docs/ 是否可写）——.asa/specs/ 需确保无 activeTask 时也放行记录问题，必要时同 docs/ 一并白名单。

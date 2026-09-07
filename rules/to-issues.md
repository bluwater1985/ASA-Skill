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

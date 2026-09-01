# to-spec — 需求分析 / 需求规格化（ASA 增量方法）

> **加载规则**：本文件是 ASA 的「需求分析」增量方法。平时【不加载】；**只有当用户明确要求开始需求分析 / 需求拆解 / 需求规格化时，才读取本文件并严格执行**（严禁凭记忆跳步简写）。
> 一旦被触发，本文件全部约束成为本会话的活跃约束；会话结束后自动失效，下次需重新触发。
>
> 对应 CLI：`node .asa/index.js add-req` / `search-req`。产出物落盘于 `.asa/nodes/requirements/REQ-xxx.yaml`。

---

## 核心原则

1. **不采访**：绝对禁止对用户进行繁复提问采访。必须基于当前上下文与 codebase 深度探索，**自主合成**出饱含高规格、高环路的 Spec。
2. **领域术语**：Spec 全文贯穿使用项目领域术语表词汇；尊重所改动区域的 ADR。
3. **判重优先**：落盘前先 `search-req` 或相似度比对。`score >= 0.3` 打印候选给用户判断；`score > 0.9` 拦截，需 `--allow-similar <REQ-ID> --reason "<理由>" --by <操作人>` 三件套特批豁免（审计留痕于节点 `allowSimilar`）。

## 忠实转录铁律（防 AI 压缩，必须遵守）

把 Spec 写入 `.asa/specs/<源>.md` 时，**必须**：

- 与当场合成的完整内容**逐字一致**，禁止缩写、概括、换词、删细节、合并条目；
- 每条 User Story、每条 Implementation Decision、每条 Testing Decision、每个 Out of Scope、全部 Further Notes **原样保留**，有几条写几条；
- 验收标准 `- <条目>` 逐字书写，禁止改写措辞；
- 严禁用 "none" 或无意义占位来省略本条应承载的信息（确实为空时才写 none）；
- 明确认知：AI 有"为省 token 压缩"的倾向，此处必须**宁可写长，不可写短**。

## 流程

1. **探索仓库**：理解目标特性所要落地的区域与现状（若尚未探索）。
2. **拟定测试接缝（Seams）**：Sketch 出要在其上测试该特性的 seam。优先复用现有 seam，尽量用**最高层 seam**，越少越好（理想为 1）；如确需新增，尽可能在最高点提出。**与用户确认这些 seams 是否符合预期**。
3. **编写并展示完整 Spec**：严格按下方模板产出完整 Spec Markdown，并把完整结果**展示给用户**——这份富文本就是最终要落盘的内容（不要再另写一份精简版）。
4. **落盘（忠实转录，禁止二次概括）**：
   a. 把完整 Spec 写入 `.asa/specs/<源>.md`（可审阅、可复用的唯一真值源）。若你有验收标准，追加到该文件末尾的 `## Acceptance Criteria` 章节，一条 bullet 一条（`- <标准>`）。
   b. 执行 `node .asa/index.js add-req "<标题>" --spec .asa/specs/<源>.md --priority <P1|P2|P3> --by <操作人>`。
   c. `add-req --spec` 会**原样**把文件正文（`## Acceptance Criteria` 之前部分）逐字写入节点 `spec`，把该章节下的 bullet **逐字**解析为 `acceptanceCriteria` 数组，并归档 `.asa/specs/<id>.md`；随后自动登记并 `compile`。
   d. **严禁**用"先 add-req 建空节点、再手工回填"的旧方式——那正是 Spec 被压缩丢失的根源。

## Spec 模板（必须完整包含以下全部章节）

```markdown
## Problem Statement

用户视角下正在面对的问题与痛点、以及其价值。

## Solution

用户视角下对该问题的解决方案。

## User Stories

一份【长且多】的编号用户故事清单，覆盖该特性的所有角度，每条格式：
1. As an <actor>, I want a <feature>, so that <benefit>

（示例：As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending）

## Implementation Decisions

已作出的实现决策列表，可包含：
- 将被构建/修改的模块
- 将被修改的模块接口
- 来自开发者的技术澄清
- 架构决策、Schema 变更、API contracts、具体交互

【不要】写具体文件路径或整段代码（会很快过时）。
例外：若原型产出了比文字更精确表达决策的片段（状态机、reducer、schema、类型形状），可将决策核心内联并注明源自原型，只保留决策精华，非可运行 demo。

## Testing Decisions

测试决策列表，包含：
- 什么是好测试（只测外部可观测行为，严禁测内部实现细节）
- 哪些模块将被测试
- 测试的先例（codebase 中同类测试）

## Out of Scope

本 Spec 明确不覆盖（非本次目标）的内容。

## Further Notes

任何其他关于该特性的补充备注：已知 tradeoff、遗留的 open question、后续跟进项、给未来读者（impact / propagate / 后续拆解）的背景与隐含前提。

⚠️ 此节为必备章节：凡不适合归入上述六类却重要的信息，必须归入此处，严禁硬塞进 Solution / Implementation Decisions。
```

> **验收标准落盘**：如需让 `acceptanceCriteria` 也随源文件忠实落盘，就在源文件末尾追加 `## Acceptance Criteria` 章节，下面每条一个 bullet（`- <标准>`）；`add-req --spec` 会自动逐字解析。不要另起炉灶改写验收标准措辞。

## 落盘格式

> **推荐**：`spec` 与 `acceptanceCriteria` **一律通过 `add-req --spec <源.md>` 落盘**，由命令把源文件正文原样写入，你无需手工维护该 YAML 字段的转义。

注意：引擎的 YAML 解析器**不支持块标量 `|`**（GEMINI.md 铁律），所以节点内 `spec` 以**引号多行串**（`\n` 转义）存储，命令自动处理。手写节点时使用如下等价的引号形式：

```yaml
id: REQ-001
title: "<名称>"  # 统一显示为 `<ID> - <名称>`，如 `REQ-001 - 用户登录`；名称用名词短语讲"能力/价值"，不说怎么做
status: proposed
version: 1
priority: P2
acceptanceCriteria:
  - "<验收标准1>"
  - "<验收标准2>"
spec: "## Problem Statement\n...\n## Further Notes\n..."
changeLog: []
pendingPropagation: []
```

> 完成本方法后：如无后续任务拆解指令，则本次需求分析到此结束，方法自动失效。

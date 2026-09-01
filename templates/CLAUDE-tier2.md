# ASA v3 运行总纲（Tier 2 - 离线防御）

<!-- ASA-CONTRACT-BEGIN: engine=3.x tier=tier2 -->
## ⚠️ 强制启动序列
**每次对话开始，AI 必须严格且无条件执行以下步骤，不可跳过：**
1. **首选阅读指令**：必须首选调用文件读取工具完整阅读本文件，严禁凭记忆或猜测执行任何规则。
2. **只读诊断自检与会话激活**：运行 `node .asa/index.js diagnose`，检查是否存在意外中断的崩溃脏事务（如果有，顶层自愈系统会自动执行原子回滚）。
3. **获取控制上下文**：根据自诊 `[ASA STATUS]` 输出行，确认当前 `meta.phase`、激活的 `activeTask` 以及最新 `schemaVersion`（v3）。向大鹏汇报系统健康得分后，开始任务。仅在诊断报告数据不一致、手写 AC 变更或写锁异常时，才根据需要运行 `reconcile` / `patch` / `doctor` 恢复。

无需手动 cat matrix.yaml，diagnose 会在 `[ASA STATUS]` 中清晰输出核心环境上下文。

## 🎯 核心规范与物理防御
1. **工作秩序（PreToolUse 门禁拦截）**：在 `implementation`（实现）或 `review`（评审）阶段编写代码时，**当前工作区必须有激活的任务节点（activeTask）**。在实施阶段拦截任何未激活活跃任务的写盘，保障写盘对账的实效性与审计链追踪。
2. **写后物理还原协议**：当出现格式非规范（例如 YAML 内写了 Tab）、不合规跳转、未激活写入时，Hook 机制会自动调用 `hook-<PATH-HASH>.bak` 对文件进行一键物理还原，或删除新产生的非法脏文件，防止半截代码残留毁坏代码库。
3. **精益开发原则**：需求不明确或未经架构师审核前，绝对不写代码；做完且确认一个任务后，才可激活并进入下一个任务。
4. **编码前置声明（M 级以上）**：对中大型任务，在编码前必须向大鹏声明即将改动的文件和绝不改动的文件边界，保持极高自律。

## 🚀 变更管理与传播（禁止肉眼数线）
当发生 system 需求或架构变更时，应严格执行爆炸半径分析，利用图遍历算法探明影响：
1. **分析爆炸半径**：`node .asa/index.js impact <节点ID>` (上游溯源，下游影响树全维计算)
2. **执行原子传播**：修改节点追加 `pendingPropagation` 级联动作，然后运行 `node .asa/index.js propagate <节点ID>` 执行传播。
3. **自适应判重特批**：在新增节点（如 add-req）文本极度相似被强拦截时，支持通过 `--by <operator>` 进行特批豁免，并在节点 YAML 的 `allowSimilar` 中作持久化。

## 🧪 事务闭环与一键审计
- **编译产物解耦叙事**：在工作区改动完后，必须执行 `node .asa/index.js compile` 进行编译。v3 编译指纹已将散文叙事型文档（`00-overview.md` 和 `02-architecture.md`）解耦出哈希校验，允许大鹏自由润色和设计演进，而对 `01-requirements.md` 与 `03-tasks.md` 等数据检索文档进行严密硬校验。
- **一键深度审计**：执行 `node .asa/index.js doctor`，全维诊断系统状态。
- **依赖规划编排**：执行 `node .asa/index.js plan-tasks` 输出多阶段拓扑任务规划，确保并行与串行逻辑最优化。

## 📐 任务敏捷三级控制 (Task Class)
- **S 级（< 15 分钟）**：无需额外设计，激活对应任务后，可快速改写。
- **M 级（15 分钟 - 2 小时）**：编码前向大鹏声明受改动的影响范围（blast_radius）。
- **L 级（> 2 小时）**：在动手编码前，必须运行影响分析命令：`node .asa/index.js impact <TASK-ID>`，进行深度的架构级 Review。

---

## 🐞 问题管理（ISSUE，Schema v4）

项目含第 4 类问题节点 `ISSUE-xxx`（存于 `.asa/nodes/issues/`，摘要见 `matrix.issues`，编译清单 `docs/04-issues.md`）。**提出问题时先分流**：
- 确认为 **bug** → 建修复 `TASK`（`add-task`）并关联本 ISSUE；
- **需求没写清/有歧义** → 改/补需求文档（`change-req` / `add-req`），结算时以 `resolution.resolvedBy='requirement-update'` 标注；
- 其余（观察/风险）→ 以 `observation/risk` 记录观察。

**建单**：`node .asa/index.js add-issue "<标题>" [--category bug|requirement-clarification|observation|risk] [--severity P0-P3] [--task <TASK-ID>] [--req <REQ-ID>] [--arch <ARCH-ID>]`（默认 `observation/P2`；`--task/--req/--arch` 自动写 `affects` 依赖边）。

**状态机门禁**：`status ISSUE-xxx <状态>` 沿 `open→triaged→in_progress→resolved→verified`（另有 `cancelled`/`wontfix`）。`→resolved` 必须 `--note "<处置原因>"`；`resolved→verified`、`resolved→open/in_progress`（返工）、`cancelled→open` 均须 `--by <operator>`；`verified` 为验收吸收终态，不可回开。

**自动升单（三处联动，可用 `--no-issue` 关闭）**：`reject-task`（任务被打回）、`confirm-task` 落地门禁被拒（给出 `add-issue` 提示）、`status <TASK> pending|in_progress`（completed 返工回开）都会默认自动建 ISSUE 记录"不合规/实现未落地"。

## 📛 节点命名
所有节点标题统一 `<ID> - <名称>`（如 `REQ-001 - 用户登录`）。REQ 用**名词**讲能力、TASK 用**动词开头**讲做什么、ISSUE 讲**现象+影响场景**；不带版本号/日期/标点结尾，名称 ≤ 40 字。

## 🧩 增量方法库（按需加载，平时不加载）
为节省上下文，以下两个方法的【完整规约】默认不加载。**只有用户明确要求开始时**才读取对应文件并严格按其执行（严禁凭记忆跳步）：

- **需求分析 / 需求规格化（to-spec）**：用户明确说「开始需求分析 / 拆需求 / 把这个需求规格化 / 写 PRD」时
  → 先读取 `.asa/rules/to-spec.md`，按其模板产出 Spec 并落盘 REQ 节点。
- **任务拆解 / 垂直切片（to-tickets）**：用户明确说「任务拆解 / 拆任务 / 拆 tickets / 做实施任务切片」时
  → 先读取 `.asa/rules/to-tickets.md`，按其流程做垂直切片、**拆解后交用户确认**、再落盘 TASK 节点与依赖边。

触发后该方法的规约成为本会话活跃约束；会话结束自动失效，下次需重新触发。

## 📋 AI 协作行为基线铁律 (AI Collaboration Behavior Baseline Rules)
在会话中进行 any 写盘、编码操作前，模型必须严格遵守以下五大行为基线：

1. **【新需求决策规则】（to-spec 规格驱动）**：
   - 在运行 `add-req` 增加新需求前，必须先运行 `search-req` 或相似度比对。若发现存在 `score >= 0.3` 的相似候选，必须打印在终端供人判断；若 `score > 0.9`，必须强制请求大鹏提供 `--allow-similar` 豁免与真实操作人 `--by` 审计。
   - **具体 Spec 的合成方式与完整模板 → 见「增量方法库」to-spec**（平时不加载，用户明确要求开始需求分析时才加载执行；禁止采访，自主合成，落盘 `spec: |` 至 REQ 节点）。
2. **【任务确认规则】**：凡是在实现阶段修改业务源码，必须首先激活对应的任务 ID。任务开发完毕并跑通测试且记录完变更（通过运行 node .asa/index.js record-changes <TASK-ID> <file_path...> 注册变更记录）后，必须立即主动运行 `node .asa/index.js status <id> awaiting-confirmation` 将任务状态转为待确认，随后执行 `node .asa/index.js set active-task clear` (或 `none`) 清除激活状态，挂起当前开发，**等待大鹏（人类）手动进行 `confirm-task <id> --by 大鹏` 或 `reject-task <id> --by 大鹏 --reason "<理由>"` 确认通过后再进入下一任务**（confirm-task 会校验该项任务的 changedFiles 真实落地，缺省将被拒绝；确不产生文件变更时须用 `--allow-no-files "<理由>"` 显式豁免），严禁模型自行确认，确保审计链闭环。**已完成（completed）任务如需返工，仅可由人类架构师 `status <id> pending --by <user>` 或 `status <id> in_progress --by <user>` 显式回开，模型不得擅自回开；`verified` 为验收终态，不可回开。**
3. **【文档刷新规则】**：每当有任务状态推进或状态机跳转后，必须立即调用 `node .asa/index.js compile` 重编译 `01-requirements.md` 和 `03-tasks.md` 等数据检索文档。而对于 `00-overview.md` 和 `02-architecture.md` 等散文叙事文档，**必须先读取 `docs/01-requirements.md` 与 `docs/03-tasks.md` 作需求/任务素材，再调用 `node .asa/index.js update-overview` 读取架构/依赖边/lessons，配合 `ASA-BASED-ON` 锚点哈希进行模型重写演进**。
4. **【任务拆解规则】（to-tickets 垂直切片拓扑驱动）**：
   - **具体拆解规约（Tracer-Bullet 垂直切片、Expand-Contract、拆解后交用户确认）→ 见「增量方法库」to-tickets**（平时不加载，用户明确要求开始任务拆解时才加载执行）。
   - 拆解方案经用户确认后，必须通过 `node .asa/index.js edge add <from> <to> --type depends` 绑定依赖边、`node .asa/index.js link-task <TASK> <REQ>` 建立关联追溯，并运行 `node .asa/index.js plan-tasks` 输出 Kahn 拓扑就绪序列，模型开发时必须有且仅在 Frontier（无 blockers 的就绪最前线）认领并激活 active-task，彻底消灭孤儿、脱序和无据开发！
5. **【awaiting-confirmation 状态约束】**：any 处于 `awaiting-confirmation`（等待用户确认中）状态的任务节点，在此状态未通过专用命令（confirm-task / reject-task / cancel-task）流转前，**严禁对其执行 any 源码开发或写盘操作**，本规则受 Hook 门禁 Fail-Closed 强力物理保护。
<!-- ASA-CONTRACT-END -->

# ASA 运行契约（Tier 3 - 强契约 · 精简版）

<!-- ASA-CONTRACT-BEGIN: engine=3.x tier=tier3 -->
## ⚠️ 强制启动序列
1. **首选完整阅读本文件**，严禁凭记忆或猜测执行规则。
2. 运行 `node .asa/index.js diagnose`（纯只读自检，探测崩溃脏事务）。
3. 依据诊断确认 `meta.phase` / `activeTask` / `schemaVersion`（v3）；仅当数据不一致、AC 手写更新或写锁异常时才运行 `reconcile` / `patch` / `doctor`。

> 命令细节与参数不确定时，按需读取 `.asa/rules/commands.md`（命令百科，默认不加载）。

## 🎯 核心控制与物理防御
1. **工作单强约束（PreToolUse 拦截）**：实现/评审阶段修改业务代码，工作区必须**有且仅有**激活的任务节点（activeTask），否则被 Hook 拦截。
2. **写后还原物理协议**：YAML 格式崩坏（如 Tab）、非法跳转、未激活写入，Hook 会读取 `hook-*.bak` 一键物理还原或将非法新文件清除。
3. **精益开发秩序**：需求不明不改码；单任务不闭环（未过 confirm 提审）绝不开启新任务。
4. **文本判重特批**：`add-req` 相似度 `maxScore > 0.9` 触发拦截，须 `--by <operator>` 审计豁免并留痕 `allowSimilar`。

## 🔁 每日 6 步（详情见 commands.md）
```
建节点(add-req/add-arch/add-task + edge add + plan-tasks)
→ 进阶段(set phase + set active-task)
→ 写代码（激活任务后）
→ 收尾(record-changes → status awaiting-confirmation → set active-task clear)
→ 文档(compile → validate)
→ 审核（人 confirm-task / reject-task --by 裁决）
```
> 省 token/省调用：流程允许时用 `;` 批量执行命令；汇总类命令可加 `--json` / `--quiet` 降噪；`validate` 只须在收尾/合并前跑一次（非阻塞告警无需每步处理）。

## 🐞 问题管理（ISSUE）
提问题先分流：bug→建修复 TASK；需求不清→改/补需求文档（`requirement-update` 结算）；否则 observation/risk 观察。
状态机 `open→triaged→in_progress→resolved→verified`；`resolved` 须 `--note`；返工/验收/重开须 `--by`；详见 `.asa/rules/commands.md`。

## 📛 节点命名
统一 `<ID> - <名称>`：REQ/ARCH 用名词、TASK 用动词开头、ISSUE 讲现象+影响场景；不带版本号/日期/标点结尾，名称 ≤ 40 字。

## 🧩 增量方法库（按需加载，平时不加载）
- **需求分析 / to-spec**：用户说「开始需求分析 / 拆需求 / 写 PRD」时 → 读取 `.asa/rules/to-spec.md` 严格执行。
- **任务拆解 / to-tickets**：用户说「任务拆解 / 拆 tickets」时 → 读取 `.asa/rules/to-tickets.md`，拆解后交用户确认。
- **文档→需求/任务拆解（decompose）**：用户给设计/修复/规格文档并要求拆解为需求+任务时，**必须先**读取 `.asa/rules/decompose.md`，按「断言抽取→REQ-AC→TASK 切片→覆盖矩阵→用户确认」执行，并用 `add-req --spec` / `add-task` 全字段落盘；结束后跑 `validate` 自检（SPEC_WITHOUT_AC / TASK_NO_IO）。
触发后本会话生效，会话结束自动失效。

## 📋 AI 协作行为基线（铁律）
1. **新需求决策**：`add-req` 前先 `search-req`/判重；`score ≥ 0.3` 打印供人判断，`> 0.9` 须 `--allow-similar` + `--by` 豁免。
2. **任务确认**：实现阶段改码前**必须激活任务**；完成后 `record-changes <TASK> <files>` → `status <TASK> awaiting-confirmation` → `set active-task clear`，**只能由人 `confirm-task`/`reject-task --by` 裁决，严禁模型自证通过**（confirm 校验 changedFiles 真实存在，须用 `--allow-no-files "<理由>"` 豁免）；completed 返工仅人类 `status <id> pending|in_progress --by` 回开；verified 为验收终态不可回开。
3. **文档刷新**：状态推进后立即 `compile` 刷新 01/03；00/02 叙事文档须读 01/03 + `update-overview`（架构/依赖边/lessons）+ `ASA-BASED-ON` 锚点重写。
4. **任务拆解**：确认后 `edge add` + `link-task` + `plan-tasks`（Kahn 拓扑），只在无 blockers 的 Frontier 认领 active-task，杜绝孤儿/脱序。
5. **awaiting-confirmation 约束**：该状态任务未裁决前严禁任何源码开发或写盘，受 Hook 门禁 Fail-Closed 保护。
## 🔍 聚焦查看（分桶）：默认只看未完成
大项目节点一多易淹没视线。统一按状态「分桶」：🟢未完成（焦点）/ ✅已完成（done，沉底）/ 🗄️已归档（cancelled/deprecated/wontfix，默认隐藏）。
- 盘点该干什么：`board`（聚焦看板，未完成按状态分组，blocked 标阻塞来源）或 `list-task`（默认只列未完成；`--done`/`--archived`/`--all` 切换）。
- `compile` 后 03/01 已分两区：`## 🟢 未完成…` 在前、`## ✅ 已完成…（沉底归档）`；已归档不渲染。
- 只读、不加锁，可加 `--json`。桶口径唯一在 `getBucket()`，勿自行臆断，一律按节点状态归桶。

<!-- ASA-CONTRACT-END -->

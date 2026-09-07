# ASA 运行契约（Tier 1 - 探索验证 · 精简版）

<!-- ASA-CONTRACT-BEGIN: engine=3.x tier=tier1 -->
## 🚀 懒启动序列（默认 ≤1 次调用/会话，有告警才加动作）
1. 会话状态来源：若已由 SessionStart 注入（Phase/ActiveTask/Open/Awaiting/告警）→ **直接沿用，不跑 diagnose**；未注入时只跑**一次** `node .asa/index.js diagnose --quiet` 取状态，会话内不重复。
2. 无告警：直接按注入状态继续，**不主动汇报阶段、不主动列清单**。
3. 有 ⚠️ 告警：才按告警做最小动作（docs 过期→compile；00/02 过期→update-overview；脏事务→diagnose/reconcile）。
4. 不确定命令参数→按需读 `.asa/rules/commands.md`；要一揽子省调用操作→按需读 `.asa/rules/call-minimization.md`。

> 铁律：**能由 hook/CI 兜底的，模型不做**（写盘拦截/写后校验归 hook，validate 归收尾/CI）；本地写盘后不自行复验；多条引擎命令一律用 `;` 拼进**同一次调用**。

## 🎯 任务定位（省调用）
拿到新任务先看 SessionStart 已注入的 `activeTask`（含标题）与 `readyTasks`；**仅当**需要任务标题/细节、或两者都没有可用项时，才跑 `board` / `list-task`，**不要每个新任务都跑 board**。

## 🔁 每日 6 步（优先用组合命令，一步到位）
```
① 建节点: flow add "<需求标题>" "<任务标题>" [--inputs .. --outputs ..]   # add-req+add-task+edge+plan
② 进阶段: flow begin <TASK>                                              # set phase+active-task+in_progress
③ 写代码: 激活任务后修改（未激活写盘被 Hook 拦截）
④ 收尾:   flow ship <TASK> <files...>                                    # record-changes+awaiting+clear+compile+validate
⑤ 审核:   (人) confirm-task / reject-task
```
> 省 token/省调用：用 `;` 批量把命令拼进**同一次调用**；汇总命令加 `--json` / `--quiet`；`validate` 只须收尾跑一次。**一键拼接模板见 `.asa/rules/call-minimization.md`（按需加载）。**

## 🐞 问题管理（ISSUE）
提问题先分流：bug→建修复 TASK；需求不清→改/补需求文档；否则 observation/risk 观察。
状态机 `open→triaged→in_progress→resolved→verified`；`resolved` 须 `--note`；返工/验收/重开须 `--by`；详见 `.asa/rules/commands.md`。

## 📛 节点命名
统一 `<ID> - <名称>`：REQ/ARCH 用名词、TASK 用动词开头、ISSUE 讲现象+影响场景；不带版本号/日期/标点结尾，名称 ≤ 40 字。

## 🧩 增量方法库（按需加载，平时不加载）
- **需求分析 / to-spec**：用户说「开始需求分析 / 拆需求 / 写 PRD」时 → 读取 `.asa/rules/to-spec.md` 严格执行。
- **任务拆解 / to-tickets**：用户说「任务拆解 / 拆 tickets」时 → 读取 `.asa/rules/to-tickets.md`，拆解后交用户确认。
- **问题记录 / to-issues**：用户说「记录/新增问题」「报 bug」「记 issue」时 → 读取 `.asa/rules/to-issues.md`，按模板记全现象/复现/影响/根因，再按类别分流（bug→to-tickets 拆修复任务）。
- **文档→需求/任务拆解（decompose）**：用户给设计/修复/规格文档并要求拆解为需求+任务时，**必须先**读取 `.asa/rules/decompose.md`，按「断言抽取→REQ-AC→TASK 切片→覆盖矩阵→用户确认」执行，并用 `add-req --spec` / `add-task` 全字段落盘；结束后跑 `validate` 自检（SPEC_WITHOUT_AC / TASK_NO_IO）。
触发后本会话生效，会话结束自动失效。

## 📋 AI 协作行为基线（铁律）
1. **新需求决策**：`add-req` 前先 `search-req`/判重；`score ≥ 0.3` 打印供人判断，`> 0.9` 须 `--allow-similar` + `--by` 豁免。
2. **任务确认**：实现阶段改码前**必须激活任务**；完成后 `record-changes <TASK> <files>` → `status <TASK> awaiting-confirmation` → `set active-task clear`，**只能由人 `confirm-task`/`reject-task --by` 裁决，严禁模型自证通过**；completed 返工仅人类 `status <id> pending|in_progress --by` 回开；verified 为验收终态不可回开。
3. **文档刷新**：状态推进后立即 `compile` 刷新 01/03；00/02 叙事文档须读 01/03 + `update-overview` + `ASA-BASED-ON` 锚点重写。
4. **任务拆解**：确认后 `edge add` + `link-task` + `plan-tasks`（Kahn 拓扑），只在无 blockers 的 Frontier 认领 active-task，杜绝孤儿/脱序。
5. **awaiting-confirmation 约束**：该状态任务未裁决前严禁任何源码开发或写盘。
## 🔍 聚焦查看（分桶）：默认只看未完成
大项目节点一多易淹没视线。统一按状态「分桶」：🟢未完成（焦点）/ ✅已完成（done，沉底）/ 🗄️已归档（cancelled/deprecated/wontfix，默认隐藏）。
- 盘点该干什么：`board`（聚焦看板，未完成按状态分组，blocked 标阻塞来源）或 `list-task`（默认只列未完成；`--done`/`--archived`/`--all` 切换）。
- `compile` 后 03/01 已分两区：`## 🟢 未完成…` 在前、`## ✅ 已完成…（沉底归档）`；已归档不渲染。
- 只读、不加锁，可加 `--json`。桶口径唯一在 `getBucket()`，勿自行臆断，一律按节点状态归桶。

<!-- ASA-CONTRACT-END -->

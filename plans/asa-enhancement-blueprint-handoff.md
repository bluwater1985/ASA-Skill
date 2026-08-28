# ASA 施工蓝图：终审复核交接说明

> 对象文件：`plans/asa-enhancement-blueprint.md`
> 状态：已收束为 **8 个独立微型 PR**；终审 Plan 的必做项均有唯一归属。

## 本轮修改

| 位置 | 修改 | 原因 |
|---|---|---|
| 依赖图与步骤结构 | Step 9–11 合并回 Step 6/8 | 用户要求 8 个可冷启动执行的 PR；保留 11 步会造成重复施工。 |
| Step 1 | 补跨文件事务、备份/恢复与 `partial` 诊断 | 单文件 `renameSync` 不能独自保证多文件命令的一致性。 |
| Step 2 | 纳入 `deprecate` 级联取消矩阵和组合测试 | 当前 `deprecate.js` 正向 BFS 会取消所有下游 TASK，违反终审 Plan ⑩。 |
| Step 6 | 纳入只读 SessionStart、Claude 幂等注册与 Gemini 同步 | 它直接依赖 `diagnose`/文档锚点，是同一个只读边界。 |
| Step 8 | 纳入模板、usage、公开文档和 E2E | 这些事项必须基于前 1–7 步的最终命令契约验收。 |

## 执行约定

- Step 1/2/4/6/7 可并行；Step 3 依赖 Step 1/2；Step 5 依赖 Step 3/6；Step 8 最后合入。
- `deprecate` 只级联 `TASK→TASK depends`、`REQ/ARCH→TASK depends` 和后者的无 type legacy 边；`refines`/`extends` 永不级联，`linkedReqs` 不隐式成为图边。
- 全部写命令在入口持锁；活 PID 的锁绝不可因超过 10 秒被抢占，`EPERM` 视为存活，仅 `ESRCH` 视为死亡。
- Hook 白名单仅 `.asa/**` 和 `docs/**`。冻结条件为 activeTask 为空/`(none)`，或状态为 `awaiting-confirmation`、`completed`、`verified`、`cancelled`；CI 全 Fail-Closed。
- `confirm-task`、`reject-task`、`cancel-task` 均须追加审计、递增版本并 compile；不得只更新 `confirmation` 字段。

## 验收结论

本轮发现并修正两项阻塞性蓝图问题：步骤数与用户要求不一致，以及 `deprecate` 终审矩阵缺少施工归属。蓝图现可从 Step 1 开始实施；不得再拆出 Step 9–11，也不得将当前无条件 BFS 级联当作合格实现。

# ASA 增强方案：逐步施工蓝图与执行计划 (Construction Blueprint)

> 方案状态：**最终锁定版 (Final Architectural Freeze)**  
> 施工指南：本蓝图将庞大的 ASA v3 增强方案拆分为 **8 个独立的、面向 AI 的物理施工步骤**。每个步骤都包含“独立上下文简报”、“极简任务清单”、“跑测验证指令”及“退出判据”，供后续任何 AI 智能体“零关联、冷启动”独立执行。

---

## 🗺️ 施工依赖图与执行顺序

```text
Step 1 (并发写锁、原子写入与事务恢复) ──┐
                                          ├─→ Step 3 (确认/打回命令) ───┐
Step 2 (状态机、取消与 deprecate 矩阵) ─┘                             │
                                                                        ├─→ Step 5 (追溯链与 record-changes) ─┐
Step 4 (确定性检索与查重硬拦截) ───────────────────────────────────────┘                                      │
Step 6 (只读诊断、自动文档、SessionStart) ──────────────────────────────────────────────────────────────────┤
Step 7 (Schema 3 迁移、版本卫兵与 doctor) ────────────────────────────────────────────────────────────────────┤
                                                                                                               └─→ Step 8 (Validate、Hook、模板、文档与 E2E)
```

> ⚠️ **顺序/依赖提示**：
> - **Step 5 依赖 Step 6 的 03 渲染**：`record-changes`/`link-task` 会"自动 compile 刷新 `03-tasks.md`"，而 03-tasks 渲染由 Step 6 的 compile 扩展提供。因此 Step 6 必须先合入；否则 Step 5 不得宣称其自动文档刷新已完成。
> - Step 8 必须最后合入：它将 Hook、双平台模板、对外文档和全量验收固定到前 1–7 步已经交付的最终命令契约。
> - 每个 Step 都是"零关联冷启动"的独立 PR，退出判据达成即可合并；跨 Step 的接口契约以 `ASA-enhancement-plan.md` 为准。

---

## 🚀 步骤详解与执行卡点

### Step 1: 底层物理写锁及原子写入机制实现 (Physical Write Lock & Atomic Write Engine)

- **独立上下文简报**：
  为防范多进程、多会话并发写冲突，需在对外命令入口上锁。必须实现一个本地 `.asa/lock` 物理排他锁，包含 PID 与时间戳。必须实现超时自愈与跨平台 PID 存活检测。所有写入操作统一通过 `.tmp` 临时文件中转加 `fs.renameSync` 原子替换。
- **任务清单 (TASK LIST)**：
  1. [ ] 在 `engine/lib/` 目录下（或新增模块）实现写锁管理器 `lock.js`：
     - 上锁：创建 `.asa/lock` 写入当前进程 `process.pid` 和当前 `Date.now()`。
     - 检查存活：采用原生无外部依赖的 `process.kill(pid, 0)`：
       - 若无异常，或抛出 `EPERM`（无权限），均判为进程**存活**。
       - 若捕获 `ESRCH` 异常，判为进程**已消亡**（陈旧锁）。
     - 超时自愈：若锁存在，读取 PID。若 PID 存活，不论锁年龄多大，**一律禁止抢占**并阻断退出；若 PID 已死且锁年龄超过 10 秒（`10000ms`），允许原子删除并接管；若 PID 已死但年龄未满 10 秒，阻断提示稍后（防进程退出与清理竞态）。
     - 锁释放：提供可靠的 `try/finally` 锁文件物理擦除方法。
  2. [ ] 在 `engine/index.js` CLI 路由分发后、具体命令执行前进行**原子加锁**，并在退出前释放锁。覆盖所有既有与新写命令（confirm/reject/cancel/link-task/record-changes）。不在底层 `saveMatrix` 中重复加锁以支持内部嵌套。
  3. [ ] 封装原有的文件写盘逻辑：所有 nodes、matrix 和编译型 docs 的物理落盘，必须采用先写临时文件（如 `*.yaml.tmp`、`*.md.tmp`），写入成功后再调用 `fs.renameSync()` 原子覆盖物理文件。
  4. [ ] 实现跨文件写事务约定：`link-task`、`record-changes`、`confirm-task`、`reject-task`、`cancel-task`、`status` 以及 `deprecate` 的写锁须覆盖完整流程；写前保留可恢复基线/备份，所有目标先写临时文件后统一替换。任一步失败必须恢复基线，或留下明确可由 `diagnose` 报告的 `partial` 未完成事务，禁止静默损坏。
- **跑测验证指令**：
  - 编写单测或在 `engine/commands/commands.test.js` 中新增**并发互斥测试**：
    `node --test engine/commands/commands.test.js`（沙箱并发派生两个子进程执行 `add-req`，验证第二个进程由于抢占锁失败报非零退出码，不覆盖 matrix 且锁自愈）。
- **退出判据**：
  - [ ] 锁文件的 PID 存活逻辑在 win32 和 unix 下 100% 跑通，`EPERM` 误判阻断问题已修复。
  - [ ] 锁文件抢占超时（10s）边界判定正确（活进程不抢占，死进程满 10s 接管，死进程未满 10s 等待）。
  - [ ] 所有写操作均通过原子替换（renameSync）落盘，无裸直接写原始文件。
  - [ ] 多文件命令失败时不会留下静默半写；`diagnose` 能报告可恢复 partial 状态。

---

### Step 2: 状态机拓展、`cancel-task` 与 `deprecate` 级联矩阵实现 (Lifecycle Expansion, cancel-task & deprecate Matrix)

- **独立上下文简报**：
  在 TASK 状态机中新增 `awaiting-confirmation` 状态，这是任务完成到完成确认之间的缓冲带。新增取消命令 `cancel-task` 并阻断通用的 `status` 入口；同时将现有 `deprecate` 从“任意下游 TASK 都取消”的 BFS 改为终审冻结的边类型级联矩阵。
- **任务清单 (TASK LIST)**：
  1. [ ] 在 `engine/lib/state-machine.js` 中更新 TASK 状态流转网络：
     - 新增状态 `awaiting-confirmation`。
     - 允许流转路径：`in_progress → awaiting-confirmation`。
     - 允许流转路径：`awaiting-confirmation → completed`（confirm 专属）。
     - 允许流转路径：`awaiting-confirmation → in_progress`（reject 专属）。
     - 允许流转路径：`awaiting-confirmation → cancelled`（cancel 专属）。
  2. [ ] 在 `engine/lib/changelog.js` 的 `isStatusChange` 数组中添加 `'awaiting-confirmation'`，使其状态流转能正确递增版本并记录审计日志。
  3. [ ] 新建取消指令文件 `engine/commands/cancel.js`，导出 `{ run }` 并在 `index.js` 注册为 `cancel-task`：
     - 命令格式：`cancel-task <TASK-ID> --by <user> --note "..."`。
     - 限制：目标必须存在，且当前状态必须为 `awaiting-confirmation`（否则报错/幂等返回）。
     - 行为：流转 TASK 状态为 `cancelled`。向 TASK 节点的 `confirmation` 审计区中写入 `status: cancelled`、取消原因、取消人和时间戳。
     - 安全：**仅当 `activeTask === targetTask` 时才执行 `clear active-task`**；否则保持 activeTask 不变。
  4. [ ] 修改 `engine/commands/status.js`：
     - **状态硬拦截**：若 TASK 当前状态为 `awaiting-confirmation`，对 `completed` / `in_progress` / `cancelled` 的流转**一律报错阻断**，强制要求模型走 confirm/reject/cancel 专用命令。
      - 必须保留 `in_progress → awaiting-confirmation` 的正常入口，并打印“等待用户确认”的提示。
    5. [ ] 重构 `engine/commands/deprecate.js`：只允许通过下列矩阵级联 `cancelled`，且级联唯一入口为 `deprecate`：
      - `TASK → TASK` 且 `type === depends`：级联；
      - `REQ/ARCH → TASK` 且 `type === depends`，或无 type 的 legacy 边：级联；
      - `refines` / `extends`（包括 TASK→TASK）永不级联；无 type 仅 REQ/ARCH→TASK 兼容级联，其余组合默认 `extends` 且不级联；
      - 仅 TASK 可以写入 `cancelled`；`linkedReqs` 不是 graph edge、不得触发隐式级联；已完成/已验证 TASK 若状态机拒绝取消，保留并输出人工处理信息。
- **跑测验证指令**：
  - 运行 `node --test engine/lib/state-machine.test.js` 和 `engine/lib/changelog.test.js`。
  - 在 `commands.test.js` 验证 `cancel-task` 成功执行并生成 confirmation 字段，并覆盖 `in_progress → awaiting-confirmation` 正常入口。
  - 对 `deprecate` 写端点组合测试：TASK→TASK depends 级联，REQ/ARCH→TASK depends 与 legacy 级联，`refines`/`extends` 不级联，以及非 TASK 永不写 cancelled。
- **退出判据**：
  - [ ] 状态机单测通过，非法状态跳转被拒绝。
  - [ ] 通用 `status` 命令无法直接把 `awaiting-confirmation` 任务转为 completed。
  - [ ] `cancel-task` 写入的 `confirmation.status` 为 `cancelled`，且 activeTask 匹配安全清除。
  - [ ] `deprecate` 严格按终审级联矩阵执行，不再因无关 BFS 下游误取消 TASK。

---

### Step 3: 任务审核机制 `confirm-task` 与 `reject-task` 命令实现 (Task Confirmation & Rejection Commands)

- **独立上下文简报**：
  实现核心的确认（`confirm-task`）和打回（`reject-task`）命令，使任务审核流程从流程上规范化并产生物理审计日志，在完成时自动触发编译和 active-task 清除。
- **任务清单 (TASK LIST)**：
  1. [ ] 新建确认指令文件 `engine/commands/confirm.js`，注册为 `confirm-task`：
     - 命令格式：`confirm-task <TASK-ID> --by <user> --note "..."`。
     - 限制：目标 TASK 存在且当前状态必须为 `awaiting-confirmation`（否则拒绝）。
     - 行为：将状态转为 `completed`；在 TASK 的 `confirmation` 元数据写入 `status: confirmed`、确认人、确认备注与时间戳；**仅当 `activeTask === <TASK-ID>` 时执行 `clear active-task`**；操作完成后自动触发 `compile`。
  2. [ ] 新建打回指令文件 `engine/commands/reject.js`，注册为 `reject-task`：
     - 命令格式：`reject-task <TASK-ID> --by <user> --note "..."`。
     - 限制：目标 TASK 存在且当前状态必须为 `awaiting-confirmation`（否则拒绝）。
     - 行为：将状态转为 `in_progress`；在 TASK 的 `confirmation` 元数据写入 `status: changes-requested`、打回人、修改意见与时间戳；保持 activeTask 状态不变。
  3. [ ] 修改 `engine/commands/set.js`：`set active-task` 如果检测到目标任务状态为 `awaiting-confirmation`，直接报错拒绝（提示需先由用户确认或打回）。
- **跑测验证指令**：
  - 在 `commands.test.js` 编写 awaiting → completed 全流程测试用例。
- **退出判据**：
  - [ ] `confirm-task` 执行后任务变 completed，产生 confirmed 审计，且清除对应的 activeTask 并自动 compile。
  - [ ] `reject-task` 执行后任务退回 in_progress，产生 changes-requested 审计，不影响 activeTask。
  - [ ] 无法将 `awaiting-confirmation` 的任务设为 active-task。

---

### Step 4: 确定性检索与查重硬拦截门槛实现 (Normalized Bigram-Dice Similarity & add-req Block)

- **独立上下文简报**：
  在不依赖任何外部 embedding 基建的前提下，实现字符级强归一化 Bigram-Dice 检索算法，拦截高度相似（>90%）的需求，并提供人工豁免参数。
- **任务清单 (TASK LIST)**：
  1. [ ] 新建检索计算模块 `engine/lib/similarity.js`（零依赖，纯函数）：
     - `normalize(text)`：强力归一化。统一转小写，剔除所有空白（空格、Tab、换行），剔除或替换中英文标点、破折号、括号和下划线（`，。？！；：, . ! ; : - _ ( ) （ ） [ ] 【 】 、` 等）。
     - `bigrams(text)`：对归一化文本提取二元组。
     - `dice(a, b)`：按多重集合（Multiset）求交集/并集比例，计算 Dice 系数。
     - `scoreReq(query, node)`：Dice 计算 title 加权（×2）加上 acceptanceCriteria/description 加权（×1）的组合得分。
     - `topCandidates(query, nodes, threshold)`：返回评分 ≥ 阈值的 `[{id, title, status, version, score}]`。
  2. [ ] 新建查询指令文件 `engine/commands/search.js`，注册为 `search-req`：输出排序后的候选列表。
  3. [ ] 新建紧凑清单指令 `engine/commands/list.js`，注册为 `list-req` / `list-task` / `list-arch`：用于展示极简状态列表。
  4. [ ] 升级 `engine/commands/add.js` 中的需求创建逻辑，建立**查重硬拦截门槛**：
     - 新增 REQ 时先算 `scoreReq`。
     - 打印出最高相似度（`maxScore`）≥ 0.3 的候选。
     - 若相似度 `maxScore > 0.9` 且未携带豁免参数，直接 **exit 1 拒绝创建**，打印被撞重节点、豁免引导。
     - **人工豁免通道**：支持 `add-req <title> --allow-similar <REQ-ID> --reason "..."` 参数。若带上此豁免，放行写入，并在 matrix/节点变更中记录被豁免节点、原因和操作者。
- **跑测验证指令**：
  - 运行新建的 `node --test engine/lib/similarity.test.js`（覆盖归一化、标点归一、边界情况）。
  - 在 `commands.test.js` 验证重名 add-req 阻断退出，及带 `--allow-similar` 成功写入。
- **退出判据**：
  - [ ] 归一化和 Bigram-Dice 算法通过 round-trip 测试。
  - [ ] `add-req` 高度重合（>90%）成功阻断并返回 exit 1。
  - [ ] 携带豁免参数和原因时，允许正常写入，且豁免数据记录完整。

---

### Step 5: 追溯链写入闭环 `link-task` 与 `record-changes` 实现 (Traceability: link-task & record-changes with Version Bumping)

- **独立上下文简报**：
  实现任务与需求之间的强关联（`link-task`）和代码改写文件列表录入（`record-changes`）。为了保持审计严密性和 digest 一致性，只要节点内容发生实质性变动，必须递增版本并更新文档/哈希。
- **任务清单 (TASK LIST)**：
  1. [ ] 新增关联指令文件 `engine/commands/link.js`，注册为 `link-task`：
     - 格式：`link-task <TASK-ID> <REQ-ID>`。
     - 限制：TASK 和 REQ 必须存在；TASK 状态非 `cancelled`；REQ 状态非 `rejected`/`deprecated`（否则拒绝）。
     - 行为：将 REQ 追加到 TASK 节点的 `linkedReqs`（幂等去重），**TASK 节点的版本（`version`）递增 1**，调用 `changelog.js` 追加一条审计日志，自动触发 `compile`，重算编译型哈希并写入 `matrix.yaml`。
  2. [ ] 新增记录修改文件指令 `engine/commands/record-changes.js`，注册为 `record-changes`：
     - 格式：`record-changes <TASK-ID> <file_path1> [file_path2] ...`。
     - 限制：TASK 存在且状态必须为 **`pending` 或 `in_progress`**（其余 awaiting/completed 终态一律硬拦截拒绝）。
     - 行为：路径格式化为 `/` 物理分隔符，追加到 TASK 节点的 `changedFiles` 列表中（幂等去重）。**TASK 节点版本（`version`）递增 1**，追加 changeLog 审计日志，调用 `compile`，重算编译型哈希写入 `matrix.yaml`，完成原子写闭环。
- **跑测验证指令**：
  - 在 `commands.test.js` 验证：调用 `record-changes` / `link-task` 后，对应的 TASK yaml 内容变更、版本和 changelog 增加，且 validate 哈希不报错。
- **退出判据**：
  - [ ] 冻结状态（awaiting）无法调用 `record-changes` 修改文件列表。
  - [ ] `record-changes` 与 `link-task` 执行后版本物理递增，变更记录正常记录，编译文档自动更新，无 digest 报警。

---

### Step 6: 自动文档、只读诊断与 `update-overview` 命令实现 (Auto-Docs, diagnose Read-Only & update-overview Command)

- **独立上下文简报**：
  实现纯只读的诊断器以支持 SessionStart 安全执行。支持编译型文档与手写叙事文档的解耦。实现 overview 指令。
- **任务清单 (TASK LIST)**：
  1. [ ] 在 `engine/commands/reconcile.js` 中重构出**独立的只读诊断逻辑**：
     - 支持 `node .asa/index.js diagnose` (或 `reconcile --readonly` 路由)。
     - **绝对只读约束**：仅加载 nodes、读取 matrix 结构、比对 digest 与 `ASA-BASED-ON` 锚点状况。**绝对禁止调用 `saveMatrix` 或写盘**。运行前后文件内容与 mtime 保持不变。
  2. [ ] 升级 `engine/commands/compile.js` 的编译逻辑，适配 `03-tasks.md` 的自动渲染（包含 linkedReqs 渲染和 depends 关系渲染）。
  3. [ ] 锁定 `engine/commands/patch.js` 的**反写范围边界**：
     - `patch` 仅且严格针对 `01-requirements.md` (requirements 类节点) 做反向同步解析。
     - **若传入的目标输入为 `03-tasks.md`，直接 no-op 跳过**，硬性阻断对任务文档的反写。确保 compile 正向编译和 patch 反向同步的格式标量不撞车。
  4. [ ] 新建文档总览读取指令 `engine/commands/overview.js`，注册为 `update-overview`：
     - **只读输出边界**：此命令仅抓取 nodes 骨架、ARCH edges 依赖图、自上次重写以来的节点增量、及 `lessons.yaml`，并以紧凑格式**打印输出到控制台**供模型参考重写，**自身绝对不写任何 `00-overview.md` 和 `02-architecture.md`**。
     - 模型手动改写 00/02 的叙述，并在文件头更新为当前的节点哈希：`<!-- ASA-BASED-ON: <nodesDigest> -->`。
  5. [ ] 新建 `engine/hooks/session-start.js` 并完成平台注册：
     - 读 stdin JSON 的 `cwd`，向上定位 `.asa/matrix.yaml`；运行 `diagnose`，输出 `[ASA STATUS]`、activeTask、`AwaitingConfirmation: N` 与 00/02 锚点过期提示；找不到项目根、解析失败或 index.js 缺失时静默 exit 0。
     - 严格只读：不得调用 `patch`、`saveMatrix` 或任何写路径；对 matrix/nodes/docs 内容与 mtime 写入回归测试。
     - 在 `clients/claude/.claude/skills/asa/SKILL.md` 的幂等安装逻辑中注册 `SessionStart`（`settings.local.json` 的 `matcher: startup`）；同步命令表。Gemini SKILL 只同步命令与规则，明确无 SessionStart 等价机制。
- **跑测验证指令**：
  - 运行 `reconcile --readonly` 确认其无任何写盘行为。
  - 编译 `03-tasks.md` 并验证 patch.js 不解析它。
  - 直接向 session-start 喂 stdin JSON，验证 stdout 含 `[ASA STATUS]` 和 `AwaitingConfirmation`，并断言前后 mtime 不变。
- **退出判据**：
  - [ ] diagnose 纯只读契约测试通过。
  - [ ] compile 编译后 00/02 内容及 `ASA-BASED-ON` 保持不变，01/03 正常刷新。
  - [ ] `patch` 排除 `03-tasks.md` 解析。
  - [ ] SessionStart 只读输出状态与架构文档过期提醒，Claude 注册幂等、Gemini 文档同步。

---

### Step 7: Schema 3 迁移、版本卫兵与 `doctor` 命令实现 (Schema 3 Migration, Version Guard & doctor Command)

- **独立上下文简报**：
  建立多入口版本守卫，阻止旧版引擎损毁 schema 3 的高版本项目。实现 Schema 2 → 3 迁移脚本，平滑处理旧 done 状态。实现一键 doctor 命令。
- **任务清单 (TASK LIST)**：
  1. [ ] 新建核心版本文件 `engine/version.js`，导出 `ENGINE_VERSION: "3.x"` 与 `MIN_SCHEMA_VERSION: 3` 等常量（为唯一可信版本源）。
  2. [ ] 新增一键项目诊断工具 `engine/commands/doctor.js`，注册为 `doctor`：
     - **纯只读**：检测本地项目的 schemaVersion 是否过高，检查 Hook 文件的物理存在性，检查 00/02 锚点，检测 nodes 库是否存在无 type 的 Legacy 边。
  3. [ ] 重构 `engine/commands/reconcile.js` 的数据迁移逻辑：
     - **Schema 2 → 3 幂等迁移**：备份 nodes/matrix/docs；补齐 TASK 节点的 `linkedReqs: []`, `changedFiles: []` 空数组（已存在的保留，不可覆盖）；将旧 TASK 的 `done` 状态平滑迁移至 `completed` 并输出状态转换清单；将 matrix 的 `meta.schemaVersion` 成功后升级为 `3`，注入 `meta.engineVersion: "3.x"`；重建摘要重算哈希。
  4. [ ] 建立**版本防线（旧引擎写入拦截）**：
     - 在 **所有写命令入口**（CLI 入口、`check-work-order` Hook、`validate-yaml` PostToolUse、`reconcile` 写盘前）强加校验。
     - 若读到项目的 `schemaVersion === 3` 但当前运行引擎不支持，物理阻断并抛出异常，提示用户跑 `node install.js` 或 `upgrade`。
- **跑测验证指令**：
  - 模拟老 Done 状态的 schema 2 矩阵，运行迁移后，检验状态被转换为 completed 且不破坏已有字段。
- **退出判据**：
  - [ ] 迁移具备完美的幂等性与可回滚备份。
  - [ ] 写路径版本防守在 CLI、Hook 和 PostToolUse 级全部封锁成功。
  - [ ] `doctor` 检测能正确扫描 Legacy 无 type 的依赖边。

---

### Step 8: 拓扑排序、Validate/Hook、双平台行为基线与交付验收 (Planning, Guardrails, Templates & E2E)

- **独立上下文简报**：
  提供任务依赖拓扑编排。重构 validate 指令支持 warnings 聚合。升级 BeforeTool / PreToolUse 钩子，加入**严格路径放行白名单**、Hook 校验职责分层与 Fail-Open 极端情况容错；最后把双平台模板、公开文档和端到端验收锁定为与实际命令一致的交付物。
- **任务清单 (TASK LIST)**：
  1. [ ] 新建任务编排计划指令 `engine/commands/plan.js`，注册为 `plan-tasks`：
     - Kahn 拓扑排序。**必须且仅过滤两端为 TASK 且 `type === "depends"` 的边**。
     - 状态判断：`awaiting-confirmation` 任务一律视为未完成并阻塞下游。
     - 输出：`ready`（可无障碍执行的任务）、`blocked-by`（被谁阻塞）以及建议执行的拓扑序列。
  2. [ ] 重构 `engine/commands/validate.js` 的错误流：
     - 引入 `blockingErrors = []` 与 `warnings = []`。聚合所有的漂移、过期和追溯校验，检查通过后再输出。有 blockingErrors 则 exit 1；无阻塞错误仅 warnings 时 exit 0（非阻塞）。
     - 支持 `validate --json`：输出预设 Schema 的强契约格式（status, blockingErrors, warnings, summary）。
     - 追溯豁免：对 `deliveryType === "document" 或 "constraint"` 的需求节点自动免报“悬空需求告警”。
  3. [ ] 重构 `engine/hooks/check-work-order.js`（PreToolUse 状态拦截器）——**严格白名单（不是源码后缀黑名单）**：
     - **放行白名单**：改写路径处于 `.asa/**` 目录（配置、写锁、nodes yaml等）或 `docs/**` 目录（编译 md 文档）时，**100% 豁免放行，绝不阻断**。
     - **其余路径冻结态一律拦截**：除 `.asa/**` 与 `docs/**` 外，冻结状态下其余项目路径一律按冻结规则拦截；**不使用“源码后缀(.js/.py...)黑名单”**，否则会漏放 `.env`、`.json`、`.yaml`、配置与非标准源码。
     - **判定优先级**：① 能确定路径且在 `.asa/**`/`docs/**`→放行；② 能确定路径且不在白名单→冻结态阻断；③ 无法确定目标路径或项目根→冻结态阻断未知写入（非冻结/非 implementation 阶段可兼容放行并打警告）；④ CI（`CI=true`）任何解析/定位/引擎异常→Fail-Closed。
     - **职责分层**：PreToolUse 只查路径/项目根/activeTask/已有资产可读性，**不宣称验证新 YAML**；PostToolUse/`validate-yaml` 读写入后内容做 YAML 与节点契约校验，失败恢复备份或写 `invalid-write`/partial 并阻止 validate 通过；CLI 写命令自身带版本与节点契约校验（不依赖 Hook 一定存在）。
     - **环境自适应 Fail-Open**：本地仅对环境/输入层异常（写锁抢占失败、陈旧锁、非目标文件读取故障、引擎路径丢失）以 warnings 放行；改写资产本身 YAML 损坏，或 CI 环境下，一律 Fail-Closed 拦截。
  4. [ ] 更新 `templates/CLAUDE-tier1.md` 至 `tier3.md` 与 `templates/gemini-tier1.md` 至 `tier3.md`：各 Tier 按篇幅包含新需求决策、任务确认、文档刷新与垂直任务拆解规则；TASK 状态列表加入 `awaiting-confirmation`。规则必须覆盖 `search-req`、受控 `--allow-similar`、`link-task`、`record-changes`、三专用确认命令、`update-overview`、`plan-tasks` 和 awaiting 任务每次汇报前提醒。
  5. [ ] 完成交付同步与收尾验收：更新 `engine/index.js` usage 以及 `README.md`、`docs/RUNBOOK.md`、`docs/ASA-GUIDE.html`、`docs/CONTRIBUTING.md`、`ASA-v3-changelife-design.md`；运行完整测试和手动沙箱流程（查重阻断/豁免、追溯、awaiting 三出口、只读 diagnose/SessionStart、文档锚点、deprecate 矩阵）。
- **跑测验证指令**：
  - 在 `hooks.test.js` 中模拟 awaiting-confirmation 状态并编译，断言 compile 成功放行，而源码改写拦截。
  - 测试拓扑排序的 depends 过滤。
  - 静态断言全部六个模板含 `awaiting-confirmation`、`confirm-task`、`plan-tasks`、`update-overview`；运行 `node --test engine/lib/*.test.js engine/commands/commands.test.js engine/hooks/hooks.test.js`，覆盖率 ≥80%。
- **退出判据**：
  - [ ] plan-tasks 排序输出准确，未受 refines/extends 边干扰。
  - [ ] validate blocking/warnings 聚合完成，warnings 不引发 CI 构建挂掉。
  - [ ] Hook 严格白名单工作正常，无 compile 写入死锁；未知路径在冻结态被拦截；CI 全 Fail-Closed。
  - [ ] 六份模板、usage 与对外文档和最终命令契约一致。
  - [ ] 全量测试通过、覆盖率 ≥80%；端到端验收覆盖终审 Plan 的所有关键闭环。

---

## 📌 通用实施注意（Claude 补充）

- 写锁覆盖含新增命令的**全部写命令入口**；confirm/reject/cancel 三命令**均须 `appendChangeLog` 递增版本**并自动 compile（不仅是写 `confirmation` 字段），保证与 status 流转一致、不破坏审计/digest 闭环。
- 所有节点/matrix/docs 写盘走 `.tmp` + `fs.renameSync` 原子替换；写命令先加写锁再用 `try/finally` 释放。
- 严格白名单 = `.asa/**` + `docs/**`；冻结态其余路径一律拦截，**不做源码后缀黑名单**；CI 全 Fail-Closed。
- 冻结条件必须显式实现为：`activeTask` 为空/`(none)`，或该任务状态属于 `awaiting-confirmation`、`completed`、`verified`、`cancelled`；白名单路径仍可供 ASA 自愈与 compile 写入。

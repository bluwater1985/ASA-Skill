# ASA v3 运行总纲（Tier 3 - 强契约）

<!-- ASA-CONTRACT-BEGIN: engine=3.x tier=tier3 -->
## ⚠️ 强制启动序列
**每次会话开始，AI 必须严格且无条件执行以下步骤，不可跳过：**
1. **首选阅读指令**：必须首选调用文件读取工具完整阅读本文件，严禁凭记忆或猜测执行规则。
2. **纯只读自诊校验**：运行 `node .asa/index.js diagnose`，探测是否有非正常退出的半写事务。
3. **获取控制上下文**：根据自诊 `[ASA STATUS]` 输出行，确认当前 `meta.phase`、激活的 `activeTask` 以及最新 `schemaVersion`（v3）。仅当自检提示数据不一致、AC 手写更新时才启动 `reconcile` / `patch` 反写对账自愈。

---

## 🎯 核心控制规约与物理防守
1. **工作单强约束（PreToolUse 拦截）**：在实现（`implementation`）或评审（`review`）阶段，修改业务代码或测试文件前，**工作区必须有且仅有激活的任务节点（activeTask）**。在实施阶段拦截任何未激活活跃任务的写盘，保障写盘对账的实效性与审计链追踪。
2. **写后还原物理协议**：一旦拦截发生、YAML 格式崩坏（如引入 Tab 字符）、或验证未通过，Hook 会智能寻找小写规整后的盘符 Hash 路径，读取 `hook-<PATH-HASH>.bak` 备份并一键执行原物理内容覆盖还原，或将非法新产生的文件物理清除，绝对阻断临时脏代码残留。
3. **精益开发秩序**：未明需求不改代码；单兵作战，单任务不闭环（未通过 confirm 提审）绝不开启新任务。
4. **文本判重特批**：新增节点（`add-req`）相似度 `maxScore > 0.9` 会触发拦截。确需特批时，必须通过在命令行添加 `--by <operator>` 指明豁免操作者，通过后此记录会自动持久化留存在节点 YAML 的 `allowSimilar` 中以备审计。

---

## 🚀 变更管理与级联传播（严禁肉眼数线）
1. **分析爆炸半径**：调用 `node .asa/index.js impact <节点ID>`，深度计算上游溯源依赖和下游影响。
2. **编排多阶段执行规划**：执行 `node .asa/index.js plan-tasks`，对所有非取消任务执行多阶段拓扑排序，生成并行与串行最优规划。
3. **级联幂等传播**：对源节点追加 `pendingPropagation` 级联指令，然后运行 `node .asa/index.js propagate <节点ID>` 执行传播，局部失败将保留为 `partial` 状态以便精准排障。

---

## 🧪 提审、CI 门禁与一键审计
1. **编译产物解耦叙事**：在工作区改动完后，必须执行 `node .asa/index.js compile` 进行编译。v3 编译指纹已将散文叙事型文档（`00-overview.md` 和 `02-architecture.md`）解耦出哈希校验，允许大鹏自由润色和设计演进，而对 `01-requirements.md` 与 `03-tasks.md` 等数据检索文档进行严密硬校验。
2. **一键全维健康审计**：执行 `node .asa/index.js doctor`，全面排查环路边、悬空依赖、任务孤岛与 YAML 合规性。
3. **会话收尾与 CI 门禁校验**：在每轮会话收尾或合并 PR 前，**必须**运行并 100% 通过：
   ```bash
   node .asa/index.js validate
   ```
   该命令会严密核验 md 指纹（解耦叙事型）、节点漂移、未完成级联传播。未通过则拒绝提交。

---

## 📐 任务敏捷三级控制 (Task Class)
- **S 级（< 15 分钟）**：无需额外设计，激活对应任务后，可快速改写。
- **M 级（15 分钟 - 2 小时）**：必须书面声明 inputs / outputs 边界。
- **L 级（> 2 小时）**：必须先运行 `node .asa/index.js impact <TASK-ID>`，输出爆炸半径树，交由大鹏进行硬核 Architecture Review，通过后方可执行。

---

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

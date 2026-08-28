# ASA v3 核心缺陷修复与一致性对账施工蓝图 (ASA v3 Repair & Refinement Blueprint)

> **版本**：v3.1.2-Repair-Blueprint (基于第十二轮双核审计报告)  
> **基线**：最新 `@ASA-code-review.md` 揭示的 2 个高风险问题 + 8 个待完成小项 + 分支覆盖率 ≥70% 达标路线  
> **目标**：以高契约、测试驱动（TDD）及零退化风险的形式，彻底解决嵌套事务、Hook 备份误删、特权旁路漏洞、并发PPID隔离、Gemini Skill 协议冲突等全部缺陷，将全库调至 100% 黄金发布状态。

---

## 📐 1. 总体架构约束 (Global Architectural Invariants)

为了将 ASA v3 的设计和工程品质推向 100% 毫无盲区的黄金标准高度，本轮缺陷修复必须死守以下五条最高优先级的技术红线：
1. **禁止嵌套事务 (No Nested Transactions)**：任何写命令（如 `reconcile`）在由 `index.js` 统一启动的顶层事务下运行时，必须复用已有 `activeTxId`。禁止擅自调用 `beginTransaction()` 覆盖全局事务上下文，保障全生命周期原子性。
2. **Fail-Closed 物理防护 (Fail-Closed Safety)**：物理拆除任何基于 `process.env.ASA_INTERNAL_WRITE` 的虚假特权旁路放行逻辑。宿主或子进程对代码文件的所有写入，必须 100% 通过 check-work-order 的状态机强匹配守卫，严堵一切提权越过拦截。
3. **备份现场物理隔离 (Sanitary Backup Isolation)**：Hook 创建的 `.bak` 备份，必须与事务清理路径物理隔离。事务恢复（rollback）只能精确恢复 manifest 清单内的备份，严禁使用通配符 `.bak` 递归无差别物理清扫，防止删除当前活跃运行的 Hook 原始恢复点。
4. **单平台 Gemini 协议统一 (Gemini Protocol Symmetry)**：Gemini 绝对不支持 SessionStart 等价机制，文档与 Skill 描述中严禁泄漏 Claude 独有的 `SessionStart` 概念。BeforeTool 和 AfterTool matcher 工具名必须对齐真实 Gemini 工具名。
5. **Kahn 拓扑排序零假阳性 (Pseudo-Cycle Prevention)**：`plan-tasks` 应当支持 awaiting-confirmation 节点。awaiting 节点仅作为未完成的上游阻塞其下游 pending 节点，但不应将其计入 Ready 就绪列表，且不能导致拓扑图误判为“循环依赖”。

---

## 🛠️ 2. WBS 施工步骤细分 (Construction Steps)

### Step 1: 移除 reconcile 嵌套事务，实现单一顶层事务复用 (P0-1)
- **本步目标**：解决 reconcile 越权覆盖 `activeTxId` 及局部提前提交导致的回滚失效风险。
- **设计变更**：
  - 重构 `engine/commands/reconcile.js` 中的事务获取逻辑：
    - 读取全局 `getActiveTxId()`。若已存在活跃事务，设为 `isNested = true` 并复用该 `txId`，不再调用 `beginTransaction()`；
    - 执行迁移/自愈写操作时，使用 `txWriteYaml` 代替本地 `atomicWriteYaml`，以将所有改动的节点正确登记（`registerFile`）到该顶层事务中；
    - 在命令结束时，仅在 `!isNested`（即独立/直接调用模式）时才调用 `commitTransaction()`，顶层 CLI 进程调用时交由 `index.js` 统一终结。
- **验证命令**：
  - `node --test engine/commands/p5_final_conformance.test.js` (必须新增 reconcile 嵌套事务回滚测试)

---

### Step 2: 隔离 Hook 备份与事务清扫，物理保障活跃恢复点 (P0-2)
- **本步目标**：防止写命令持锁自愈时，误删正在并发执行的编辑器 BeforeTool 阶段 `.bak` 现场。
- **设计变更**：
  - 重构 `engine/lib/transaction.js` 中的 `cleanTmpFiles(dir)` 逻辑：
    - 在递归清除 `.tmp` 和 `.bak` 文件时，**显式过滤并跳过 `hook-` 前缀的文件**；
    - Hook 备份由 validation hook 正常配对后，通过 `allowWithCleanup` 物理自毁；
    - 针对非 yaml 格式或异常崩溃残留的孤儿 `hook-*.bak` 文件，通过 `diagnose` / `doctor` 做检测提示，或限制在 clean 时判定其修改时间（mtime）超过 60 秒（已确诊失活）时才作为垃圾物理清理。
- **验证命令**：
  - `node --test engine/commands/p5_final_conformance.test.js` (验证活跃 Hook 备份不被 rollbackAllIncomplete 误删)

---

### Step 3: 拆除可伪造特权放行，更正为 Hook 状态机强拦截 (P1-1 & P1-2)
- **本步目标**：堵死通过环境变量注入 `ASA_INTERNAL_WRITE` 绕过校验的安全漏洞，并解决 PPID 重名覆盖并发隐患。
- **设计变更**：
  - 重构 `engine/hooks/check-work-order.js` 与 `validate-yaml.js`：
    - **彻底移除**对 `process.env.ASA_INTERNAL_WRITE` 的单纯存在性判定。
    - 引入不可伪造的特权可信链：强校验 `.asa/transactions/` 下对应 TxID 的物理 manifest 文件是否存在，且状态必须为 `prepared` 或 `committing`，否则一律驳回；
    - 针对同客户端多工具并发导致的 PPID 相同覆盖，Before/After 备份文件名不再用 PPID，改用宿主传递的 `hook invocation ID` (或随机高抗碰撞 nonce) 并在双端配对校验，实现物理级并发隔离。
- **验证命令**：
  - `node --test engine/commands/p5_final_conformance.test.js` (验证外部伪造 TxID 注入时 Hook 强行拦截)

---

### Step 4: 净化 Gemini Skill 与 六模板拆解启动语义 (P1-3 & P1-4 & P1-5)
- **本步目标**：消除 Claude 概念泄漏，纠正模板中关于 awaiting 的设计张力。
- **设计变更**：
  - **Gemini 协议去噪**：
    - 重写 `clients/gemini/.gemini/skills/asa/SKILL.md`，彻底删除 SessionStart 块，仅保留 BeforeTool / AfterTool；
    - 校验 Gemini Skill 中的 matcher 列表，确保所有工具名完全命中 Gemini 官方支持的写入原语（如 `apply_diff`、`replace_file` 等）。
  - **模板语义回归 (H1)**：
    - 重写 6 份模板（`templates/*.md`），纠正任务拆解行为：明确把任务拆成多个 S/M TASK，建立 `depends` 边并 `link-task`，按 `plan-tasks` 就绪顺序推荐，不得将 `awaiting-confirmation` 混淆为开发前置条件。
  - **启动严格只读 (H2)**：
    - 移除模板启动期强制运行写盘性质 `reconcile && patch` 的指令。
    - 将 Tier 2/3 的每轮启动指令重塑为纯只读自检：`node .asa/index.js diagnose`，引导模型在诊断报告异常时才显式请求 reconcile。
- **验证命令**：
  - `node --test engine/commands/p5_final_conformance.test.js` (验证 plan-tasks topological 排序及 awaiting 过滤不污染 ready)

---

### Step 5: SessionStart stdin cwd 结构化重构 与 遗留硬编码/Usage 净化 (P2-1 & P2-2 & P2-3 & P2-4)
- **本步目标**：解决 SessionStart 启动勾子在多工作区 CWD 漂移、硬编码 Schema 常量、帮助与实现不一致的问题。
- **设计变更**：
  - **SessionStart 自适应**：
    - 修改 `engine/hooks/session-start.js`：从标准输入（stdin）JSON 负载中结构化提取 `cwd`，作为项目根目录定位。
    - 放弃使用脆弱的正规表达式逐行扫描 matrix.yaml 统计 awaiting，改用原生 Node API 健壮结构化解析 YAML，彻底杜绝注释行的噪声干扰。
  - **硬编码常数归一**：
    - 物理消除 `reconcile.js` 中软化路径等位置的 `schemaVersion = 3` 字符硬编码，统一走全局 `MAX_SUPPORTED_SCHEMA` 配置。
  - **Usage 一致性校准**：
    - 修复 `index.js` 的 usage 说明：从 `search-req` 描述中清除已废弃的 `--threshold` 说明；
    - 补齐 `index.js` 的 usage 说明：增加 `confirm-task`、`reject-task` 和 `cancel-task` 命令。
  - **代码质量去债 (P2-4)**：
    - 提取两 Hook 与三大同构命令中关于 CWD、JSON 解析和备份擦除的共性逻辑，合拢进统一的助手层以降低代码债务。
- **验证命令**：
  - `node --test engine/hooks/hooks.test.js`
  - `node --test engine/commands/commands.test.js`

---

## 📈 3. TDD 测试驱动与分支覆盖率收网 (Coverage Path)

目前行覆盖率为 84.95%，但分支覆盖率在 63.52%，未达到 ≥70% 的契约卡点。
为了实现高质量收网，必须在修复的同时补齐以下契约分支的针对性单元测试，将分支覆盖率强行拉过 70% 红线：
1. **嵌套事务回滚测试 (p5_final_conformance.test.js)**：
   - 模拟在已有顶层 `activeTxId` 下调用 `reconcile` 发生 compile 失败的异常。
   - **断言**：顶级 Catch 正确触发 rollback，事务清单登记过的软化节点文件与 matrix 100% 物理回滚。
2. **活跃备份守护与过期孤儿清理测试 (p5_final_conformance.test.js)**：
   - 创建一个 mtime 属于当前的 `hook-new.bak` 备份文件，与一个 mtime 修改为 2 分钟前的 `hook-old.bak` 孤儿备份文件。
   - 触发任一写命令（触发 `rollbackAllIncomplete` 和 `cleanTmpFiles` 自愈清扫）。
   - **断言**：`hook-new.bak` 毫发无损保留（守护活跃），而陈旧的 `hook-old.bak` 物理扫除，实现自洁。
3. **SessionStart 多工作区与注释 YAML 防噪测试 (hooks.test.js)**：
   - 向 `session-start.js` 管道喂入带有 `cwd` 负载的 stdin 报文。
   - matrix 中混入 `# status: awaiting-confirmation` 的大量中文注释行。
   - **断言**：session-start 进程完美接收，未抛异常，且输出的统计 Count 数量极其精准，排除注释干扰。
4. **Usage 与 Usage 参数一致性测试 (commands.test.js)**：
   - 调用 `node .asa/index.js search-req --threshold 0.5`。
   - **断言**：引擎友好拦截并抛出无效参数异常（因 threshold 移出），绝不静默放行未定义参数。

---

## 📅 4. 进度安排与交付产物 (Milestones & Deliverables)

| 里程碑 | 产物描述 | 状态 |
| :--- | :--- | :--- |
| **M1: 修复自愈方案定义** | 新建 `plans/asa-v3-repair-blueprint-egc.md` 修复计划文件。 | 🟢 **已完成 (落盘)** |
| **M2: 核心原子性与备份隔离** | 修复 reconcile 嵌套事务 (Step 1) 与 Hook 备份隔离不误删 (Step 2)。 | 🔴 **待大鹏授权后一键执行** |
| **M3: 拆除特权与多 agent 净化**| 拆除 env 特权死链 (Step 3)，更正 Gemini SKILL 协议及六模板语义 (Step 4)。 | 🔴 **待大鹏授权后一键执行** |
| **M4: SessionStart 结构化自适应**| 实现 stdin cwd 提取与 YAML 健壮解析，消灭硬编码常量 (Step 5)。 | 🔴 **待大鹏授权后一键执行** |
| **M5: TDD 调绿与覆盖率超 70%** | 全量补齐测试，分支覆盖率物理突破 70% 大卡，项目最终绿灯发布。 | 🔴 **待大鹏授权后一键执行** |

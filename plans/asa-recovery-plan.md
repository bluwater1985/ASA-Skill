# ASA v3 增强功能自愈与修复方案大纲 (ASA v3 Recovery & Repair Plan)

> **版本**：v3.0.2-Refined  
> **基线**：`@ASA-code-review.md` 审核意见 + 大鹏核心架构与安全补充约束  
> **状态**：精细化约束方案已物理落盘，待大鹏指令后正式启动修改

---

## 🎯 1. 核心修复策略与设计 (Core Strategy & Architecture)

### 1.1 进程崩溃恢复级持久化事务 (Crash-Resilient Persistent Transactions)
为了支持因断电、强杀等引发的进程异常退出，事务层由纯内存运行态升级为**文件级持久化事务（Persistent Transaction Manifest）**：
1. **持久化目录**：新建事务时，在 `.asa/transactions/<TX-ID>/` 下创建专用临时文件夹。
2. **清单管理 (`manifest.json`)**：
   ```json
   {
     "txId": "tx-1724310000-abcd",
     "status": "prepared", 
     "startedAt": "2026-08-22T12:00:00.000Z",
     "backups": [
       { "original": ".asa/matrix.yaml", "backup": ".asa/transactions/tx-1724310000-abcd/matrix.yaml.bak" },
       { "original": ".asa/nodes/requirements/REQ-001.yaml", "backup": ".asa/transactions/tx-1724310000-abcd/REQ-001.yaml.bak" }
     ],
     "createdFiles": []
   }
   ```
3. **阶段控制**：状态标志遵循 `prepared → committing → completed` 严格流转。
4. **诊断自愈 (`diagnose` / `doctor` 集成)**：
   - 每次 CLI 启动或运行 `diagnose` 时，扫描 `.asa/transactions/` 下是否存在未完成（`status !== 'completed'`）的事务清单。
   - 若存在，拒绝新的写操作，并在 `diagnose` 报告中清晰展示此阻断；
   - 运行自愈恢复时，读取清单中的 `backups` 将旧文件物理还原，将 `createdFiles` 列表中残留的新增文件彻底删除，清理残留 `.tmp` 临时文件，最后删除事务目录，确保系统 100% 回滚至绿态。
5. **拒绝嵌套事务**：确保 `compile` 被吸纳进现有的顶级写事务中，直接复用当前写命令创建的 TX-ID 与清单，绝对不开启任何嵌套事务。

### 1.2 重新定义 Hook 异步回滚与并发安全协议 (Hook Rollback & Concurrent Sandbox)
由于 `AfterTool` (PostToolUse) 发生在文件物理写入之后，回滚协议必须重构：
1. **多进程并发隔离**：Before/After 备份绝对不共用硬编码 `.bak.tmp`。备份文件命名采用：`.asa/transactions/hook-<PATH-HASH>.bak`。
2. **完备回滚范围**：
   - **新文件删除恢复**：若该文件在写入前不存在，AfterTool 校验失败时必须物理删除该文件，消除残留。
   - **原文件恢复**：若写入前已存在，AfterTool 校验失败时将 `hook-<PATH-HASH>.bak` 物理覆盖还原。
   - **成功清理**：校验通过后，物理清理该备份文件。
   - **遗留诊断**：若因不可抗力导致 `AfterTool` 未被执行（如进程崩溃），在 `diagnose` 中将 `.asa/transactions/hook-*.bak` 暴露并提供一键清理/自愈通道。
3. **特权标识绕过**：通过计算 CLI 执行中的环境变量或特定进程标记，让 ASA 自身的 CLI 写入事务在 Hook 中获得**特权放行**，避免 Hook 与 CLI 写操作发生循环嵌套拦截或冲突死锁。

### 1.3 损坏锁保守阻断与人工清理引导 (Conservative Lock Protection)
1. **禁止超时盲目抢占**：在 `.asa/lock` 文件损坏或 JSON 格式崩溃时，**绝不自动删除**。
2. **死亡存活不可证判定**：由于 PID 无法读取时，无法在 Windows 下通过 `process.kill(pid, 0)` 证明原持锁进程已死亡。此时采取**保守阻断（Conservative Blocking）**，禁止程序启动。
3. **人工引导**：将锁占用上报至 `doctor`，输出持锁的最后 modified 时间，并打印具体的手动排障指令（如：提示用户删除 `.asa/lock` 释放占用），杜绝活进程被误抢占。
4. **10 秒自动回收限制**：自动 Lease 回收机制仅在 **“PID 解析成功，且通过进程探针 100% 确认该进程已死亡”** 的前提下才允许执行。

### 1.4 严格的 deprecate 级联与多级传播语义 (Deprecate Cascade Tree Semantics)
1. **REQ/ARCH -> TASK（一级）**：仅允许通过 `depends` 或 `legacy`（无 type 边）对关联的 TASK 进行直接取消。
2. **TASK -> TASK（递归）**：已被级联取消的 TASK，继续沿着 `TASK -> TASK` (且边类型必须为 `depends`) 的路径进行正向 BFS 递归传播，将其余关联 TASK 变更为 `cancelled`。
3. **禁穿节点边界**：递归过程中，绝对不允许穿过中间的 REQ 或 ARCH 节点，从物理图拓扑层面阻断无意义的大范围级联。
4. **精准 activeTask 清理**：仅当当前被激活的 `activeTask` 物理处于“本次真正被取消的 TASK 集合中”时，才清理 activeTask。若仅是上游 REQ 废弃但 activeTask 未受波及，则保留活跃状态。

### 1.5 迁移周期与软化路径规范化 (Migration Lifecycle & Fill Defaults)
1. **三阶段标记**：在 `reconcile` 升级 2→3 过程中，在 `matrix.yaml` 的 meta 中注入进程阶段标记：`migrationStage: prepared | committing | completed`。
2. **Schema 延后更新**：`schemaVersion` 的标定必须在所有 nodes 写入成功、编译成功、摘要哈希更新成功的**最后一步（Commit 阶段）才落盘升级**。
3. **前置历史清洗**：在启动迁移前，主动扫描、检测并清理历史遗留事务残局、`.tmp` 残留与 `.bak` 数据，确保干净的数据环境。
4. **YAML 软化补齐**：旧 YAML (2.x) 解析软化迁移路径中，同样强制注入 TASK 的 `linkedReqs: []` 和 `changedFiles: []` 空数组，保持结构一致性。

### 1.6 其余架构设计补强要点 (Other Architecture Reinforcements)
*   **白名单边界精确化**：`path.relative` 白名单必须且仅允许项目根目录下的 `.asa/**` 和 `docs/**` 的物理变更，**绝对不单独通过文件名放行任何位置的 `matrix.yaml`**。
*   **scoreReq body 确定性拼接**：`scoreReq` 中，body 的内容构造规则统一规定为：`String(node.description || '') + "\n" + (Array.isArray(node.acceptanceCriteria) ? node.acceptanceCriteria.join("\n") : "")`，确保不同平台运行计算得分 100% 幂等。
*   **`--by` CLI 契约落盘**：`--by <operator>` 成为新增的 CLI 顶级规范。同步至 usage 说明、六份 Tier 模板和全部公开文档。变更的豁免记录与操作者以结构化格式持久化写入被豁免节点的 `allowSimilar` 元数据中。
*   **update-overview 增量机制**：由于仅凭 digest 无法推导差异，将“增量”明确降级为“最近变更记录（基于 `journal.js` 或 changelog 获取最近 5 条变更）”。

---

## 🛠️ 2. 任务拆分表 (Refined WBS)

### 阶段一：P0 阻断性核心问题物理修复

| 任务 ID | 任务名称 | 影响文件范围 | 详细技术实现要点 |
| :--- | :--- | :--- | :--- |
| **Task 1.1** | 修复 CLI 路由初始化缺失 `version.js` 问题 (P0-3) | `clients/gemini/.../asa-init.js`<br>`clients/claude/.../SKILL.md`<br>`clients/gemini/.../SKILL.md` | 在手动复制和初始化脚本中补齐 `cp ~/.asa/version.js .asa/version.js`，保证新拉起的项目可正常寻址。 |
| **Task 1.2** | 增加全局写操作与 Hook 版本守卫 (P0-4) | `engine/version.js`<br>`engine/index.js`<br>`engine/hooks/*.js` | 在 `version.js` 中设定 `MAX_SUPPORTED_SCHEMA = 3`。在所有写命令和 Hook 顶层校验中，若 `schemaVersion > 3` 则强行阻断并报错，防御不兼容的旧引擎改写项目。 |
| **Task 1.3** | 实现崩溃恢复级持久化事务系统 (P0-1) | `engine/lib/matrix.js`<br>`engine/commands/compile.js`<br>以及所有写命令 | 1. 废弃纯内存 try-catch 事务，建立 `.asa/transactions/<TX-ID>/manifest.json` 持久化清单。<br>2. 统一 `compile` 进顶层事务（合并备份与清单），编译 markdown 走 `.tmp` 写入。<br>3. `diagnose` 启动时自检事务残留，执行物理回滚与清理。 |
| **Task 1.4** | 重构多级传导 `deprecate` 级联边矩阵 (P0-2) | `engine/commands/deprecate.js` | 1. 第一级：REQ/ARCH -> TASK (depends 或 legacy 边) 取消。<br>2. 递归级：TASK -> TASK (仅限 depends 边) 取消，不穿过中间 REQ/ARCH 节点。<br>3. 仅在 TASK 被取消且匹配时安全清理 `activeTask`。 |

### 阶段二：P1 高优先级安全性与契约完整性修复

| 任务 ID | 任务名称 | 影响文件范围 | 详细技术实现要点 |
| :--- | :--- | :--- | :--- |
| **Task 2.1** | 固化 Hook 安全隔离、Fail-Closed 与写后回滚 (P1-1) | `engine/hooks/check-work-order.js`<br>`engine/hooks/validate-yaml.js` | 1. 采用 `path.relative` 绝对项目根路径白名单判定，拒绝在其他路径放行。<br>2. 崩溃/未知路径/矩阵损坏强制 Fail-Closed。<br>3. 备份名使用 `hook-<PATH-HASH>.bak` 彻底实现并发隔离，支持新创建文件的物理删除。 |
| **Task 2.2** | 限制编译哈希只计算 01 与 03 文档 (P1-2) | `engine/lib/matrix.js` | `calculateDocsDigest()` 过滤筛选仅对 `01-requirements.md` 和 `03-tasks.md` 计算 sha256 摘要，解耦叙事文档。 |
| **Task 2.3** | 升级相似度算法为 Multiset Bigram-Dice (P1-3) | `engine/lib/similarity.js` | 1. `normalize` 彻底剥离中英文特殊标点和一切空白。<br>2. `bigrams` 采用频次 Map 支持多重集合交集 Dice 运算。<br>3. `scoreReq` 采用拼接 body 的确定性加权规则：`(scoreTitle * 2 + scoreBody * 1) / 3`。 |
| **Task 2.4** | 补全查重豁免审计与 TASK 默认字段 (P1-4) | `engine/commands/add.js` | 1. 查重拦截调整为 `maxScore > 0.9` 判定。<br>2. 强校验 `--allow-similar` 必须等于冲突 ID。<br>3. `--by <user>` 契约，写入豁免节点的 `allowSimilar` 元数据中。<br>4. 补齐 TASK 初始模板的 `linkedReqs` 和 `changedFiles`。 |
| **Task 2.5** | 物理补齐纯只读启动钩子 `session-start.js` (P1-5) | `engine/hooks/session-start.js`<br>`clients/claude/.../SKILL.md` | 1. 新建 `session-start.js` 只读诊断脚本。<br>2. 该脚本在全流程中不加锁、不写盘、不修改文件 mtime。<br>3. 在 Claude 的 Local startup 钩子中配置幂等自动注册。 |
| **Task 2.6** | 具备阶段标记的 Schema 2→3 迁移流程与备份 (P1-6) | `engine/commands/reconcile.js` | 1. 迁移全流程引入 `migrationStage` 三阶段状态控制，且 `schemaVersion` 必须在最后一步 Commit 落盘升级。<br>2. 迁移前前置扫描旧事务并强行清洗。<br>3. 旧 YAML 软化路径同步补齐 `linkedReqs: []`, `changedFiles: []`。 |

### 阶段三：P2 顶级路由传参及细节规范性问题修复

| 任务 ID | 任务名称 | 影响文件范围 | 详细技术实现要点 |
| :--- | :--- | :--- | :--- |
| **Task 3.1** | 修复 CLI 顶级路由传参丢失与非写锁 (P2-1) | `engine/index.js` | 1. 将 `reconcile()` 改为 `reconcile(args)` 透传 `--readonly`。<br>2. 将 `planTasks()` 改为 `planTasks(args)` 接收 `<REQ-ID>`。<br>3. 从 `writeCommands` 白名单中物理移除 `update-overview` 读命令，防止不安全加锁。 |
| **Task 3.2** | 纠正 03-tasks 依赖渲染方向逻辑 (P2-2) | `engine/commands/compile.js` | 寻找 `e.to === id` 的上游，收集对应的阻塞项 `e.from` 显示为依赖任务。 |
| **Task 3.3** | 规一化确认审计字段为 `confirmation.at` (P2-3) | `engine/commands/confirm.js` 等三出口 | 将写入任务节点 confirmation 审计区的时间戳字段，由 `timestamp` 统一重命名为 Schema 规范要求的 `at`。 |
| **Task 3.4** | 扩充 `update-overview` 输出内容 (P2-4) | `engine/commands/overview.js` | 丰富输出展示：requirements 增加 `priority`、`version` 显示；过滤出 `ARCH -> ARCH` 依赖视图；汇总展示最近变更历史记录；以及打印 `lessons.yaml` 经验集。 |
| **Task 3.5** | 损坏锁保守阻断与人工清理引导 (P2-5) | `engine/lib/lock.js` | 损坏锁严禁自动物理删除。PID 无法读取时执行保守阻断，并由 `doctor` 指引用户进行手动解锁。10 秒自动 Lease 回收机制仅在 PID 解析且证实原进程已死亡时方可启动。 |
| **Task 3.6** | 完整同步模板与公开说明文档 (P2-6) | `README.md` 等公开文档及模板 | 全面更新、同步并中文化六份模板和说明文档，补齐 `--by`、`awaiting-confirmation`、`confirm-task`、`plan-tasks`、`update-overview` 描述。 |

---

## 🧪 3. 增强版测试与覆盖率攻坚蓝图 (WBS 阶段四)

我们将严格执行 **测试先行（EDD - Eval Driven Development）** 及沙盒封闭控制：

### 3.1 补充的核心测试矩阵

1. **`validate --json` 规范测试**：
   - 验证 `validate --json` 在遇到格式不合规或未尽传播时，正确输出标准 JSON 格式，其中包含 `blockingErrors` 与 `warnings`。
   - 验证当仅含有 warnings（没有 blockingErrors）时，进程应以 `exit 0` 成功退出，但打印出警告报告。
2. **`SessionStart` mtime 只读测试**：
   - 验证 `session-start.js` 运行时，读取 nodes 属性，正确捕获待确认任务数和过期文档。
   - 通过 `fs.statSync().mtime` 断言，运行前后项目内所有文件的修改时间 100% 保持不变，无副作用。
3. **持久化事务与异常恢复测试**：
   - 模拟 Schema 迁移在 `committing` 阶段被非正常强杀，再次启动 `reconcile` 或 `diagnose` 时，正确检测到 `.asa/transactions/` 事务残留，成功自动执行物理 rollback，数据和 docs 完好还原。
4. **客户端冒烟测试与 version.js 静态校验**：
   - 在测试用例中通过子进程真实初始化一个沙盒客户端，并在其中启动 CLI。
   - 静态检验客户端安装后，复制清单中 100% 包含 `version.js` 并没有发生遗漏。
5. **01 与 03 独立哈希摘要测试**：
   - 验证对 `00-overview.md` 或 `02-architecture.md` 进行手动任意字符修改，验证 `validate` 仍然通过（哈希一致）。
   - 验证仅对 `01-requirements.md` 或 `03-tasks.md` 修改时，触发 digest 篡改拦截。
6. **`plan-tasks <REQ-ID>` 顶级路由传参测试**：
   - 验证在 CLI 顶级传入特定 REQ-ID 时，`planTasks` 仅拓扑排序并规划该需求依赖的子任务图，不产生参数遗失。
7. **六套 Tier 模板与公开说明契约测试**：
   - 自动化扫描 `templates/` 下的 `CLAUDE-tier*.md` / `gemini-tier*.md` 文件，断言新命令关键词和 `--by` 全部到位。

### 3.2 覆盖率监控与硬指标设定

- **覆盖率测试发现范围**：强制包含 `engine/commands/step4.test.js`，避免测试套遗漏。
- **行覆盖率 (Line Coverage) 验收目标**：**≥ 80% (目标 85%+)**
- **分支覆盖率 (Branch Coverage) 验收目标**：**≥ 70% (大幅超越当前的 61.03%)**

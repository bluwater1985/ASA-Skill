# ASA v3 终极增强功能自愈与架构对账施工蓝图 (ASA v3 Refinement Blueprint)

> **版本**：v3.1.0-Blueprint (第九轮深水区双核审计黄金合拢版)  
> **基线**：第九轮独立双核审计自查报告 (`@ASA-code-review.md`) + reconcile --readonly 纯只读契约收回 + validate.js 补全 00/02 锚点拦截 + 引擎 12 项潜在隐患全量物理出清  
> **状态**：第九轮收尾施工 WBS 蓝图已物理落盘，待大鹏进行人工终审，暂未修改任何代码

---

## 📐 1. 总体架构约束 (Global Architectural Invariants)

为了将 ASA v3 的设计和工程品质推向 100% 毫无盲区的黄金标准高度，本轮收尾施工将死守以下九条最高优先级的技术红线：
1. **捍卫 `reconcile --readonly` 绝对纯只读契约（N1 阻断项）**：
   - **成因分析**：在 `index.js` 中将 `'reconcile'` 注册在写命令数组中，导致即便带有 `--readonly` 参数运行，系统依然会执行 `acquireLock`（争抢写锁）、`rollbackAllIncomplete`（抹除并自愈可能存活的脏事务现场）、`beginTransaction`（创建多余事务）等写行为，违背了纯只读只检测不改变环境的状态。
   - **自愈方案**：在 `index.js:31` 判断 `isWrite` 时增加敏锐检测。若 command 为 `'reconcile'` 且参数中包含 `--readonly`（或 `-r`），**强制覆写 `isWrite = false`**！使其完全剥离写锁、自愈及事务行为，达到完美的纯只读。
2. **`validate.js` 补全 00/02 叙事概览锚点哈希过期校验（N2 级修复）**：
   - **成因分析**：由于 `00-overview.md` 和 `02-architecture.md` 解耦出了编译 md 哈希检验，目前 `validate.js` 出现门禁盲区，漏检了叙事文档内部锚点 `<!-- ASA-BASED-ON: ... -->` 与 nodesDigest 不一致的过期风险。
   - **自愈方案**：重构 `validate.js`：提取 00/02 markdown 内容中的 `ASA-BASED-ON` 哈希，若与 matrix 中的 nodesDigest 不符，在 `warnings` 数组中精准追加 `NARRATIVE_OUTDATED` 警告，将概览文件变动 100% 纳入 CI/CD 拦截哨。
3. **消除 legacy 默认边在 doctor 与 overview 中的渲染矛盾（B2 级修复）**：
   - 重构 `overview.js:52`：对无 type 的 legacy 边，默认语义统一归化并渲染为 `[extends-default]`（或 `extends`），保持与 `doctor.js` 降级对账一致。
4. **移除 compile 联动处的空 catch 吞错（B4 & B6 级修复）**：
   - 彻底废除 `edge.js` 边加解、以及 `reconcile.js` 软化自愈路径内，由于 `compile()` 引起的空 `catch (e) {}` 吞错。
   - 统一更正为警示信息：`console.warn('[ASA] ⚠️ 联动重编译 docs 失败: ' + e.message)`。
5. **Similarity 空输入 Dice 溢出硬拦截防御（B5 级修复）**：
   - 在 `similarity.js` 最前端增加类型拦截：**一旦两端有一端归一化后为空字符串（例如纯标点或纯空白输入），直接返回 `0.0` 相似度**，彻底杜绝单字符/空标题误触发查重 hard limit 强拦截。
6. **收敛迁移映射，移除未经契约批准的业务状态提升（M4 级修复）**：
   - 限制并重构 `reconcile.js` 自动数据迁移的转换面：自动软化迁移 `runMigration` **彻底移除 `migrateNodes` 状态提升行为**，只进行格式软化及 TASK 默认字段（linkedReqs/changedFiles）空数组补齐。
7. **六套 Tier 模板启动只读诊断与任务拆解规则语义纠偏（H1 & H2 级修复）**：
   - **模板 H1（拆解语义）**：修正六套模板的“任务拆解规则”，将其由错误描述“先置 awaiting-confirmation”纠正为真正的：*1. 拆解 S/M 任务 -> 2. 加 depends 边 -> 3. 执行 link-task 关联 -> 4. plan-tasks Kahn 排序*。
   - **模板 H2（启动只读）**：修正 Tier 2/3 模板启动。每轮会话开始的强制启动命令一律变更为**纯只读诊断：`node .asa/index.js diagnose`**，不允许强制调用有写盘性质的 reconcile && patch。
8. **`reject` / `cancel` 命令、Usage 与文档一致性高保真对账同步（H3/H4/T6/T7 级修复）**：
   - 物理校准并对齐三大核心指南（`README.md`, `RUNBOOK.md`, `GEMINI.md`, `docs/ASA-GUIDE.html`）中的不合规陈旧表述：
     - 明确 reject 状态退回为 `in_progress`；
     - 明确 cancel 动作不改变 edges 拓扑边（edges 只由 edge rm 命令物理解耦）；
     - 补齐 `index.js` 的 4 命令 usage 缺失，同步 `GEMINI.md` 与 `ASA-GUIDE.html`。
9. **Claude Hook Config 嵌套 schema 与 name 对齐**：
   - 修正 Claude SKILL.md 指引，更正 hooks 嵌套形状。

---

## 🛠️ 2. WBS 施工步骤细分 (Construction Steps)

### Step 1: `index.js` 重构 reconcile --readonly 判定，免除写锁与自愈 (N1 级修复 - P0)
- **本步目标**：将 reconcile --readonly 彻底剥离写操作。
- **设计变更**：
  - 重构 `engine/index.js`：
    在判断 `isWrite` 时，拦截并增加对只读参数的判定：
    ```javascript
    let isWrite = writeCommands.includes(command);
    if (command === 'reconcile' && (process.argv.includes('--readonly') || process.argv.includes('-r'))) {
      isWrite = false; // 强行剥离写标记，免除锁、自愈恢复与物理事务，守护 100% 只读契约！
    }
    ```

---

### Step 2: `validate.js` 补齐 00/02 叙事概览锚点哈希过期校验 (N2 级修复 - P1)
- **本步目标**：防止叙事文档过期绕过，完全对齐 V3 规格 ⑦ 的散文对账校验。
- **设计变更**：
  - 重构 `engine/commands/validate.js`：
    1. 计算或读取当前的 `nodesDigest`：`const currentNodesDigest = calculateNodesDigest();`
    2. 分别提取 `docs/00-overview.md` 和 `docs/02-architecture.md` 内部通过 `<!-- ASA-BASED-ON: (.*?) -->` 记录的节点哈希指纹。
    3. 若该指纹不等于当前的 `nodesDigest`，在 `warnings` 数组中追加：
       `{ code: 'NARRATIVE_OUTDATED', message: '⚠️ 叙事概览/架构设计（00/02）已过期，请运行 update-overview 重新生成并交由模型更新。', id: 'docs/00-overview.md' (或 docs/02-architecture.md) }`

---

### Step 3: Overview 默认边、吞错治理 与 Similarity 空输入拦截 (B2 & B4 & B5 & B6 级修复 - P1)
- **本步目标**：对齐 doctor 语义，增加对 compile 的异常感知，消灭 Similarity dice 对空输入的溢出。
- **设计变更**：
  1. 重构 `engine/commands/overview.js`：
     - 将无 type 的 legacy 边，默认语义统一由 `'depends'` 修正渲染为 `'extends'`，保持降级一致。
  2. 重构 `engine/commands/edge.js` 与 `engine/commands/reconcile.js`：
     - 将 compile 关联的空 catch 更改为友好警示：`console.warn('[ASA] ⚠️ 联动重编译 docs 失败: ' + e.message)`。
  3. 重构 `engine/lib/similarity.js` 中的 `dice`：
     - 函数入口增加最严格的类型与长度防御：若 `s1` 或 `s2` 长度为 0，或者经过 `normalize` 后长度为 0（如纯标点或纯空白输入），**无条件、强制直接返回 `0.0` 相似度**，彻底斩除 Dice 溢出误拦截漏洞。

---

### Step 4: 限制自动迁移越权 与 存量迁移映射修正 (M4 级修复 - P1)
- **本步目标**：旧数据软化迁移路径只干格式化和 TASK 补齐两件事，绝不越权提升 statuses 数据。
- **设计变更**：
  - 重构 `engine/commands/reconcile.js` 中的 `runMigration`：
    - **彻底物理移除 `migrateNodes` 状态提升行为**。
    - 只进行 Tab 软化、块标量解析与 TASK 节点默认空数组补齐。
    - 仅在 2->3 存量迁移的主流路径中，按契约保留对 TASK done 节点的 completed 状态演进。

---

### Step 5: 六模板、双平台 SKILL 协议 与 帮助 Usage 终极同步净化 (H1 & H2 & T2-T5 & T7-T11 - P0)
- **本步目标**：纠正任务拆解语义（H1）、启动序列（H2）、Claude config schema 格式（T3），并完成 4 大公开文档的终极高保真去噪对账。
- **设计变更**：
  1. **Tier 模板启动与拆解纠偏**：
     - 彻底改写 `templates/CLAUDE-tier1/2/3.md` 与 `templates/gemini-tier1/2/3.md`。
     - 任务拆解规则文字替换为“拆 S/M 任务 + depends 边 + link-task 追溯 + plan-tasks KAHN 拓扑”。
     - 启动序列指令替换为只读诊断：`node .asa/index.js diagnose`。
  2. **Claude Hook Config 嵌套格式更正**：
     - 重写 `clients/claude/.claude/skills/asa/SKILL.md`，更正 hooks 格式为 Claude Code 官方支持的 Event-to-Array 嵌套形状，并注入 `name` 属性，挽救 Claude 幂等安装。
  3. **帮助 Usage 与公开文档全维度对账同步**：
     - 补齐 `index.js` Usage 描述。
     - 重写校准 `README.md`, `RUNBOOK.md`, `GEMINI.md`, `docs/ASA-GUIDE.html`。
     - 更新 reject 状态流转文案为 `in_progress`；
     - 移除 cancel 会修改 edges 的陈旧表述；
     - 校准豁免参数 `--allow-similar --reason --by` 三件套与 allowSimilar 数据结构。

---

## 📐 3. TDD 测试红绿灯加固方案 (engine/commands/p5_final_conformance.test.js)

我们将在 `p5_final_conformance.test.js` 中继续高密度编写/更新以下 **RED 失败态测试**，并在生产代码重构后观察它们 100% 变绿：
1. **reconcile --readonly 纯只读物理不变测试 (N1 校验)**：
   - 故意模拟一个正在存活的脏事务和锁。
   - 运行 `node .asa/index.js reconcile --readonly`。
   - **断言：其 100% 运行成功 (exit 0) 且绝对不抢占锁、绝对不删除/回退脏事务备份，物理环境 100% 保持不变**！
2. **`validate` 叙事锚点过期 CI 拦截测试 (N2 校验)**：
   - 篡改 `00-overview.md` 的锚点 nodesDigest。
   - 运行 `validate`，**断言其在 `warnings` 数组中精准报出 NARRATIVE_OUTDATED 告警**，证明 CI 门禁已完全堵锁。
3. **`dice()` 空输入查重漏洞回归测试 (B5 校验)**：
   - 模拟查重比对空字符串 `""` 与全标点字符串 `"！！！"`。
   - **断言：计算出的相似度 Dice 系数必须精确为 `0.0`**，且 add-req 绝对不触发误拦截，攻克边界！
4. **`reject-task` 返回状态 `in_progress` 物理对账测试 (H3 校验)**：
   - 断言 reject 后的 TASK 状态物理为 `in_progress`，彻底清除文档pending残留。

---

## 🚦 4. 下一步执行指引

大鹏，本套 **v3.1.0-Blueprint 最终 WBS 施工自愈与一致性对账蓝图** 已正式落盘保存至：

📁 **`plans/asa-v3-refinement-blueprint.md`**

我们已经做好了最扎实的架构防线准备。在您下达指令前，所有生产代码、测试 JavaScript 文件和环境配置均保持 100% 物理只读，确保数据安全。

- **如果您对上述收尾任务、reconcile --readonly 纯只读剥离、validate.js 补齐叙事锚点过期拦截、以及文档最终同步感到满意，请对我说：“执行第九轮终极闭环修复”**。
- 我将立刻启动，首先为您重构并运行 100% 失败态（RED）测试用例！期待您的开工指令。

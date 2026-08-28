# ASA v3 当前代码审核报告

> 审核日期：2026-08-23  
> 基线：当前工作区代码 + `ASA-enhancement-plan.md` 冻结契约  
> 范围：仅保留当前仍存在的问题；历史已修复项已删除  
> 约束：本轮仅更新审核文档，未修改生产代码或测试代码

## 1. 结论

当前实现已完成大部分 v3 功能，但仍有两项发布阻断问题，以及多 Agent、迁移和交付一致性缺口。

**发布判定：不建议直接宣布 Plan 全量完成。**

- 全量测试：**254 passed / 0 failed / 0 skipped**。
- 行覆盖率：**89.22%**，达到 ≥80% 要求。
- 分支覆盖率：**66.39%**，未达到 recovery plan 的 ≥70% 目标。
- 函数覆盖率：**91.85%**。

## 2. 发布阻断问题

### P0-1：人工确认门只在 `status` 层实现，可被 `propagate` 绕过

**证据：**

- `engine/lib/state-machine.js:24` 仍允许 TASK `in_progress → completed`。
- `engine/commands/propagate.js:17-32` 的 `set_status` 直接调用 `validateTransition()`，因此可把 TASK 从 `in_progress` 推进到 `completed`。
- `engine/commands/status.js:25-29` 虽然阻断通用 status 写入 completed，但只保护这一条命令路径。

动态验证结果：

```json
{"directComplete":{"valid":true},"verify":{"valid":true}}
```

**影响：** 模型可通过 pendingPropagation 绕过 `awaiting-confirmation → confirm-task` 人工确认闭环，违背 P5 核心目标。

**同时存在反向回归：** `status.js:25-29` 也阻断 `completed → verified`，而项目没有 `verify-task` 命令，因此 verified 状态当前没有正常可用入口。

**建议：**

1. 在状态机层移除 `in_progress → completed`，只允许 `in_progress → awaiting-confirmation`。
2. 保留 `awaiting-confirmation → completed` 供 confirm-task 使用。
3. 允许通用 status 执行 `completed → verified`，或新增明确的 verify-task 命令。
4. 增加 propagate 无法直达 completed 和 completed 可进入 verified 的测试。

### P0-2：迁移事务登记失败会被吞掉，随后仍覆盖节点

`engine/commands/reconcile.js:39-47` 的 `txWriteYaml()` 捕获 `registerFile()` 异常后不处理，随后继续调用本地 `atomicWriteYaml()` 覆盖目标文件。

**触发：** manifest 损坏、备份复制失败、磁盘异常或事务目录不可写。

**影响：** 原文件未成功登记/备份，但迁移仍执行覆盖；之后即使顶层事务回滚，也无法恢复该节点。该行为破坏“登记失败即禁止写入”的事务原子性。

**建议：** 删除空 catch，让 `registerFile()` 错误向顶层传播；所有迁移节点写入统一复用事务感知的 `engine/lib/matrix.js::atomicWriteYaml()`。

## 3. 高优先级问题

### P1-1：迁移仍包含冻结 Plan 未批准的业务状态提升

`engine/commands/reconcile.js:103-127` 自动执行：

- REQ `pending → proposed`；
- REQ `done → implemented`；
- ARCH `pending → draft`；
- TASK `done → completed`。

冻结 Plan 明确要求的是 TASK `done → completed` 和 TASK 默认字段回填。REQ/ARCH 状态提升未进入冻结迁移契约。

**风险：** 数据格式迁移同时改变业务审批状态，可能把未审批需求或架构节点自动推进。

**建议：** 仅保留冻结映射；其他映射需单独设计、确认、审计和测试。

### P1-2：Schema 3 软化迁移的 compile 失败仍被降级

`engine/commands/reconcile.js` 在 schema 已为 3、仅因旧 YAML 格式触发软化时，compile 失败只打印 warning，迁移仍继续提交。

**影响：** 节点已被规范化重写，但 01/03 文档与 digest 可能保持陈旧，命令却成功结束。

**建议：** compile 失败必须抛错并由事务回滚；不得在多文件一致性路径中降级为 warning。

### P1-3：edge 变更后 compile 失败被吞，事务会提交半写

`engine/commands/edge.js:65-72,83-90` 在 matrix.edges 已保存后调用 compile，但 catch 只 warning、不抛错。

03-tasks 的依赖展示来源于 edges；compile 失败时 matrix 已更新、文档未更新，顶层事务仍会提交。

**建议：** compile 失败向上抛错；同时为 edge add/rm 增加 03 文档与 digest 闭环测试。

### P1-4：Hook 备份仍使用 PPID，无法隔离同一 Agent 的并发工具调用

- `check-work-order.js` 使用 `hook-<path-hash>-<process.ppid>.bak`；
- `validate-yaml.js` 依赖同样的 PPID 恢复备份。

同一 Claude/Gemini Agent 并发或重试写同一路径时通常共享父 PID，后一次 BeforeTool 会覆盖前一次 pre-image，AfterTool 可能恢复错误版本。

**建议：** 使用宿主提供的 tool/hook invocation ID；若协议没有 ID，由 BeforeTool 生成随机调用 ID，并通过平台上下文显式传递给 AfterTool。

### P1-5：Gemini Hook 超时短于脚本 stdin 兜底

- Gemini `asa-init.js` 配置 Hook timeout 为 5000ms。
- check-work-order/validate-yaml 的 stdin 超时兜底为 15000ms。

宿主可能在脚本进入自身兜底前终止 Hook，造成不可预测的失败或门禁缺失。

**建议：** 统一公共超时常量；宿主 timeout 必须大于脚本内部兜底，并留出进程启动余量。

### P1-6：Claude Hook 安装写入全局 settings，偏离项目级契约

`install.js:117-177` 写入 `~/.claude/settings.local.json`，使 ASA Hook 对所有 Claude 项目生效；冻结 Plan 指定项目级 `.claude/settings.local.json`。

虽然 Hook 对非 ASA 项目会 Fail-Open，但仍产生全局启动开销，且无法按项目 Tier 控制。Claude 也仍没有与 Gemini `asa-init.js` 对等的项目初始化脚本。

**建议：** 全局 install 只安装引擎和 Skill；由 `/asa init` 的项目脚本幂等写入项目内 settings。

## 4. 中低优先级问题

### P2-1：损坏锁在释放阶段会被直接删除

`engine/lib/lock.js:99-113` 在 releaseLock 解析失败时删除锁文件。获取阶段要求损坏锁保守阻断并保留现场，释放阶段却采用相反策略。

若锁内容被外部或并发进程破坏，无法证明它仍属于当前 PID，不应自动删除。建议保留现场并报告 doctor。

### P2-2：fresh-init 骨架仍是 Schema 2 和旧 digest 字段

`skeleton/matrix.yaml` 仍包含：

```yaml
schemaVersion: 2
docsExpectedDigest: "sha256:empty"
docsActualDigest: "sha256:empty"
```

当前 v3 使用 `compiledDocsExpectedDigest` / `compiledDocsActualDigest`。Gemini/Claude 初始化虽然多数路径直接生成 schema 3，但骨架与真实契约不一致，缺失 matrix 自举时会引入额外迁移。

### P2-3：reconcile 健康路径未同步 compiledDocsActualDigest

`engine/commands/reconcile.js:397-409` 只在 legacy `docsActualDigest` 变化时更新该字段；没有同步 `compiledDocsActualDigest`，也没有重新计算 `nodesDigest`。

这不会掩盖手工篡改，因为 validate 优先读取 compiled 字段，但造成 digest 字段语义长期不一致。建议统一维护单一字段组并逐步移除 legacy 字段。

### P2-4：文档仍有少量实现口径错误

当前确认仍存在：

1. `docs/RUNBOOK.md:174-175` 声称只加 `--by` 即可豁免，并写入 `allowSimilar: true`；实现要求 `--allow-similar <REQ-ID> --reason <reason> --by <operator>`，保存对象 `{id, reason, by}`。
2. `GEMINI.md:70` 声称 deprecate 会级联所有下游 TASK；实现仅沿冻结矩阵允许的 depends/legacy 边级联。
3. `skeleton/matrix.yaml` 仍是 v2/legacy digest。

建议新增静态契约测试，直接扫描模板、Skill、README、RUNBOOK、GEMINI、ASA-GUIDE 和 skeleton。

### P2-5：代码质量债务

- confirm/reject/cancel 仍高度重复。
- TASK 初始状态表在 status/propagate/deprecate 重复。
- Hook 的项目根定位、stdin 协议、备份路径和 allow/deny 逻辑重复。
- `process.exit` 仍由 index 全局 monkey-patch，propagate 非零退出提交 partial 属隐式特例。
- `record-changes` 只统一分隔符，没有约束项目相对路径；这是数据质量加固项，不是冻结 Plan 阻断项。

## 5. 最后一次 Review 核实意见

最后一轮中仍未闭合的结论如下；其余已修事项不再保留：

| 最后一轮事项 | 当前裁决 |
|---|---|
| status CLI 直达 completed | **仅修复 status 路径；propagate 仍可在状态机层绕过，见 P0-1** |
| reconcile 节点事务登记 | **registerFile 已接入，但登记失败被吞，见 P0-2** |
| edge 自动 compile | **已调用 compile，但失败只 warning，见 P1-3** |
| Claude Hook 安装 | **配置结构已修，仍写入全局 settings 且缺项目初始化脚本，见 P1-6** |
| Hook 多 Agent 并发 | **仍以 PPID 配对，见 P1-4** |
| 分支覆盖率 ≥70% | **仍未达到：66.39%** |

## 6. 最新测试与覆盖率

### 命令

```powershell
$tests = Get-ChildItem engine -Recurse -Filter *.test.js | ForEach-Object { $_.FullName }
node --test --experimental-test-coverage $tests
```

### 结果

| 指标 | 当前实测 | 验收 |
|---|---:|---:|
| 测试 | **254 passed / 0 failed / 0 skipped** | 通过 |
| 行覆盖率 | **89.22%** | 通过（≥80%） |
| 分支覆盖率 | **66.39%** | **不通过（目标 ≥70%）** |
| 函数覆盖率 | **91.85%** | 通过 |

### 必须补充的测试

1. state-machine/propagate 不得执行 TASK `in_progress → completed`。
2. TASK `completed → verified` 必须存在可用入口。
3. registerFile 失败后 reconcile 不能覆盖节点。
4. schema 3 软化迁移 compile 失败必须回滚。
5. edge compile 失败必须回滚 matrix。
6. 同一 Agent、同一路径的并发 Before/After 恢复。
7. Hook timeout 配置与脚本兜底一致。
8. Claude 项目级重复初始化的幂等性。
9. RUNBOOK/GEMINI/skeleton 静态契约。

## 7. 修复优先级

1. 在状态机层封死 TASK 直达 completed，并恢复 verified 的合法入口。
2. 禁止迁移在事务登记失败后继续写盘；统一迁移映射和软化失败回滚。
3. edge compile 失败向上抛错。
4. Hook 使用 invocation ID，并统一 timeout。
5. 将 Claude Hook 安装迁移到项目级幂等初始化。
6. 统一 digest/skeleton，修正文档残留。
7. 补齐分支测试，使覆盖率达到 ≥70%。

---

## 8. 压缩版核实意见（第三方压缩准确性复核）

> 核实日期：2026-08-23
> 方法：逐条对照 `ASA-enhancement-plan.md` 冻结契约与当前工作区源码逐行复核；覆盖率以同一统一命令复测
> 约束：仅追加核实结论，未修改压缩版主体，未改生产/测试代码

### 8.1 逐条核实结果（均与当前代码逐行核对）

| 压缩版条目 | 核实结论 | 代码证据 |
|---|---|---|
| P0-1 人工确认门可被 propagate 绕过 | **准确** | `state-machine.js:24` in_progress→completed 仍允许；`propagate.js` set_status 走 validateTransition 可直达 |
| P0-1 反向回归：completed→verified 无入口 | **准确（新增价值点）** | `state-machine.js:26` 允许 completed→verified，但 `status.js:26` 阻断所有 TASK 终态、且无 verify-task 命令 → verified 无正常 CLI 入口。此前各轮未明确指出 |
| P0-2 registerFile 失败被吞 | **准确（比历轮更精确）** | `reconcile.js:42-44` 空 `catch(e){}` 吞 registerFile 异常后 L46 仍 atomicWriteYaml 覆盖 |
| P1-1 迁移含非冻结状态提升 | **准确** | `reconcile.js:109-127` 确含 REQ pending→proposed、done→implemented、ARCH pending→draft、TASK done→completed |
| P1-2 schema3 软化 compile 降级 | **准确**（历轮确认） | reconcile 软化路径 compile 失败仅 warning 仍提交 |
| P1-3 edge compile 失败被吞 | **准确** | `edge.js:66-71`、`86-91` 仅 console.warn 不抛错 |
| P1-4 Hook PPID 备份 | **准确**（历轮确认） | 两 hook 仍 process.ppid |
| P1-5 超时 5000 vs 15000 | **准确**（历轮确认） | asa-init 5000 vs hook 兜底 15000 |
| P1-6 install 写全局 settings | **准确**（历轮确认） | install.js 写 `~/.claude/settings.local.json`，无每项目 Claude asa-init |
| P2-1 损坏锁释放被删 | **判定取向分歧，非事实错误** | lock.js:99-113 确认存在；压缩版从"无法证明锁属当前 PID"数据安全角度重评，合理；上轮从"防止永久锁死"角度判为修复。releaseLock 仅在 lockDepth===1（本进程持锁）时触发，破坏性有限 |
| P2-2 骨架 schema 2 | **准确** | `skeleton/matrix.yaml:5-7` 确为 schemaVersion:2 + legacy digest |
| P2-3 reconcile 健康路径不刷 compiled | **准确** | reconcile.js:397-409 只刷 legacy docsActualDigest，不动 compiledDocsActualDigest/nodesDigest |
| P2-4 文档口径（RUNBOOK/GEMINI/skeleton） | **准确**（历轮确认） | 单 --by/allowSimilar:true、GEMINI deprecate 全级联、skeleton v2 均属实 |
| P2-5 代码质量债务 | **准确**（历轮确认） | 重复结构、INITIAL 表、monkey-patch exit 等属实 |

### 8.2 覆盖率数字核对

| 指标 | 压缩版 | 本轮实测 | 上轮实测 | 结论 |
|---|---:|---:|---:|---|
| 测试 | 254 | 254 | 254 | 一致 |
| 行 | 89.22% | 89.12% | 89.33% | 正常波动范围（Node 覆盖率每次运行有微小浮动） |
| 分支 | 66.39% | 66.14% | 66.45% | 正常波动范围 |
| 函数 | 91.85% | 91.85% | 91.85% | 完全一致 |

分支覆盖率 <70% 结论在三种口径下均一致成立。

### 8.3 核实总体结论

**压缩版整体准确，未发现与当前代码或冻结 Plan 相矛盾的实质性出入。** 其最大价值在于两处比历史逐轮报告更精确的提炼：
1. **P0-1 新增的反向回归**（`completed→verified` 无可用入口）——此前各轮未指出，属真实缺陷。
2. **P0-2 把 registerFile"已接入"细化到"接入但登记失败被吞"**——更精确地刻画了原子性破坏点。

**两处需向读者说明的口径差异（均非事实错误）：**
- **P2-1（损坏锁）**：压缩版从数据安全"现场保留"角度重评为问题，与上轮"防止永久锁死"判为修复的取向相反；两者视角不同，压缩版角度合理。
- **覆盖率数字**：89.12%–89.33%（行）、66.14%–66.45%（分支）为正常统计波动，压缩版的 89.22/66.39 在其间，非捏造。

**压缩带来的信息取舍**：历史第十→十七轮已修复项被删除（符合声明"仅保留当前仍存在"），但被删项中部分"已修复但相关门禁未封死到引擎层"的边界被压缩进 P0-1 保留，取舍合理；未发现因压缩而丢失的对当前有影响的关键未决项。

**建议**：压缩版可直接作为当前待办基线后续迭代；优先落实其第 7 节优先级（状态机层封死 + verified 入口恢复为最高优先，覆盖所有写路径含 propagate）。

---

## 9. 第十八轮复审（压缩版议题回归 + 独立新深审）

> 复审日期：2026-08-23
> 审核方式：并行双子代理（引擎/命令 / 模板·hooks·文档）独立重读最新快照 + 关键项人工直接读取裁决（P0-1 门禁、P0-2 吞错、install.js:118 路径）+ 全量测试（统一命令复测）
> 约束：本轮仅追加审核结论，未修改生产代码或测试代码

### 9.1 测试与覆盖率（统一命令复测）

| 指标 | 实测 | 验收 |
|---|---:|---:|
| 测试 | **259 passed / 0 failed / 0 skipped**（较上轮 254 +5） | 通过 |
| 行覆盖率 | 89.39% | 通过（≥80%） |
| 分支覆盖率 | 66.95% | **不通过**（目标 ≥70%；子代理测 66.88，微波动） |
| 函数覆盖率 | 91.85% | 通过 |

分支覆盖率连续三轮上升（66.14→66.95），但仍 <70%。

### 9.2 压缩版议题回归（双代理 + 人工核验）

| 议题 | 判定 | 证据 |
|---|---|---|
| P0-1 状态机去除 in_progress→completed | **已修复** | state-machine.js:24 仅 `['blocked','cancelled','awaiting-confirmation']`；propagate set_status 亦无法 in_progress→completed（引擎层封死，覆盖所有写路径） |
| P0-1 verified 入口恢复 | **已修复** | state-machine.js:26 completed→verified；status.js:36-46 需 `--by` 放行；测试 commands.test.js:664-680 |
| P0-2 registerFile 吞错 | **已修复** | reconcile.js:42 无 catch 抛错→:421 事务回滚 |
| P1-1 迁移非冻结提升 | **未修复** | reconcile.js:108-119 仍含 REQ pending→proposed、done→implemented、ARCH pending→draft |
| P1-2 软化 compile 降级 | **已修复** | reconcile.js:270 throw compErr |
| P1-3 edge compile 吞错 | **已修复** | edge.js:71,92 throw；saveMatrix 已 registerFile 可回滚 |
| P1-4 Hook PPID→invocation id | **未修复** | check-work-order:146,150、validate-yaml:238,260 仍 process.ppid |
| P1-5 超时常量统一 | **部分** | asa-init 5000→15000（=hook 兜底）；但"宿主须 > 兜底留余量"仍未满足，仍属字面量非公共常量 |
| P1-6 Claude 项目级初始化 | **见 9.3（子代理分歧，我裁决"未修/回归"）** | install.js:118（人工核验见下） |
| P2-1 损坏锁释放 | **未修复/维持取向附注** | lock.js:108-111 解析失败仍自清（数据安全视角保留现场之争，非事实错误） |
| P2-2 skeleton schema3 | **已修复** | skeleton/matrix.yaml:5-8 schema3+compiledDocs digest（helpers.js:16-27 测试骨架仍 v2，仅测试脚手架） |
| P2-3 健康路径刷 compiled+nodesDigest | **未修复** | reconcile.js:400-408 只刷 docsActualDigest |
| P2-4 文档口径 | **部分** | RUNBOOK:138,174-175 仍单 `--by`/allowSimilar:true（实现需 `--allow-similar+--reason+--by`，存对象） |
| P2-5 代码债务 | **未修复/接受** | 重复结构、monkey-patch exit 特例仍在 |
| 新测试 | **部分** | 新增 completed→verified(commands.test:664)、propagate in_progress→completed 阻断(p5:897)；缺 registerFile 失败/edge 回滚/invocation-id/超时 |

**结论：P0-1（两部分）、P0-2、P1-2、P1-3、P2-2 已闭环；P1-1、P1-4、P2-3、P2-4 未闭合。**

### 9.3 install.js:118 子代理分歧裁决（人工核验）

- **引擎子代理**判"P1-6 已修复（install.js 改写项目级 .claude）"；**模板/文档子代理**判"B1 高优回归（install.js:118 用 srcDir 写错目录，Hook 从未生效且污染发行库）"。
- **人工核验**：install.js:118 `settingsPath = path.join(srcDir, '.claude', 'settings.local.json')` —— 用 **srcDir（发行源目录）**而非 `~/.claude`/用户项目；而同文件 L109 引擎/Skill 复制到 `homedir`、gemini 分支 L209 用 `homedir`。srcDir≠homedir → Claude 三 Hook 写到发行源码树，**不会对用户 Claude 生效**，且污染发行库。
- **裁决**：**模板/文档子代理的判断准确**（未修/回归）。引擎子代理把"改用 srcDir 的 .claude"误当项目级修复；实际仍未达 P1-6"项目级幂等初始化（由 /asa init 写项目内 settings）"目标，也无 Claude asa-init 对等脚本。

### 9.4 本轮新发现（双代理 + 人工核验）

**B1〔P0，本轮最重要〕propagate 绕过 awaiting 出口直达 completed（实测坐实）**
- 引擎子代理实测：`propagate` 使 TASK `awaiting-confirmation→completed`，exit 0，且节点**无 confirmation 审计**（对照 confirm-task 会写 `confirmation`）。
- 根因：propagate.js:23 只验 validateTransition，未像 status.js:55-58 拦截 awaiting；state-machine.js:25 把 awaiting→completed 保留给 confirm-task，propagate 未设防线补上。
- **这是 P5 人工确认闭环的绕过点**（上一轮 P0-1 只堵了 in_progress→completed）。建议：propagate executeAction 对 old==='awaiting-confirmation' 的 set_status 目标 completed/in_progress/cancelled 一律 failed（awaiting 三出口仅专用 confirm/reject/cancel 可用）+ 补测试（现有 p5:897 只覆盖 in_progress）。

**B2〔P1〕** P1-1 契约残留加重：迁移仍升 REQ/ARCH 业务态，无单测（reconcile.js:108-119）。

**B3〔P1〕** hooks PPID 配对（P1-4 重述）：同 Agent 并发/重试写同路径共享 ppid，AfterTool 恢复错误版本；需 invocation id。

**B4〔P2〕** status completed→verified 的 `--by` 弱校验：status.js:37-41 与 confirm.js:36 仅校验非空，模型可传任意 `--by model` 通过（非阻断，审计可信度项）。

**B5〔P3〕** process.exit monkey-patch 特例：index.js:62 `command!=='propagate'` 使 propagate 致命错误也提交写盘（非 clean partial），属隐式特例。

**另（模板/文档子代理）**：overview.js:89 读项目根 `knowledge/`，而 asa-init 建 `.asa/knowledge/` → lessons 永不显示（路径需对齐）；hooks argv `$FILE_PATH` 未展开占位符仍 fail-open；模板 tier3 确认流程正确（先 awaiting→clear→confirm/reject）；Gemini SKILL 手动嵌套与 asa-init 一致；digest 命名 RUNBOOK:241 仍用 legacy docsDigest、asa-init:45-46 仍写 legacy 字段（与 skeleton/compiled 契约不一致）。

### 9.5 第十八轮结论与建议顺序

**有条件通过。本轮压缩版 P0-1（含 verified 入口）、P0-2、P1-2、P1-3、P2-2 已闭环；但新发现的 B1（propagate 绕 awaiting 人工门，P0 级）为当前最关键遗留，install.js:118 写错目录（B1/回归）与 P1-1/P1-4/P2-3 亦未闭合；分支覆盖率 66.95% 仍 <70%。**

建议顺序：
1. **修 B1（P0）**：propagate 拦截 awaiting 三出口（completed/in_progress/cancelled 一律 failed），awaiting 仅由专用 confirm/reject/cancel 处理 + 补测试。
2. **修 install.js:118（回归）**：settings 改写到安装目标/项目级（对齐 gemini homedir 分支），并补 Claude asa-init 项目级幂等脚本；清理误写入发行库的 settings。
3. **修 P1-1**：迁移收敛为仅冻结映射（TASK done→completed + 回填）。
4. **修 P1-4/B3**：Hook 备份键改 invocation id（显式配对）。
5. **修 P2-3/P2-4**：reconcile 健康路径刷 compiledDocsActualDigest+nodesDigest；文档口径（豁免三件套、allowSimilar、deprecate 范围、--by 必填、knowledge 路径、digest 命名）。
6. **补分支测试**（B1 awaiting 门、registerFile 失败、edge 回滚、invocation-id、超时、P1-1）使分支覆盖率 ≥70%。

> 本轮 +5 测试（254→259），分支覆盖 66.95% 连续三轮上升但仍 <70%。压缩版主要议题多数闭环，唯 B1（propagate 绕 awaiting 人工门，P0 级）是本轮新挖出的关键洞，且 install.js:118 子代理分歧经人工核验判定为"写错目录的回归"——发布前须先堵 B1 并修正安装路径。

---

## 10. 修改意见（针对 §9 当前未决问题，供开发实施参考）

> 提出日期：2026-08-23
> 角色：仅审查提建议，未修改任何生产/测试代码
> 定位：每条给出 文件:行 + 问题 + 具体改法 + 配套测试，可直接转化为开发任务

### 10.1 P0 — 发布阻断

**① propagate 绕过 awaiting 人工门（B1）**
- 位置：`engine/commands/propagate.js:23` 的 executeAction；`state-machine.js:25`。
- 问题：`set_status` 只过 `validateTransition`，而状态机把 `awaiting-confirmation→completed/in_progress/cancelled` 设为合法（供 confirm/reject/cancel 专用），propagate 未设防线 → 可绕过人工确认且不写 `confirmation` 审计（实测 exit 0、无审计）。
- 改法：propagate `executeAction` 中对 `oldStatus==='awaiting-confirmation'` 且目标为三出口之一（completed/in_progress/cancelled）时一律计 `failed`（"awaiting 三出口仅由专用 confirm/reject/cancel 处理"），不落盘不写审计；把 status.js:55-58 现有拦截守卫复用到 propagate。
- 配套测试：p5:897 现只覆盖 in_progress；补一条 `awaiting-confirmation→completed` 经 propagate 发起须 failed、节点 status 不变、无 `confirmation` 的断言。

**② install.js:118 写错目录（回归）**
- 位置：`install.js:118` `settingsPath = path.join(srcDir, '.claude', ...)`。
- 问题：用发行源目录而非安装目标/家目录，Claude 三 Hook 写到发行库、实际不生效（对齐同文件 L109/L209 gemini 分支用 homedir）。
- 改法：改到 `path.join(homedir, '.claude')`（全局安装）或 `engineDest` 对应项目级 `.claude/settings.local.json`；清理误写入 `srcDir/.claude` 的 settings 残留。
- 配套：新增 Claude `asa-init.js` 项目级幂等初始化脚本（对齐 Gemini `scripts/asa-init.js`），`/asa init` 作为唯一项目级 settings 写入入口。

### 10.2 P1 — 高优先级

**③ 迁移非冻结状态提升（P1-1）**
- 位置：`engine/commands/reconcile.js:108-119` migrateNodes。
- 问题：REQ `pending→proposed`/`done→implemented`、ARCH `pending→draft` 自动推进业务态，冻结 Plan 仅批准 TASK `done→completed` + 字段回填。
- 改法：删除 REQ/ARCH 自动 status 变更，仅保留 TASK `done→completed` 与回填；或放入 dry-run 清单由用户确认。
- 配套测试：fixtures 含 `REQ pending`，跑 migrate 断言 REQ 保持 pending、仅 TASK 转 completed。

**④ Hook 备份键 PPID→invocation id（P1-4/B3）**
- 位置：`check-work-order.js:146,150`、`validate-yaml.js:238,260`。
- 问题：`hook-<hash>-<ppid>.bak` 的 ppid 整会话恒定，同 Agent 并发/重试写同路径互覆 pre-image → AfterTool 恢复错误版本。
- 改法：优先用平台 invocation id；否则 BeforeTool 用 `crypto.randomUUID()` 生成每调用唯一 id 命名 pre-image，并写配对档（Before→After id 映射），AfterTool 读配对档恢复，PostTool 清理自身配对档。
- 配套测试：模拟同一进程/同路径连续两次 Before→After，断言各自恢复到自己的 pre-image。

**⑤ hooks 超时统一（P1-5）**
- 位置：`check-work-order.js:94`、`validate-yaml.js:102`（15000 字面量）、`asa-init.js:132,141`。
- 改法：抽公共常量（如 `lib/constants.js` 导出 `HOOK_STDIN_TIMEOUT`/`HOOK_HOST_TIMEOUT`）；host timeout = 脚本兜底 + 启动余量（如兜底 12000、宿主 15000），注释"宿主须 > 兜底"。

### 10.3 P2/P3 — 中低优先级

**⑥ 损坏锁释放策略（P2-1）**
- 位置：`engine/lib/lock.js:108-111`。
- 问题：releaseLock 解析失败直接删锁，与获取阶段"损坏锁保守阻断保留现场"相反，无法证明锁属当前 PID。
- 改法：解析失败**不删锁**，仅清零 lockDepth 并在日志/doctor 报告损坏锁路径；删锁收敛到显式 `forceRelease`（带确认）或 doctor 修复命令。

**⑦ reconcile 健康路径 digest（P2-3）**
- 位置：`reconcile.js:400-408`。
- 问题：只刷 legacy `docsActualDigest`，不刷 compiledDocsActualDigest、不重算 nodesDigest，与 validate/session-start 现优先读 compiled 字段的口径长期不一致。
- 改法：比照迁移分支 `:380-383`，健康路径同步写 compiledDocsActualDigest 并重算落盘 nodesDigest；逐步移除 legacy 字段。

**⑧ 文档口径（P2-4 + 18 轮 B4）**
- 位置：RUNBOOK:138/174-175、GEMINI:70/100-105、模板 tier3:15、两个 SKILL、README:127、GEMINI §2.3、overview knowledge、RUNBOOK:241、helpers.js:16-27 测试骨架。
- 改法（逐项）：
  1. 豁免统一为 `--allow-similar <REQ-ID> --reason <...> --by <operator>` 三件套，allowSimilar 存对象 `{id,reason,by}`（对齐 add.js:124/155）。
  2. deprecate 级联措辞明确为"仅沿 depends/legacy 边级联"（对齐 deprecate.js:56-93）。
  3. `--by` 对所有 confirm/reject/cancel 标**必填**（去掉 `[可选]` 方括号）。
  4. README:127 cancel 去掉"级联"字样。
  5. GEMINI §2.3 补齐 search-req/list/link-task/record-changes/diagnose/doctor 清单。
  6. knowledge 路径统一（overview 与 asa-init 用同一 `.asa/knowledge`）。
  7. digest 命名统一为 compiledDocs*（RUNBOOK:241、asa-init:45-46）。
  8. helpers.js 测试脚手架骨架升 schema3，与 skeleton/matrix.yaml 一致。
- 配套测试：新增静态契约测试，grep 模板/Skill/README/RUNBOOK/GEMINI/ASA-GUIDE/skeleton，校验豁免三件套、deprecate 范围、`--by` 必填、digest 命名，防漂移回潮。

**⑨ verified `--by` 弱校验（18 轮 B4，非阻断）**
- 位置：`status.js:37-41`、`confirm.js:36`。
- 改法：当前仅非空校验，可接受任意 `--by model`；审计增强时对 `--by` 与已知 operator 集/会话身份校验，至少落 audit 日志供追溯。

**⑩ process.exit monkey-patch 特例（B5）**
- 位置：`index.js:62` `command!=='propagate'`。
- 改法：不急于改语义，加注释固化"propagate 非零退出 = 提交已应用项（partial）"隐式契约防误改；后续需 clean partial 语义再拆独立分支。

**⑪ 分支覆盖率 <70%**
- 改法：最高杠杆是随①③④⑦补上对应测试（awaiting 门、registerFile 失败、edge 回滚、invocation-id、超时、reconcile digest），恰覆盖当前低分支模块（status/link/edge/impact/set、validate-yaml/check-work-order）。

### 10.4 落地顺序

1（B1 绕过门）→ 2（install 路径）→ 3（迁移收敛）→ 4（invocation id）→ 同步补 1/3/4/7 的配套测试 → 5-10。

> 本节为建议性修改意见，全部指向 §9 当前未决项并给出文件:行与可执行改法，供实施参考。

---

## 11. 第十九轮复审（§10 修改意见落实回归 + 独立新深审）

> 复审日期：2026-08-23
> 审核方式：并行双子代理（引擎/命令 / 模板·hooks·文档）独立重读最新快照 + 关键项人工直接读取裁决（B1 卫兵与 TDD 测试）+ 全量测试（统一命令复测）
> 约束：本轮仅追加审核结论，未修改生产代码或测试代码

### 11.1 测试与覆盖率（统一命令复测）

| 指标 | 实测 | 验收 |
|---|---:|---:|
| 测试 | **260 passed / 0 failed / 0 skipped**（较上轮 259 +1，为 B1 TDD 测试） | 通过 |
| 行覆盖率 | 88.93% | 通过（≥80%） |
| 分支覆盖率 | 66.20% | **不通过**（目标 ≥70%） |
| 函数覆盖率 | 91.85% | 通过 |

### 11.2 §10 修改意见落实（双代理 + 人工核验）

| 意见项 | 判定 | 证据 |
|---|---|---|
| ① B1 propagate awaiting 门 | **已修复 + 测试** | propagate.js:23-29 awaiting 三出口卫兵；TDD 测试 p5:960-1024（断言失败、keep awaiting、commit partial）（人工核验） |
| ② install.js:118 写错目录 | **部分（路径已修，P1-6 未闭合）** | :118 已改 homedir，:224-230 自洁残留；但仍写全局 settings（非项目级），claude 目录仍无 asa-init.js |
| ③ P1-1 迁移收敛 | **已修复** | reconcile.js:107-113 仅 TASK done→completed |
| ④ P1-4 PPID→invocation id | **未修复** | check:146,150,239,241、validate:238,260,262 仍 process.ppid（6 处） |
| ⑤ hooks 超时统一 | **部分** | check:94/validate:102/asa-init:132,141 值对齐 15000，但仍字面量非公共常量、宿主=兜底未留余量 |
| ⑥ P2-1 损坏锁 | **未修复** | lock.js:108-111 释放仍自删坏锁 |
| ⑦ P2-3 reconcile 健康 digest | **已修复** | reconcile.js:387-399 已刷 nodesDigest+compiledDocsActualDigest |
| ⑧ P2-4 文档口径 | **部分** | README:171/ASA-GUIDE:169 豁免三件套已修；RUNBOOK:138,170,174-175、GEMINI:70、README:127、GEMINI §2.3、knowledge 路径、digest 命名未修 |
| ⑨ verified --by 弱校验 | **未修复（非阻断）** | status.js:37-41 仍仅非空校验 |
| ⑩ process.exit 特例 | **未修复** | index.js:62 仍 command!=='propagate' |
| ⑪ 分支覆盖 | **未达** | 66.20% <70% |

**结论：§10 的①③⑦ 已闭环；②路径已修但项目级链未闭合；④⑤⑧ 未修。**

### 11.3 本轮新发现（key）

**P1〔新回归〕status guarded 过宽 → in_progress/pending 任务无取消入口**
- 实测：`status TASK in_progress→cancelled` exit1 被拦（status.js:36-46），而 cancel-task 只收 awaiting-confirmation → in_progress/pending 任务无任何 CLI 取消入口（仅 deprecate 级联），与 §⑩"status cancelled 单节点不级联"相悖。
- 建议：守卫放宽仅拦 completed/verified，或 cancel-task 兼收 awaiting+in_progress/pending。

**P1〔文档过度承诺〕record-changes 100% 拦截**
- 模板 CLAUDE/gemini tier2:12,tier3:12 与 RUNBOOK:250 称"改写未登记 record-changes 的文件 Hook 100% 拦截"——但 check-work-order 从不校验 changedFiles，只查 activeTask/状态/phase/白名单。
- 建议：删去/收敛该承诺，或真正接入 changedFiles 校验。

**P2**：模板 tier2:21/tier3:15"判重特批"仍 `--by` 单参+allowSimilar 留存（与铁律#1 三件套冲突）；GEMINI:52"24 命令"数量不准；CONTRIBUTING 无新命令清单；helpers.js:16-27 测试骨架仍 v2 legacy digest；SKILL Step6 声称项目级 settings 与 install 全局实现不符。

### 11.3b 引擎子代理补充新发现（独立深审）

**B1〔P1〕deprecate 级联绕过 awaiting 三出口门（实测坐实）**
- deprecate.js:118 对 awaiting-confirmation 任务直接 `set_status cancelled`（state-machine.js:25 该迁移合法，仅过 validateTransition，**无 confirmation 审计**）；动态验证"前: awaiting-confirmation → cancelled，exit 0"。
- 绕过"awaiting 三出口仅 confirm/reject/cancel"契约，与 §⑩ 级联矩阵未协调。建议：级联遇 awaiting 任务跳过并提示走 cancel-task，或补写 confirmation 审计。（注：status 已拦 awaiting，propagate 已拦 awaiting，但 **deprecate 级联是第三条、此前未堵的 await 出口写路径**——与 §11.3 的 status 取消入口议题相关联。）

**B2〔P2〕validate 篡改检测基线错取 Actual**
- validate.js:43 以 `compiledDocsActualDigest`（实际值）作 expected 基线，使 Expected/Actual 之分失效；配合 reconcile.js:393-401 健康路径把 actual 置为当前磁盘值 → 手改 01/03 后仅跑 `reconcile` 即吞掉 DOCS_TAMPERED。
- 建议 validate 以 `compiledDocsExpectedDigest` 为基线。

**B3〔P3〕** clients/claude SKILL.md Step4:96-97 仍写 `docsExpectedDigest/docsActualDigest` legacy 字段，与 skeleton 的 compiled* 不一致（P2-4 项⑦ 残留）。

**B4〔P3〕** index.js:68 monkey-patch exit 的 `catch{}` 静默吞 commit/rollback 失败，无日志无告警。

### 11.4 第十九轮结论与建议顺序 rUX-review

**有条件通过。**（合并双代理）本轮 §10 的 P0 关键项（B1 propagate 绕过门 + TDD、install 路径、迁移收敛、P2-3 digest 健康路径）已闭环；但引擎子代理另发现 **deprecate 级联是第三条可绕过 await 人工门的写路径（P1）**，且 status 取消入口被误拦（P1）、record-changes 文档过度承诺（P1）、validate 篡改基线错取 Actual（P2）亦未收口；P1-4/P1-5/P2-4/helpers 未修、分支覆盖 66.20% 仍 <70%。

建议顺序（补入引擎子代理项）：
1. **封死 await 门的所有写路径**：propagate（已修）+ **deprecate 级联（B1 新，遇 awaiting 跳过/补 confirmation 审计）**；并处理 status 取消入口误拦（§11.3 第 1 条）。
2. **修 validate 篡改基线（B2）**：改以 compiledDocsExpectedDigest 为基线。
3. **修 record-changes 文档过度承诺（P1）**。
4. **修 P1-6**：新增 Claude asa-init.js 项目级幂等脚本。
5. **修 P1-4/P1-5/P2-1**。
6. **修 P2-4 批量文档口径 + B3 (claude SKILL legacy digest)、B4 (exit catch 静默)** + 静态契约测试。
7. **补分支测试**使覆盖率 ≥70%。

> 本轮协调后结论：P0 关键项闭环，但 await 人工门仍存在第三条未堵写路径（deprecate 级联，P1），validate 篡改基线错取 Actual（P2）会掩码篡改——发布前需堵 deprecate 路径并修正 validate 基线；分支 66.20% 未达。

---

## 12. 第二十轮复审（第十九轮问题回归 + 独立新深审）

> 复审日期：2026-08-23
> 审核方式：并行双子代理（引擎/命令 / 模板·hooks·文档）独立重读最新快照 + 关键项人工直接读取裁决（deprecate await 门、validate 基线）+ 全量测试（统一命令复测）
> 约束：本轮仅追加审核结论，未修改生产代码或测试代码

### 12.1 测试与覆盖率（统一命令复测）

| 指标 | 实测 | 验收 |
|---|---:|---:|
| 测试 | **263 passed / 0 failed / 0 skipped**（较上轮 260 +3） | 通过 |
| 行覆盖率 | 90.42% | 通过（≥80%）；首次突破 90%（子代理测 90.26，波动内） |
| 分支覆盖率 | 67.79% | **不通过**（目标 ≥70%；引擎子代理 c8 口径测 74.30 仅作参考，原生口径实测 67.79，接近 68%） |
| 函数覆盖率 | 91.30% | 通过 |

分支覆盖率连续多轮上升（66.20→67.79），原生口径仍差约 2.2 个百分点达标；行覆盖已破 90%。

### 12.2 第十九轮问题回归（双代理 + 人工核验）

| 项 | 判定 | 证据 |
|---|---|---|
| deprecate 级联绕 await 门（P1） | **已修复** | deprecate.js:110-114 遇 awaiting 跳过并提示走 cancel-task；测试 commands.test.js:274-282（人工核验） |
| status 取消入口误拦（P1） | **已修复** | status.js:36 guard 缩为仅 completed/verified；in_progress/pending→cancelled 放行且不触 await 门；测试 :87-106/p5:376 |
| validate 篡改基线（B2） | **已修复** | validate.js:43 用 compiledDocsExpectedDigest 为基线；reconcile 只刷 Actual 不动 Expected → 01/03 手改仍拦；测试 commands.test:383-398（人工核验） |
| record-changes 过度承诺（P1） | **未修复** | tier2/3 模板:12 / RUNBOOK:250 仍称"100%拦截/未登记即抹除"，check-work-order 从不校验 changedFiles |
| P1-6 Claude asa-init | **未修复** | clients/claude 无 asa-init.js；install.js:118 仍写全局 settings（目录已修 homedir，项目级仍缺） |
| P1-4 PPID→invocation id | **未修复** | check-work-order:146,239 / validate-yaml:238,260 仍 process.ppid（6 处） |
| P1-5 超时公共常量 / P2-1 损坏锁 | **未修复** | 15000 字面量无常量；lock.js:108-111 释放仍删坏锁 |
| P2-4 文档口径 | **部分** | README:170 三件套+对象✅；RUNBOOK:138/170/174-175、tier2/3 仍 --by 单参+allowSimilar:true❌；README:127 cancel 仍"级联"❌；GEMINI §2.3 缺命令❌；overview knowledge 路径❌；digest 命名（RUNBOOK:241 仍 docsDigest❌，gemini asa-init ✅）；helpers.js schema3✅ |
| B3/B4 | **已修复** | claude SKILL Step4:96-97 已用 compiled*；index.js:69 exit catch 已打印异常 |
| 新测试 | **部分** | deprecate 门/status 取消/validate 基线已补；缺 invocation-id、超时常量 |

**结论：第十九轮 P1 引擎侧（deprecate 门、status 取消、validate 基线）与 B3/B4 已闭环；record-changes 过度承诺、P1-6、P1-4/P1-5/P2-4 未闭合。**

### 12.3 本轮新发现（双代理）

**P1〔新回归〕diagnose 篡改基线同源漏改**
- diagnose.js:41 用 `compiledDocsExpectedDigest || docsActualDigest`（fallback 应为 docsExpectedDigest）——validate 已修、diagnose 漏改同源 B2，legacy 项目 diagnose 不报篡改。

**P1〔新回归〕cancelled→pending 复活通道**
- state-machine.js:29 `cancelled→pending` 恢复通道 + status.js 不拦 cancelled/in_progress：deprecate 级联取消的 TASK 可用 `status TASK pending` 静默复活，绕过 §⑩ 冻结语义；建议复活需 `--by` 审计或禁自动复活。

**P1〔延续〕`$FILE_PATH` 占位符 fail-open**
- check-work-order.js:45-47 对 `$` 开头 argv 一律放行 + install.js:164/184 写 `"$FILE_PATH"` 字面量：宿主若未展开占位符，实现阶段拦截形同虚设（历轮已记，仍存）。

**P1〔安装链〕asa-init 复制含测试脚手架**
- asa-init.js:104 复制 commands/lib 时 `!f.endsWith('.test.js')` 未剔除 `helpers.js`（测试脚手架）→ 写入生产项目 `.asa/commands/`；install.js:76 明确剔除 helpers.js，两处不一致。
- 另 幂等去重（asa-init:163 仅查 hooks[] 内 name）与 gemini SKILL 手动 shape（name 在 group 层）不匹配 → 重跑重复注册（模板子代理亦实测到）。

**P2**：命令数全网混乱（GEMINI:52/ASA-GUIDE:138 写"24"，index.js switch 实注册 32，SKILL/README/CONTRIBUTING 写"17+"）；模板 tier1:22 reject 缺 `--by` 与铁律#2/实现冲突；模板 tier2/3 判重特批 `--by` 与同文件 :38 三件套自相矛盾；reconcile.js:389 健康路径每次重算落盘 nodesDigest → 手动改节点后仅跑 reconcile 吞 NODES_DRIFT；record-changes.js:39 未做相对/越界前缀归一；status 单复数未统一。

### 12.4 第二十轮结论与建议顺序

**有条件通过，且为历轮最接近达标一轮。** 第十九轮引擎侧 P1（deprecate 门、status 取消入口、validate 基线）与 B3/B4 已闭环，行覆盖破 90%、分支 67.79% 逼近 70%；但新暴露 diagnose 篡改基线同源漏改（P1）、cancelled 复活通道（P1）、`$FILE_PATH` fail-open（延续）、Claude asa-init 安装链仍未闭合，且 record-changes 过度承诺、P1-4/P1-5/P2-4 等文档/结构洞未修。

建议顺序：
1. **收口引擎层安全门**：diagnose.js:41 fallback 改 docsExpectedDigest；cancelled→pending 复活加 `--by` 审计或禁用；reconcile 健康路径 nodesDigest 区分"是否真参与变更"防吞 NODES_DRIFT。
2. **修 P1-6 安装链 + P1（asa-init 复制 helpers.js、幂等去重与 manual shape 对齐）**：新增 Claude 项目级 asa-init.js、从全局 settings 迁项目级、剔除 helpers.js、统一 name 位置。
3. **修 record-changes 过度承诺（P1）**：删/收敛模板与 RUNBOOK:250 宣称，或真正接入 changedFiles 校验。
4. **修 P1-4/P1-5/P2-1**：invocation id、超时公共常量、损坏锁现场保留。
5. **修 P2-4 批量文档口径**（豁免、--by 必填、deprecate 范围、命令数统一、knowledge 路径、digest 命名、reject 缺 --by）+ 静态契约测试。
6. **补分支测试**使原生口径 ≥70%（距达标约 2.2%）。

> 本轮 +3 测试（260→263），行覆盖首次破 90%、分支 67.79%（原生口径接近 70%）。第十九轮引擎侧 P1 已闭环，唯 diagnose 同源漏改、cancelled 复活通道、Claude 安装链与文档口径为发布前最后收口项。

---

## 13. 第二十一轮复审（第二十轮问题回归 + 独立新深审）

> 复审日期：2026-08-23
> 审核方式：并行双子代理（引擎/命令 / 模板·hooks·文档）独立重读最新快照 + 关键项人工直接读取裁决（diagnose 基线、cancelled 复活审计）+ 全量测试（统一命令复测）
> 约束：本轮仅追加审核结论，未修改生产代码或测试代码

### 13.1 测试与覆盖率（统一命令复测）

| 指标 | 实测 | 验收 |
|---|---:|---:|
| 测试 | **263 passed / 0 failed / 0 skipped**（与上轮持平，本轮未新增测试） | 通过 |
| 行覆盖率 | 90.22% | 通过（≥80%） |
| 分支覆盖率 | 67.33% | **不通过**（目标 ≥70%；较上轮 67.79 微降） |
| 函数覆盖率 | 91.30% | 通过 |

注：本轮修复多为审计/诊断门，未配套新增分支测试，故覆盖未升反微降。

### 13.2 第二十轮问题回归（双代理 + 人工核验）

| 项 | 判定 | 证据 |
|---|---|---|
| diagnose 篡改基线漏改（P1） | **已修复** | diagnose.js:41 改 `compiledDocsExpectedDigest \|\| docsExpectedDigest`（人工核验，与 validate 同源一致） |
| cancelled→pending 复活通道（P1） | **已修复（代码侧）** | status.js:66-77 加 `--by` 人工确权卫兵 + changelog"从已取消状态恢复"（人工核验）；**但守卫零测试覆盖（B3）** |
| $FILE_PATH 占位符 fail-open（延续） | **未修复** | check-work-order:45-47 / validate-yaml:53-56 仍放行 `$` 开头 argv；install:164/184 仍写字面量，且有测试固化该放行 |
| asa-init 复制 helpers.js / 幂等 | **已修复** | asa-init.js:104 剔除 helpers.js（对齐 install.js:76）；dedup 逻辑存在 |
| P1-6 Claude asa-init | **未修复** | clients/claude 仍无 asa-init.js；install.js:118 仍写全局 settings |
| record-changes 过度承诺（P1） | **已修复** | tier2/3:12 与 RUNBOOK:250 收敛为"拦截未激活活跃任务"措辞，不再宣称"100%/未登记抹除" |
| P1-4 PPID→invocation id / P1-5 超时 / P2-1 损坏锁 | **均未修复** | hooks 6 处仍 process.ppid；check:94/validate:102 仍 15000 字面量无常量；lock.js:108-111 释放仍删坏锁 |
| P2-4 文档口径 | **部分** | 三件套 README:171/ASA-GUIDE:169✅、GEMINI:52"32"✅、compiled* 命名(helpers/asa-init)✅；tier1:22 reject 缺 `--by`❌、RUNBOOK:175 allowSimilar:true❌、GEMINI:70/ASA-GUIDE:157 deprecate"所有下游"❌、GEMINI:100 `[--by]` 可选❌、ASA-GUIDE:138"24 命令"❌、README:127 cancel"级联"❌、overview knowledge 路径❌、RUNBOOK:241 digest 命名❌ |
| 新测试 | **无新增** | cancelled→pending 守卫未测；invocation-id/超时常量缺 |

**结论：第二十轮 diagnose、cancelled 复活（代码）、helpers 剔除、record 收敛已闭环；$FILE_PATH、P1-6、P1-4/P1-5/P2-1、P2-4 未修。**

### 13.3 本轮新发现（双代理）

**B1〔P2，引擎核心一致性洞〕propagate 静默复活 cancelled→pending**
- status 已对 cancelled→pending 加 `--by` 守卫，但 propagate set_status 只拦 awaiting、对 cancelled→pending 无审计；validateTransition（state-machine:29）放行 → 经 stale/bogus pendingPropagation 可无声复活 deprecate 级联取消任务、绕过 §⑩ 且无审计。
- 建议：propagate 对齐 status 守卫（cancelled→pending 需 --by）+ 测试。

**B2〔P2〕claude SKILL 安装链拷入测试脚手架**
- SKILL.md:77 `cp ~/.asa/commands/*.js` 未剔除 helpers.js/.test.js（gemini asa-init:104 已剔）；手写 `/asa init` 会把测试脚手架写入生产 .asa/commands。

**B3〔P2〕cancelled→pending 守卫零覆盖**
- 覆盖报告 status.js:68-72 为未覆盖行；守卫存在但无回归测试（`status TASK cancelled→pending` 需 --by、缺参拒绝）。

**B4/B5〔P3〕** 超短标题查重退化（similarity.js:17-19 两单字符 dice=1.0 可误拦）；edge.to 数组不兼容（compile.js:100/plan.js:24-26 仅匹配标量 to）。

**模板/文档子代理补充〔P2〕**：tier1:22 `reject-task <ID> --reason` 缺 `--by`（reject.js:36 已强制 → 按字面执行必失败）；session-start:120 篡改提示措辞模糊；命令数 ASA-GUIDE:138"24" 与 GEMINI"32"/实际 32 不一致。

### 13.4 第二十一轮结论与建议顺序

**有条件通过。** 本轮第二十轮引擎侧 P1（diagnose 基线、cancelled 复活守卫【代码侧】）与 record 收敛、helpers 剔除已闭环；但新发现 B1（propagate 静默复活 cancelled→pending，与 status 守卫构成两路径不一致）为引擎核心一致性洞，且 Claude 安装链、$FILE_PATH、P1-4/P1-5、文档口径未闭合、分支 67.33% 未达。

建议顺序：
1. **堵 propagate 静默复活（B1）**：propagate set_status 对齐 status 的 cancelled→pending `--by` 守卫 + 补 B3 回归测试（覆盖 status 与 propagate 两路径）。
2. **修 P1-6 安装链**：新增 Claude 项目级 asa-init.js + 修 B2（SKILL cp 剔除测试脚手架）；settings 迁项目级。
3. **修 $FILE_PATH fail-open**：占位符未展开时记录警告/收紧（去掉测试固化的放行）。
4. **修 P1-4/P1-5/P2-1**：invocation id、超时公共常量、损坏锁现场保留。
5. **修 P2-4 批量文档口径**（reject 缺 --by、allowSimilar、deprecate 范围、命令数统一、knowledge 路径、digest 命名、cancel 措辞）+ 静态契约测试。
6. **补分支测试**使原生口径 ≥70%。

> 本轮代码级修复有限（diagnose/复活守卫/helpers/record 收敛），且无新增测试（263 持平）、分支 67.33% 微降未达。关键新洞 B1（propagate 静默复活 cancelled）与 status 守卫构成两条不一致路径，需发布前统一；Claude 安装链与文档口径为最后收口项。

---

## 14. 第二十二轮复审（第二十一轮问题回归 + 独立新深审）

> 复审日期：2026-08-23
> 审核方式：并行双子代理（引擎/命令 / 模板·hooks·文档）独立重读最新快照 + 关键项人工直接读取裁决（B1 propagate 复活守卫）+ 全量测试（统一命令复测）
> 约束：本轮仅追加审核结论，未修改生产代码或测试代码

### 14.1 测试与覆盖率（统一命令复测）

| 指标 | 实测 | 验收 |
|---|---:|---:|
| 测试 | **267 passed / 0 failed / 0 skipped**（较上轮 263 +4，为 cancelled 守卫两路径测试） | 通过 |
| 行覆盖率 | 89.98% | 通过（≥80%） |
| 分支覆盖率 | 67.49% | **不通过**（目标 ≥70%；较上轮 67.33 微升） |
| 函数覆盖率 | 91.35% | 通过 |

### 14.2 第二十一轮问题回归（双代理 + 人工核验）

| 项 | 判定 | 证据 |
|---|---|---|
| B1 propagate 静默复活 | **已修复** | propagate.js:31-56 cancelled→pending 需 `--by` 审计，缺参记"恢复失败"审计并 failed（人工核验，与 status/state-machine 对齐） |
| B3 两路径守卫测试 | **已修复** | commands.test.js:718-831 新增 4 例（status/propagate 各缺 --by 拒绝、带 --by 放行 + 审计断言） |
| B2 SKILL cp 拷脚手架 | **已修复** | claude SKILL 改委托 asa-init（SKILL.md:53,59）；claude/gemini asa-init 均剔 helpers.js/.test.js |
| P1-6 Claude 项目级 asa-init | **部分** | asa-init.js 已新增（项目级幂等）；但 install.js:122 仍写全局 `~/.claude/settings.local.json`（绝对路径）→ 与 asa-init 项目级**双注册** |
| $FILE_PATH fail-open | **未修复** | check-work-order:52-54 / validate-yaml:59-62 仍放行占位符、无警告；测试仍固化放行 |
| P1-4 / P1-5 / P2-1 | 部分 | **P1-4 主链路已修**（randomUUID+invocations.json map）；**P1-5 已修**（constants.js GUEST=12000/HOST=15000，留 3000 余量）；**P2-1 未修**（lock.js:108-111 释放仍删坏锁） |
| P2-4 文档口径 | **部分** | reject 缺 `--by` 已补（tier1/2/3:22）、三件套/命令数 32 已修；allowSimilar:true、deprecate "所有下游"、`[--by]` 可选、命令数 "24"、knowledge 路径、docsDigest、cancel 措辞未修 |
| B4/B5 | **未修复** | similarity.js:17-19 单字符 dice=1.0；compile.js:100 仅标量 to、plan.js:25 `e.to.startsWith` 遇数组崩溃（deprecate.js:58/84 已兼容数组→不一致） |
| 新测试 | **+4** | cancelled 守卫两路径；invocation-id/超时无独立断言 |

**结论：B1/B3/B2/P1-6(脚本)、P1-4(主链路)、P1-5 已闭环；$FILE_PATH、P2-1、P2-4、B4/B5 未修。**

### 14.3 本轮新发现

**P1〔发布阻断·实测〕Claude 安装链缺 version.js → 写命令全崩**
- claude asa-init.js 只拷 index.js（:82-87），gemini 拷了 version.js（:91-96）。
- **实测**：Claude 初始化项目 `compile` 崩 `Cannot find module '../version.js'`（reconcile.js:4）→ 所有写命令全崩。
- 根因补充：p0_safety.test 只查 SKILL.md 字符串含 "version.js" 与 gemini 脚本，静态漏网。

**P1〔新回归〕check-work-order deny() 备份清理错配**
- 备份用 `hook-<hash>-<uuid>`（check:169）建，deny() 却删 `hook-<hash>-<ppid>`（check:258-261）→ 冻结阻断一次 YAML 写即遗留孤儿 `hook-*.bak` + invocations.json 条目（本轮回 invocation-id 引入）。

**P2**：`invocations.json` 单槽位 map（check:166 `map[hash]=id`）同路径并发/重入 Before→After 交叉匹配，After 可能用错 pre-image；install 全局绝对路径 + asa-init 相对路径双注册（双 hook 双备份）；cleanTmpFiles 仅清 ≥60s 的 bak/.tmp，`hook-*.created` 与 <60s 泄漏不清理；change.js:35 快照未纳入事务 registerFile，重复 change 无限累积。

**另（模板子代理）**：README:127 cancel"级联"、GEMINI:70/ASA-GUIDE:157 deprecate 范围、GEMINI:100 `[--by]` 可选、ASA-GUIDE:138 命令数"24"（实 32）、overview.js:89 knowledge 根路径（asa-init 建 `.asa/knowledge`）、RUNBOOK:241 `docsDigest` 命名、RUNBOOK:210 空代码围栏——均未修。

### 14.4 第二十二轮结论与建议顺序

**有条件通过；但本轮新测出 Claude 安装链缺 version.js 为发布阻断。** 引擎核心（B1 propagate 复活守卫 + B3 测试、P1-4 主链路 invocation id、P1-5 超时常量）已闭环，分支 67.49% 逼近 70%；但 Claude 三条崽（asa-init 缺 version.js 全崩、deny 清理错配遗留、install 双注册）与 $FILE_PATH/P2-1/文档口径未闭合。

建议顺序：
1. **修发布阻断：claude asa-init 补 version.js 拷贝**（对齐 gemini），并补全文件清单测试（版本/命令一致）。
2. **修 deny 备份清理错配**：deny/恢复统一用 `hook-<hash>-<uuid>`，Update invocations.json 清理。
3. **收双注册**：install 停写全局 settings 或 asa-init 去重（避免双 hook 双备份双校验）。
4. **修 invocations.json 单槽竞态、cleanTmp 泄漏、change 快照未入事务**。
5. **修 $FILE_PATH fail-open、P2-1 损坏锁、B4/B5（similarity 单字符、plan edge.to 数组）**。
6. **补分支测试**使原生口径 ≥70%（缺口约 2.6%）。

> 本轮 +4 测试（263→267），引擎核心（propagate 复活守卫、P1-4 主链路、P1-5 超时）已闭环；但 Claude 安装链缺 version.js 为发布阻断（实测全写命令崩溃），且 deny 备份清理错配为本轮新回归——需先修阻断项再收口文档口径与分支覆盖。

---

## 15. 第二十三轮复审（第二十二轮问题回归 + 独立新深审）

> 复审日期：2026-08-23
> 审核方式：并行双子代理（引擎/命令 / 模板·hooks·文档）独立重读最新快照 + 关键项人工直接读取裁决（version.js、deny 清理、similarity 失败定位）+ 全量测试（统一命令复测）
> 约束：本轮仅追加审核结论，未修改生产代码或测试代码

### 15.1 测试与覆盖率（统一命令复测）

| 指标 | 实测 | 验收 |
|---|---:|---:|
| 测试 | **267 通过 / 1 失败 / 0 跳过**（较上轮 267/0，**本轮首次全量红**） | **不通过** |
| 行覆盖率 | 89.63% | 通过（≥80%） |
| 分支覆盖率 | 67.01% | **不通过**（目标 ≥70%；较上轮 67.49 降） |
| 函数覆盖率 | 90.37% | **降**（上轮 91.35） |

**失败测试**：`engine/commands/p5_final_conformance.test.js:617` `dice similarity returns 0.0 for empty/punctuation strings`（断言行 627 `dice of empty strings must be 0.0` 失败，实际返回 1.0）。

### 15.2 第二十二轮问题回归（双代理 + 人工核验）

| 项 | 判定 | 证据 |
|---|---|---|
| P1 发布阻断：claude 缺 version.js | **已修复** | claude asa-init.js:89-94 已拷 version.js；**实测**初始化后 compile/add-req/validate 均正常（人工 + 双代理实测） |
| P1 deny() 备份清理错配 | **已修复** | deny():289-316 改经 getInvocationBackupPaths 按 uuid 清理（check:292 与 backup:185 同 uuid 一致） |
| P2 invocations 单槽竞态 | **未修复** | check:182 `map[hash]=invocationId` 仍单槽，同路径并发/重入 Before→After 交叉 |
| P2 install 双注册 | **部分** | install.js:122-198 仍写全局绝对路径 settings；仅 hook 内 ADR-22（check:50-64/validate:58-76）运行时 fail-open 规避，物理双注册仍在 |
| P2 cleanTmp 泄漏 | **未修复** | transaction.js:256-279 仅清 .tmp 与 >60s hook-*.bak；hook-*.created 与 <60s 永不清理；change.js:35 快照仍不入事务 |
| $FILE_PATH / P2-1 损坏锁 | **未修复 / 已修复** | check:68-70、validate:79-82 仍 fail-open 占位符；lock.js:108-111 已保留损坏锁现场 |
| B4/B5 | **B4 新回归/ B5 部分** | similarity.js:36-38（B-n1，全测试红）；plan.js:24-36 已兼容 edge.to 数组，compile.js:100 仍标量 to |
| P2-4 文档口径 | **部分** | 仅 GEMINI:52"32"、tier:22 reject --by 已修；RUNBOOK/GEMINI/README/overview/digest 多项未修 |
| 新测试 | **部分** | p0:9-28 version 清单 3 项（仅查 SKILL.md 字符串，静态弱）；p3:149-160 invocations uuid 1 项；无 edge.to/deny 全链 |

**结论：version.js、deny 清理、plan edge.to 数组、P2-1 已闭环；invocations 竞态、双注册、cleanTmp、$FILE_PATH、文档口径未修；similarity 引入新回归。**

### 15.3 本轮关键问题

**B-n1〔P1 · 发布阻断 · 新回归〕similarity 短串修复打破空串契约 → 全量测试红**
- similarity.js:36-38 `if(norm1.length<=2||norm2.length<=2) return norm1===norm2?1.0:0.0`：空/全标点串归一化后均 `''`，`''===''` → 返回 **1.0**。
- 实测 `dice('','')=1`；p5:617-630 断言期望 0.0 → p5:627 FAIL（1≠0）。**本轮唯一失败测试**（此前连续 22 轮全绿 + 上轮 267/0）。
- 隐患：scoreReq 对空 title/body 会得 1.0，可能误判查重命中。
- 建议：先对 norm 为空输入显式返回 0.0（或无 bigram 即 0.0），再对 ≤2 短串做精确相等。

**P1〔新发现〕6 份模板均缺 record-changes 命令**
- 模板基线规则2仅写"记录完变更"，**未给出 `record-changes <TASK> <file...>` 命令名**（plan ⑤明确要求）→ P3 追溯/版本递增闭环无法从模板触发。

**P2〔新发现〕invocations.json 读-改-写整覆写争用**
- check:177-183/validate:265-271 先读后整 map 覆写、非 tmp+rename 原子；两个不同文件并发 Before 时后写者丢前一 hash 映射 → 该文件 AfterTool 取 unknown、失败时无法回滚（与单槽竞态叠加放大）。建议多槽（hash→id 数组）+ 原子 rename + 并发锁。

**P2**：claude asa-init 生成 matrix 缺 engineVersion（gemini:44 有）；tier1 仍建 nodes/ 与 SKILL Tier 表"nodes ❌"不符；claude 过滤 `f!=='helpers.js'` 与 gemini endsWith 不一致。

**P3**：version 清单测试仍静态弱断言（p0:9-28 只查 SKILL.md 字符串，未测 asa-init 真实拷贝）；deprecate 级联 edge.to 数组无独立测试；compile.js:100 仍标量 to；matrix.js:160-166 rebuildSummary 摘要丢 version/priority 字段。

### 15.4 第二十三轮结论与建议顺序

**有条件通过，但本轮首次出现全量测试红，发布判定需收紧**：version.js 阻断已闭环（实测可运行）、deny 清理/plan edge.to/P2-1 已修；但 **B-n1（similarity 空串回归）使 267 测试 1 失败、分支 67.01% 未达**，任何 CI 入口皆红，为当前第一优先。

建议顺序：
1. **修 B-n1（P1）**：similarity.js 对空 norm 输入显式返回 0.0（或先判无 bigram），再走 ≤2 精确相等；恢复 p5:617 全绿。
2. **修模板 record-changes 断层（P1）**：六模板补 `record-changes <TASK> <file...>` 命令，使 P3 追溯可触发。
3. **修 B-n2 invocations 并发**：改多槽 + 原子 rename + 并发锁。
4. **收双注册**：install 停写全局 settings 或 asa-init 去重。
5. **修 cleanTmp 泄漏（*.created/<60s）、$FILE_PATH、compile edge.to 数组、claude engineVersion**。
6. **修 P2-4 文档口径** + 静态契约测试。
7. **补分支测试**使 ≥70%（补 B-n1/invocations/edge.to/deny 全链）。

> 本轮首现全量测试红（267/1）：B-n1（similarity 空串契约）为本轮 B4 修复引入的回归，任何 CI 入口皆红；version.js 发布阻断已闭环且实测可运行，deny/plan edge.to/P2-1 亦修。发布前须先恢复全绿并补模板 record-changes 断层、invocations 并发与文档口径。

---

## 16. 第二十四轮复审（第二十三轮问题回归 + 独立新深审）

> 复审日期：2026-08-23
> 审核方式：并行双子代理（引擎/命令 / 模板·hooks·文档）独立重读最新快照 + 关键项人工直接读取裁决（B-n1 similarity）+ 全量测试（统一命令复测）
> 约束：本轮仅追加审核结论，未修改生产代码或测试代码

### 16.1 测试与覆盖率（统一命令复测）

| 指标 | 实测 | 验收 |
|---|---:|---:|
| 测试 | **267 passed / 0 failed / 0 skipped**（**恢复全绿**，较上轮 267/1） | 通过 |
| 行覆盖率 | 90.13% | 通过（≥80%） |
| 分支覆盖率 | 67.45% | **不通过**（目标 ≥70%；较上轮 67.01 升） |
| 函数覆盖率 | 90.37% | 通过 |

### 16.2 第二十三轮问题回归（双代理 + 人工核验）

| 项 | 判定 | 证据 |
|---|---|---|
| B-n1 similarity 空串回归（P1 发布阻断） | **已修复** | similarity.js:35-38 空 norm 显式返回 0.0（先于 ≤2 精确相等）；全量 267/0 恢复全绿（人工核验） |
| 模板 record-changes 断层（P1） | **已修复** | 六模板 tier1/2/3 均含 `record-changes <TASK> <file...>` 命令 |
| B-n2 invocations 竞态 | **未修复** | check:177-178 仍单槽 `invocation-<hash>.json`、非多槽数组、非原子写 |
| install 双注册 | **部分** | install.js:122 仍写全局 settings；仅 ADR-22 运行时 fail-open 规避，物理双注册仍在 |
| cleanTmp 泄漏 / change 快照入事务 | **未修复** | transaction.js:256-279 仅清 .tmp/>60s hook-*.bak；*.created/invocation-*.json/change 快照永不清 |
| $FILE_PATH / compile edge.to / claude engineVersion | **均未修复** | check:68-70、validate:79-82 仍 fail-open；compile.js:100 仅标量 to；claude asa-init 缺 engineVersion |
| P2-4 文档口径 | **部分** | 三件套 README:171/ASA-GUIDE:169✅；RUNBOOK/GEMINI/default 多项未修（详见 16.3 清单） |
| B-n3/4/5 | **未修复** | version 清单仍静态字符串断言；deprecate edge.to 数组无测试；rebuildSummary 丢 version/priority |
| 新测试 | **无新增** | 267 持平；similarity 空串测试系上轮已加、本轮使其通过 |

**结论：B-n1、模板 record-changes 已闭环（全绿恢复）；invocations/双注册/cleanTmp/$FILE_PATH/compile edge.to/文档口径未修。**

### 16.3 本轮新发现（双代理）

**P1〔新〕similarity ≤2 字符精确相等造成判重逃逸（不对称假阴性）**
- similarity.js:41-43 当任一方 norm≤2 时仅精确相等返回 1.0 否则 0.0。2 字中文标题（如"登录"）对更长文本（"登录功能"）恒 0.0，绕过 >0.9 判重拦截且不落 allowSimilar 审计——B4 修复只消了假阳性、放大了假阴性。建议对 ≤2 短串用子串包含而非精确相等。

**P2〔新〕edge 环检测口径与 plan 不一致**
- edge.js:54 wouldCreateCycle 检查全部边（含 extends/refines），而 plan.js 拓扑仅认 depends 边 → 加 extends 环可能被拒但编排视而不见（或反之）。建议统一到 depends 口径。

**P2〔模板子代理〕compile.js:100 依赖仍标量**：`e.to===id`，edge.to 数组时 depends 渲染失效，deprecate/plan 已兼容数组而 compile 成唯一不一致点。

**P2〔模板子代理〕模板 rule5 overclaim**：tier1-3 rule5 声称 awaiting 状态"受 Hook Fail-Closed 强力物理保护"，但 check-work-order 仅 implementation 阶段且 activeTask===该任务才拦截（:216-238），非 implementation 阶段 awaiting 任务可放行——物理保护被夸大。

**P2〔延续〕reconcile 健康路径吞 NODES_DRIFT**：reconcile.js:389 每次无脑覆写 nodesDigest，手改节点后仅跑 reconcile 即把 validate 的 NODES_DRIFT 掩掉（历轮已记、至今仍在）。

**P3**：SKILL Tier 表 vs asa-init 无条件建 nodes/knowledge 冲突；命令数三档不一（README/SKILL/CONTRIBUTING"17+" vs GEMINI/实际"32"）；matrix 自举 engineVersion 三源（skeleton/claude-init 缺/gemini-init 有）互异；`*.created`/`invocation-*.json` 无限累积。

### 16.4 第二十四轮结论与建议顺序

**有条件通过；发布阻断项 B-n1 已闭环、全量恢复全绿。** 第二十三轮 record-changes 断层亦闭环；但 invocations 竞态、双注册、cleanTmp 泄漏、$FILE_PATH、compile edge.to、文档口径未闭合，且引擎子代理新指 P1（similarity ≤2 判重逃逸假阴性），分支 67.45% 连续多轮未达 70%。

建议顺序：
1. **修 similarity ≤2 判重逃逸（P1）**：短串改子串包含（不精确相等），消除 2 字标题对长文假阴性，并落 allowSimilar 审计。
2. **修 B-n2 invocations 并发**：多槽 + 原子 rename + 锁。
3. **修 compile edge.to 数组、edge 环检测口径统一、reconcile NODES_DRIFT**。
4. **收双注册、修模板 rule5 overclaim、cleanTmp/*.created 清理、claude engineVersion**。
5. **修 P2-4 文档口径**（豁免、deprecate、--by、命令数、knowledge、digest、cancel、空围栏）+ 静态契约测试。
6. **补分支测试**使 ≥70%。

> 本轮 B-n1 发布阻断闭环、全量恢复全绿（267/0），模板 record-changes 断层亦修；但引擎子代理新指 P1（similarity ≤2 判重逃逸假阴性）与多项并发/文档未收口，分支 67.45% 连续多轮 <70%——发布仍为有条件通过，下一优先为 short-string 判重语义与分支覆盖收口。

---

## 17. 第二十五轮复审（第二十四轮问题回归 + 独立新深审）

> 复审日期：2026-08-23
> 审核方式：并行双子代理（引擎/命令 / 模板·hooks·文档）独立重读最新快照 + 关键项人工直接读取裁决（P1 similarity 子包含）+ 全量测试（统一命令复测）
> 约束：本轮仅追加审核结论，未修改生产代码或测试代码

### 17.1 测试与覆盖率（统一命令复测）

| 指标 | 实测 | 验收 |
|---|---:|---:|
| 测试 | **267 passed / 0 failed / 0 skipped**（全绿保持） | 通过 |
| 行覆盖率 | 90.06% | 通过（≥80%） |
| 分支覆盖率 | 67.20% | **不通过**（目标 ≥70%；引擎子代理测 66.6–67.3%，两次均 <70%） |
| 函数覆盖率 | 90.32% | 通过（≥85%） |

### 17.2 第二十四轮问题回归（双代理 + 人工核验）

| 项 | 判定 | 证据 |
|---|---|---|
| P1 similarity ≤2 判重逃逸（P1） | **已修复** | similarity.js:40-46 短串改智能子包含 `longer.includes(shorter)`；"登录"对"登录功能"不再恒 0.0；命中 >0.9 走 add.js:124-160 拦截并写 allowSimilar{id,reason,by}（:154）（人工核验） |
| B-n2 invocations 单槽竞态 | **未修复** | check-work-order:177-178 / validate-yaml:262 仍单 `invocation-<hash>.json`、非数组非原子 |
| edge 环检测口径 | **未修复** | edge.js:54 wouldCreateCycle 检全边（graph.js:63-68）vs plan.js:25 仅 depends |
| compile edge.to 数组 | **已修复** | compile.js:103 `Array.isArray(e.to)...` |
| reconcile 吞 NODES_DRIFT | **未修复** | reconcile.js:387-389 仍无条件覆写 nodesDigest，掩盖手改后 validate:64 的 NODES_DRIFT |
| install 双注册 / cleanTmp / claude engineVersion | **部分/未修/未修** | install.js:122-198 仍写全局 settings（物理双注册在）；transaction.js:256-279 仍只清 tmp/.bak>60s；claude asa-init:40-51 无 engineVersion |
| P2-4 文档口径 | **部分** | 三件套 README:171、compile 数组✅；RUNBOOK:138/175、tier2:21/tier3:15 仍单 `--by`+allowSimilar:true；CONTRIBUTING"17+"、knowledge 路径、docsDigest、cancel 措辞未修 |
| B-n3/4/5 | **未修复** | 无 version 清单端到端测试；deprecate 数组无测试；rebuildSummary 丢 version/priority |
| 新测试 | **无** | 267 持平 |

**结论：第二十四轮 P1（similarity 子包含）与 compile edge.to 已闭环；其余（B-n2、edge 口径、reconcile、双注册、engineVersion、文档）未修。**

### 17.3 本轮新发现（双代理）

**P1〔新〕validate-yaml 放行即删共享映射，扩大 B-n2 窗口**
- validate-yaml.js:277-288 每次 allow 即 unlink 共享 `invocation-<hash>.json`；该文件是 check-work-order 前后两次写同一节点共用的交接槽，首次 AfterTool 放行后即被删，紧随其后的并发第二次 PreToolUse/AfterTool 读不到映射 → 用 'unknown' 后缀错指 backup/marker，回滚错文件。
- 建议：多槽数组 + 不删共享槽 + 按 invocationId 独立文件。

**P2〔模板子代理〕validate-yaml 合法状态集缺 `blocked`**
- validate-yaml.js:226 合法状态集缺 blocked，而 state-machine.js:24,28 明确合法化 TASK `blocked` → 写入 `status: blocked` 的节点会被 PostToolUse 判非法并回滚，是真实 engine/hook 契约不一致。

**P2〔新〕edge 去重忽略 type**
- edge.js:48 判重只看 from/to，同一对节点无法同时建模 depends 与 refines，第二种类型静默跳过"已存在"。

**P2〔模板子代理〕claude asa-init 静默报完成**
- claude asa-init.js:83-87 在 `~/.asa` 缺失时静默仍报"✅ 初始化完成"（gemini 会警告）；建议对齐补警告并 exit 1。

**P3〔新〕propagate.js:53 写错字段**
- appendChangeLog 生成 `summary` 键（changelog.js:32），propagate.js:53 却写 `.text=`，去敏意图实际未生效（summary 仍含 `--by xxx`）。

**P3（延续）**：matrix 自举 digest/engineVersion 三源互异（claude skeleton 缺 / gemini 有 / reconcile 又一套）；SKILL Tier 表 vs init 建目录冲突；`*.created`/`invocation-*.json` 无限累积。

### 17.4 第二十五轮结论与建议顺序

**有条件通过。** 第二十四轮 P1（similarity ≤2 判重逃逸）与 compile edge.to 数组中已闭环，全量保持全绿；但第二十四轮多项（B-n2、edge 口径、reconcile、双注册、engineVersion、文档）原样遗留，且本轮新指 P1（validate-yaml 删共享映射扩大并发窗口）与 2 个 P2（状态集缺 blocked、claude 静默报完成）；分支 67.20% 连续多轮 <70%。

建议顺序：
1. **修 validate-yaml 共享映射并发（P1）**：多槽 + 不删共享槽 + 按 invocationId 独立文件（连带修 B-n2）。
2. **修 validate-yaml 状态集缺 blocked（P2）**：补 blocked 到合法状态集，消除 engine/hook 契约不一致。
3. **修 edge 去重忽略 type（P2）、claude asa-init 静默报完成（P2）、propagate.js:53 写错字段（P3）**。
4. **修 edge 环检测口径统一、reconcile NODES_DRIFT、compile 已修保持**。
5. **收双注册、cleanTmp/*.created 清理、claude engineVersion + matrix 自举三源统一**。
6. **修 P2-4 文档口径**（豁免、deprecate、--by、命令数、knowledge、digest、cancel）+ 静态契约测试 + SKILL 建目录表。
7. **补分支测试**使 ≥70%。

> 本轮 P1（similarity 子包含）与 compile edge.to 闭环，全量 267/0 全绿保持；但第二十四轮并发/文档/覆盖项几乎原样遗留，且新指 P1（validate-yaml 删共享映射扩大并发窗口）与 2 个 P2（blocked 状态集、claude 静默报完成）——分支 67.20% 连续多轮 <70%，发布仍为有条件通过。

---

## 18. 第二十六轮复审（第二十五轮问题回归 + 独立新深审）

> 复审日期：2026-08-23
> 审核方式：并行双子代理（引擎/命令 / 模板·hooks·文档）独立重读最新快照 + 关键项人工直接读取裁决（blocked 状态集、invocations 多槽）+ 全量测试（统一命令复测）
> 约束：本轮仅追加审核结论，未修改生产代码或测试代码

### 18.1 测试与覆盖率（统一命令复测）

| 指标 | 实测 | 验收 |
|---|---:|---:|
| 测试 | **268 passed / 1 failed / 0 skipped**（269 测试；**连续两轮全绿后再度红**） | **不通过** |
| 行覆盖率 | 90.30% | 通过（≥80%） |
| 分支覆盖率 | 67.26% | **不通过**（目标 ≥70%，67.20→67.26 持平） |
| 函数覆盖率 | 90.32% | 通过（≥85%） |

**失败测试**：`engine/commands/p3_concurrency.test.js:132` `Hook backups are isolated using UUID and prevent concurrency conflicts`（断言行 :157-158 期望 true、实际 undefined）。

### 18.2 第二十五轮问题回归（双代理 + 人工核验）

| 项 | 判定 | 证据 |
|---|---|---|
| P1 validate-yaml 删共享映射（B-n2 窗口） | **部分（多槽已改，但引入回归 + 原子性未修）** | 已改多槽数组 + 空队列才删共享 invocation 文件（validate-yaml:264-295 / check-work-order:176-201）（人工核验）；但出队/回写非原子，且引入 B-1 测试回归 |
| P2 blocked 状态集 | **已修复** | validate-yaml:226 现含 `blocked`（对齐 state-machine:28）（人工核验） |
| P2 edge 去重忽略 type | **未修复** | edge.js:48 仍只看 from/to，同对节点 depends+refines 仍互斥 |
| P2 claude asa-init 静默报完成 | **未修复** | claude asa-init:83-87 index.js 缺失仍无警告、:206 仍报完成；gemini 同（"对齐 gemini"前提不成立） |
| P3 propagate.js:53 写错字段 | **未修复** | :53 仍 `.text=`，key 是 summary（changelog.js:32），去敏未生效 |
| B-n2 invocations 竞态 | **部分** | 多槽 + 按 invocationId 独立 bak 已改；原子写未做 |
| edge 环检测口径 | **未修复** | wouldCreateCycle 检全边 vs plan 仅 depends |
| reconcile 吞 NODES_DRIFT / install 双注册 / cleanTmp / claude engineVersion | **均未修复** | reconcile:389 无条件覆写 nodesDigest；install:121-198 写全局 settings；transaction 只清 tmp/>60s；claude matrix 无 engineVersion |
| P2-4 文档口径 | **部分** | cancel-task 已入文档✅；RUNBOOK allowSimilar/单 --by、命令数三档、deprecate、--by 必填、knowledge、digest 未修 |
| 新测试 | +2（269） | p2_coverage / p4_coverage_hardening 新增 |

**结论：blocked 状态集与多槽改造已落地；但多槽改造引入 B-1 测试回归，其余第二十五轮项（edge type、claude 静默、propagate 字段、环口径、reconcile、双注册、文档）未修。**

### 18.3 本轮关键问题

**P0〔回归，本轮最重要〕测试不再全绿**
- p3_concurrency.test.js:132 失败：:157-158 断言 `map.invocationId`（单数），但 ADR-25 多槽改造把代码改为 `invocationIds` 数组（check-work-order.js:187-188 / validate-yaml.js:268），**该测试未同步更新**（hooks.test.js:190-193 已改对）→ **确定性失败，是第二十五轮 P1/B-n2 "多槽修复"引入的回归**。
- 建议：更新 p3:157-158 断言为 `invocationIds` 数组并验证 FIFO 行为。

**P2〔并发〕多槽出队非原子**
- validate-yaml:293/328、check-work-order:188/308 为 read→`shift()`→`fs.writeFileSync`（无锁、无 tmp+rename）。两个并发 AfterTool/deny 可读到同一队列、shift 出同一 ID、操作同一 bak，回写互相覆盖 → B-n2/P1 竞态窗口被缩小但未根除；invocation 文件本身可能被并发写截断。

**P2〔契约〕validate-yaml 状态集未按 category 区分**
- :226 用单一全局集合校验所有节点类型，ARCH 被写入 `proposed/completed`（state-machine.js:16-21 非法）也能通过 PostToolUse → hook 比 engine 宽松、不回滚该类非法状态。

**P3（模板子代理）matrix 自举三源字段不一致；hooks Windows 大小写敏感 startsWith 误判全局/局部 fail-open/closed（check:52/validate:60）；幂等去重 name 位置两脚本形状不匹配；install 探测缺陷；RUNBOOK 双平台措辞夸大。**

### 18.4 第二十六轮结论与建议顺序

**有条件通过，但需先修测试回归。** blocked 状态集与多槽改造已落地（第二十五轮 P2 闭环）；但多槽改造引入 B-1 测试回归（p3:132 红），且 edge type、claude 静默、propagate 字段、环口径、reconcile、双注册、原子出队、文档口径未闭合；分支 67.26% 连续多轮 <70%。

建议顺序：
1. **修 B-1 回归（P0）**：p3:157-158 断言更新为 `invocationIds` 数组并验证 FIFO。
2. **修多槽出队非原子（P2）**：tmp+rename 原子写 + 并发锁，根除 B-n2 残余竞态。
3. **修 validate-yaml 状态集按 category 区分（P2）**：REQ/ARCH/TASK 各自状态集校验。
4. **修 edge 按 type 判重、edge 环检测口径统一、reconcile 不吞 NODES_DRIFT、propagate:53 字段**。
5. **修 claude asa-init 静默报完成（~/.asa 守卫）、install 双注册、cleanTmp、engineVersion + matrix 三源统一**。
6. **修 P2-4 文档口径** + 静态契约测试 + 命令数统一。
7. **补分支测试**使 ≥70%。

> 本轮 blocked 状态集与多槽改造落地，但多槽改造引入 B-1 测试回归（p3:132 红，连续两轮全绿后再红），且第二十五轮大部分未闭合项原样遗留、多槽出队仍非原子；分支 67.26% 连续多轮 <70%——发布需先恢复全绿并收敛并发原子性。

---

## 19. 第二十七轮复审（第二十六轮问题回归 + 独立新深审）

> 复审日期：2026-08-23
> 审核方式：并行双子代理（引擎/命令 / 模板·hooks·文档）独立重读最新快照 + 关键项人工直接读取裁决（P0 B-1 测试断言）+ 全量测试（统一命令复测）
> 约束：本轮仅追加审核结论，未修改生产代码或测试代码

### 19.1 测试与覆盖率（统一命令复测）

| 指标 | 实测 | 验收 |
|---|---:|---:|
| 测试 | **272 passed / 0 failed / 0 skipped**（较上轮 269/1，**恢复全绿**） | 通过 |
| 行覆盖率 | 90.45% | 通过（≥80%） |
| 分支覆盖率 | 67.90% | **不通过**（目标 ≥70%；67.26→67.90 升，仍需补约 2.1%） |
| 函数覆盖率 | 90.58% | 通过（≥85%） |

### 19.2 第二十六轮问题回归（双代理 + 人工核验）

| 项 | 判定 | 证据 |
|---|---|---|
| P0 B-1 测试回归（p3:132） | **已修复** | p3:157-158 改为 `Array.isArray(map.invocationIds)`+FIFO（人工核验）；全量 272/0 恢复全绿 |
| 多槽出队非原子 | **已修复** | check:179-194/306-334、validate:297-319 均 `lockFile`+tmp+rename 原子写 |
| validate-yaml 状态集按 category | **已修复** | validate:225-236 REQ/ARCH/TASK 各自 Set（含 blocked） |
| edge 去重忽略 type | **已修复** | edge.js:48-52 加 `(e.type‖'depends')===(type‖'depends')` |
| propagate:53 写错字段 | **已修复** | :53 改 `.summary="从已取消状态恢复"` |
| edge 环检测口径 / install 双注册 | **均已修复** | graph.js:66-70 过滤 depends（对齐 plan）；install.js:121-140 改为清理全局 hooks 残留（不再写入） |
| claude asa-init 静默报完成 | **未修复** | :83-87 缺 ~/.asa 守卫、:206 仍报完成、无 exit≠0（gemini 同，无顶层守卫） |
| reconcile NODES_DRIFT / cleanTmp / claude engineVersion | **均未修复** | reconcile:389 无条件覆写 nodesDigest；transaction 仍不清理 .created/invocation-*/.lock；claude matrix 无 engineVersion |
| P2-4 文档口径 | **部分** | add.js allowSimilar 对象✅；RUNBOOK allowSimilar/单 --by、deprecate、--by 必填、知识路径、digest、cancel、空围栏、blocked 未修 |
| 新测试 | +3（272） | edge type 共存/refines 非环、propagate summary 审计 |

**结论：P0 回归闭环、全量恢复全绿；原子出队、状态按 category、edge type、propagate、环口径、install 双注册均已修复；claude 守卫、reconcile、cleanTmp、engineVersion、文档未修。**

### 19.3 本轮新发现

**P1〔新回归〕ARCH 状态集漏 `approved`（改 category 引入的过严回归）**
- state-machine.js:19 ARCH 合法含 `approved`（`approved:['superseded','draft']`），但 validate-yaml:230 新集合 `{draft,reviewed,superseded}` 缺 `approved` → 写入合法 ARCH approved 会被 PostToolUse 判非法回滚。
- 反向：validate-yaml:228 REQ 集合含 `verified`，而 state-machine.js:8-15 REQ 无此态 → hook 比引擎宽松，接受非法态。建议与 state-machine 单一来源比对。

**P2〔新〕`*.lock` 陈旧残留将永久失效原子锁并造成旁路竞态**
- 两 hook 每次读写都建 `invocation-*.json.lock`；崩溃残留后 lockFile 忙等 5000ms → 返回 null → **代码无锁继续** read→modify→unlink（check:313/validate:298），使刚引入的 tmp+rename 保护在崩溃后静默脱离，且每 Hook 卡 5s；cleanTmpFiles 永不清 `.lock`。建议 Fail-Closed 或按 age 清陈旧锁，cleanTmp 纳入 .lock/.created。

**P2〔新〕BeforeTool deny 端消费 FIFO 会销毁他者备份**
- check 的 deny()（:344 接 getInvocationBackupPaths）对同一路径做 shift+删 .bak/.created；同路径并发 A(push+allow)、B(push+deny) 时 B shift 走 A 的 id 并删 A 预览备份 → A 的 AfterTool 无据回滚。生产端与消费端未分离。

**P2（模板子代理）lockFile 超时返 null 仍继续写队列** → 高竞争丢锁仍写，可重置 invocation 队列，建议超时 Fail-Closed。

**P3**：propagate:52-53 先写带 --by 脏 summary 再靠 length-1 索引覆盖（脆弱）；edge rm 无视 type；reconcile:394-401 同时覆写 docsActualDigest 掩盖 docs drift；install readdirSync 健壮性；GEMINI/CONTRIBUTING 覆盖旧值；命令数三档（17+/24/32）未统一。

### 19.4 第二十七轮结论与建议顺序

**有条件通过；本轮恢复全绿、覆盖再创新高。** P0 回归闭环，第二十六轮并发/契约核心（原子出队、状态按 category、edge type、propagate、环口径、install 双注册）大部闭环；但新指 P1（ARCH 状态集漏 approved 的自引回归）、P2（陈旧 .lock 失效锁、deny 端 FIFO 销毁他者备份），claude 守卫与文档口径未闭合，分支 67.90% 连续多轮 <70%。

建议顺序：
1. **修 ARCH 状态集漏 approved（P1）**：与 state-machine 单一来源比对，消除误回滚/过宽。
2. **修 *.lock 陈旧失效 + lockFile 超时 Fail-Closed（P2）**：纳入 cleanTmp，锁超时不无锁写。
3. **修 deny 端/消费端 FIFO 分离（P2）**：避免销毁他者并发备份。
4. **修 reconcile（NODES_DRIFT + docs drift）、claude asa-init ~/.asa 守卫、cleanTmp、engineVersion + matrix 三源统一**。
5. **修 P2-4 文档口径**（allowSimilar、deprecate、--by、命令数、knowledge、digest、cancel、空围栏、blocked）+ 静态契约测试 + 模板 rule5 收敛。
6. **补分支测试**使 ≥70%（当前差约 2.1%）。

> 本轮 P0 回归闭环、全量 272/0 恢复全绿、覆盖再创新高（行 90.45/分支 67.90/函数 90.58），第二十六轮并发/契约核心大部闭环；但新指 P1（ARCH 状态集漏 approved 自引回归）与 P2（陈旧 .lock 失效锁、deny 端 FIFO 销毁他者备份）需发布前收敛，分支 67.90% 连续多轮 <70%——发布仍为有条件通过。

---

## 20. 第二十八轮复审（第二十七轮问题回归 + 高质量深审）

> 复审日期：2026-08-23
> 审核方式：并行双子代理（引擎/命令 / 模板·hooks·文档）独立**高质量深审**最新快照（重点挖此前 27 轮未记录隐藏缺陷）+ 关键项人工直接读取裁决（P1 ARCH 状态集 vs state-machine）+ 全量测试（统一命令复测）
> 约束：本轮仅追加审核结论，未修改生产代码或测试代码

### 20.1 测试与覆盖率（统一命令复测）

| 指标 | 实测 | 验收 |
|---|---:|---:|
| 测试 | **272 passed / 0 failed / 0 skipped**（全绿保持，无新增测试） | 通过 |
| 行覆盖率 | 90.43% | 通过（≥80%） |
| 分支覆盖率 | 67.90% | **不通过**（目标 ≥70%，连续 28 轮 <70%） |
| 函数覆盖率 | 90.58% | 通过（≥85%） |

### 20.2 第二十七轮问题回归（双代理 + 人工核验）

| 项 | 判定 | 证据 |
|---|---|---|
| P1 ARCH 缺 approved / REQ 含 verified（自引回归） | **未修复** | validate-yaml:230 ARCH 仍 `{draft,reviewed,superseded}` 缺 approved；:228 REQ 仍含 verified（人工核验 + 实测：ARCH approved → hook exit2「非法 status:approved」；REQ verified → 放行） |
| *.lock 陈旧失效 / lockFile Fail-Closed | **未修复** | 两 hook lockFile 5s 超时仍返 null 后无锁继续；无按 age 清陈旧锁；transaction 仍不清理 .lock/.created |
| deny 端 FIFO 销毁他者备份 | **未修复** | getInvocationBackupPaths 内部即 shift() 消费，allow 与 deny 都调它，deny 仍 shift 走他者 id 并删其备份 |
| reconcile NODES_DRIFT + docs drift | **未修复** | reconcile:388-389 无条件覆写 nodesDigest；:394-403 覆写 docsActualDigest 并保存 → 跑 reconcile 掩 4 类 drifts |
| claude ~/.asa 守卫 / engineVersion / matrix 三源 | **未修复（部分）** | claude asa-init:85-109 无 ~/.asa 守卫、:206 仍报完成；matrix 仍缺 engineVersion（三源仅 claude 缺、gemini/skeleton 互异） |
| P2-4 文档口径 | **部分** | 三件套 allowSimilar 对象、cancel-task 入档✅；RUNBOOK allowSimilar:true、deprecate 范围、--by、knowledge 路径、docsDigest、命令数三档未修 |
| 新测试 | **无** | 272 持平 |

**结论：第二十七轮 P1/P2（ARCH approved、lock 失效、deny FIFO、reconcile drift、claude 守卫、文档）全部未修复；仅全绿与覆盖保持。**

### 20.3 本轮高质量新发现（此前 27 轮未记录）

**新·B2〔P2 状态机一致性〕propagate 可无 --by 直推 TASK→verified**
- status.js:37-41 要求 `completed→verified` 必须 `--by` 终态审批；但 propagate.js:58-67 的 set_status 无 verified/终态卫兵，对 TASK completed→verified 直接放行（state-machine:26 合法）→ 与 status 的 --by 终态审批构成**两路径不一致**，可用 pendingPropagation 绕过验证审计。与第二十一轮 B1（cancelled→pending）同型，但落在 verified 终态侧。
- 建议：propagate 对齐 status 的 verified 需 --by 守卫并补测试（此前仅覆盖 cancelled→pending 与 awaiting 三出口）。

**新·B1〔P2 错误吞没/残余窗口〕hook 损坏队列被静默删除**
- 两 hook getInvocationBackupPaths（validate:307-317 / check:322-332）`catch(e){}` 吞 JSON 解析失败；失败后 invocationIds 仍空 → `unlinkSync(invocationFile)` 把损坏队列直接删掉、invocationId 落 'unknown'、备份错指 → 真备份永久孤儿且映射丢失。建议解析失败勿删队列、Fail-Closed 保留现场。

**新·B3〔P3 性能〕重复读盘**：每条写命令尾部都 compile() 重载全量 matrix+nodes+重写 docs；deprecate 级联 reconcile()+compile() 双重重读；单命令多次 O(N) 全盘扫描。建议 compile 幂等去重/级联合并。

**新·（模板子代理）SKILL"语义化合并"overclaim〔P2〕**：SKILL:97/68 宣称 CLAUDE/GEMINI.md 会"语义化合并保留用户规约"，但 asa-init 实际=存在即跳过/--force 备份+整覆盖，无合并算法 → 模型据 SKILL 误判 force 后用户叙事被保留，实为覆盖。**确认规则漏 cancel 出口〔P2〕**（模板仅给 confirm/reject 语法）。**判重特批快参仅写 --by〔P2〕**（add.js 强制 `--allow-similar --reason --by` 三件套且须等于 top-id，照模板必失败）。**hook stdin 超时未 clearTimeout〔P3〕**（大 payload 并发双 deny 重复操作队列）。

### 20.4 第二十八轮结论与建议顺序

**有条件通过。** 全量 272/0 全绿保持，但第二十七轮 P1/P2 全部原样未修复；本轮高质量深审新指 B2（propagate 可绕过 verified --by 终态审批，与 status 两路径不一致）与 B1（hook 损坏队列静默删除）为发布前需收敛的状态机/数据完整性问题；分支 67.90% 连续 28 轮 <70%。

建议顺序：
1. **修 propagate 无 --by 直推 verified（B2）**：对齐 status 终态守卫 + 测试。
2. **修 P1 ARCH 状态集漏 approved / REQ verified 过宽**：与 state-machine 单一来源比对。
3. **修 hook 损坏队列吞错删除（B1）**：解析失败勿删、Fail-Closed 保留现场。
4. **修 *.lock 陈旧失效/lockFile Fail-Closed、deny 端 FIFO 分离、reconcile 掩 drift、cleanTmp**。
5. **修 claude ~/.asa 守卫、engineVersion、SKILL 语义化合并 overclaim、确认规则 cancel 出口、判重特批三件套、hook timeout**。
6. **修 P2-4 文档口径** + 静态契约测试 + 命令数统一。
7. **补分支测试**使 ≥70%。

> 本轮全量 272/0 全绿保持，但第二十七轮 P1/P2 全部未修复；高质量深审新指 B2（propagate 可无 --by 直推 TASK→verified，与 status 终态审批两路径不一致）与 B1（hook 损坏队列静默删除）——状态机终态审批与数据完整性为发布前最后关，分支 67.90% 连续 28 轮 <70%，发布仍为有条件通过。

---

## 21. 第二十九轮复审（6 项专门修复核验 + 独立深审）

> 复审日期：2026-08-23
> 审核方式：并行双子代理（引擎/命令 / 模板·hooks·文档）独立核验本轮 6 项修复 + 全量测试（统一命令复测）+ 关键项人工直接读取裁决（propagate verified 卫兵、validate-yaml 状态集）
> 约束：本轮仅追加审核结论，未修改生产代码或测试代码

### 21.1 测试与覆盖率（统一命令复测）

| 指标 | 实测 | 验收 |
|---|---:|---:|
| 测试 | **274 passed / 0 failed / 0 skipped**（较上轮 272 +2，为本轮 TDD 新增测试） | 通过 |
| 行覆盖率 | 89.55% | 通过（≥80%；较上轮 90.43 略降，新增守卫/死代码抬高分母） |
| 分支覆盖率 | 67.60% | **不通过**（目标 ≥70%，连续 29 轮 <70%） |
| 函数覆盖率 | 90.05% | 通过（≥85%） |

### 21.2 本轮 6 项修复核验（双代理 + 人工核验）

| # | 修复项 | 判定 | 证据 |
|---|---|---|---|
| 1 | propagate completed→verified 需 --by（B2） | **正确** | propagate.js:66-82 对称卫兵，validateTransition 通过后强校验 --by 且拒 `system`；commands.test.js:853-889 真实断言（无 --by 锁定 / --by 放行+审计）（人工核验）。唯一偏差：比 status 更严（允许 --by system），方向安全 |
| 2 | validate-yaml REQ/ARCH 状态集（P1） | **正确** | validate-yaml:228 REQ 剔 verified、:230 ARCH 补 approved、:232 TASK 7 态，逐键与 state-machine 完全一致；hooks.test.js:238-257 真实断言（ARCH approved 放行 / REQ verified exit2）（人工核验） |
| 3 | check-work-order deny() 不再消费队列（B2） | **正确（实现）** | check:357-366 deny 纯净化，不再 shift/删备份；但 getInvocationBackupPaths(:316-355) 已成**死代码**、无专属 deny 测试 |
| 4 | getInvocationBackupPaths 物理自举目录 | **正确** | check:170 / validate:303 mkdirSync recursive，根治 lockFile ENOENT |
| 5 | hook 损坏映射拒绝静默删除（parseFailed） | **正确（实现）/覆盖缺+不完整** | validate:307-340 保留现场不 unlink（实测损坏文件未删）；check:322-340 的 parseFailed 在死函数中未生效；validate 损坏 JSON 分支未覆盖测试 |
| 6 | Claude asa-init.js + install.js 删全局 hooks（P1-6） | **正确（主体）** | 项目级 settings.local.json + 按 name 幂等 + 拷 version + 剔 helpers；install.js:121-140 仅清理全局 hooks、不新增；**物理单注册成立**。唯一缺：claude matrix 缺 engineVersion |

**结论：6 项中 #1/#2/#4/#6 完整正确，#3/#5 实现正确但存在死代码与覆盖/一致性缺口。**

### 21.3 本轮新发现

**C-P2〔数据一致性〕跨 hook "保留现场"不一致**
- check-work-order BeforeTool 内联队列(:180-193)在 `catch(){}` 后以空数组覆写，下次同路径写入会**销毁 validate 刚"保留"的损坏 invocation 现场**——"保留现场"仅存活到下一次 Before 写。

**P3〔泄漏〕deny() 纯净化后遗留孤儿**
- 被拦截的 .yaml 写已建备份(step4 :196-207)+入队 id，deny 不清 → 孤儿 .bak/队列项；Claude 模式 deny 后 PostToolUse 不触发，孤儿持久。

**P3〔死代码〕** check getInvocationBackupPaths(:316-355) 及其中 parseFailed 逻辑(:320-355) 未执行，建议删除或复用。

**P4〔对称性〕** status.js:37-41 仍放行 `--by system`，verified 人工审计在 status 路径可被伪造（propagate 已拒 system，比 status 更严——非本轮引入）。

**其他开放（未触碰）**：reconcile 掩 drift、engineVersion 三源、P2-4 文档口径（allowSimilar/deprecate/--by/命令数/knowledge/digest）、SKILL Tier 表/语义化合并/rule5 overclaim、claude matrix engineVersion、~/.asa 守卫、hook timeout（claude 侧未设 15000）。

### 21.4 第二十九轮结论与建议顺序

**有条件通过；本轮 6 项专门修复主体正确、无新代码级回归。** 状态机终态审批（#1）、状态集契约（#2）、deny 净化（#3）、自举（#4）、parseFailed（#5 代码侧）、Claude 单注册（#6）均已落地并可实测验证；但新指 C-P2（跨 hook 保留现场不一致），死代码/覆盖缺口，reconcile/engineVersion/文档口径未闭合，分支 67.60% 连续 29 轮 <70%。

建议顺序：
1. **修 C-P2 跨 hook 保留现场不一致**：check BeforeTool 不再空数组覆写队列；统一 parseFailed 语义（或让 check 复用 validate 的保留策略）。
2. **处理死代码 getInvocationBackupPaths / 冗余 parseFailed**：check 侧删除或接回，避免实现与行为歧义。
3. **修 deny 孤儿 .bak/队列项**：被拦写盘保留现场复用，或拦截前不建备份。
4. **补齐 #3/#5 无测试覆盖的分支**（deny 不消费队列、损坏 JSON 保留）→ 顺带抬升分支覆盖。
5. **补 status --by system 对称（P4）、reconcile 掩 drift、claude matrix engineVersion、~/.asa 守卫**。
6. **修 P2-4 文档口径**（模板 rule5/判重三件套/cancel/exec/deprecate/allowSimilar/命令数/knowledge/digest）+ 静态契约测试。
7. **补分支测试**使 ≥70%。

> 本轮 6 项专门修复主体正确（#1 propagate verified 卫兵含 system 拦截、#2 状态集逐键对齐 state-machine 二者经人工核验，另 #3/#4/#6 成立），全量 274/0 恢复并保持全绿；但新指 C-P2（check BeforeTool 空数组覆写会销毁 validate 保留的损坏现场）、死代码与覆盖缺口，reconcile/engineVersion/文档口径未闭合，分支 67.60% 连续 29 轮 <70%——发布仍为有条件通过。

### 21.5 覆盖复检专项（用户反馈"覆盖率已提升"后复测）

> 复测日期：2026-08-24。用户称新增测试后覆盖率提升；统一原生口径复测还原真相（同命令 Get-ChildItem engine -Recurse *.test.js + node --test --experimental-test-coverage，多次重跑确认稳定）。

| 指标 | 实测（多次重跑） | 上轮（§21.1） | 结论 |
|---|---:|---:|---|
| 测试 | **290 passed / 0 failed**（+16，新增 p4_coverage_hardening.test.js） | 274 | 全绿，+16 TDD（list/search/link/record-changes/plan-tasks/doctor/diagnose/update-overview 成败与空/错误分支） |
| 行覆盖率 | 88.32–88.53% | 89.55% | **略降**（新增 hook 守卫/未覆盖分支抬高分母） |
| 分支覆盖率 | **66.06–66.73%** | 67.60% | **不升反降，且远未达 70%** |
| 函数覆盖率 | 90.58% | 90.05% | 升 |

**关键结论：统一归一原生口径下，新增测试后覆盖率并未提升，反而行/分支微降；分支 66-67% 连续 30 轮 <70%。**
- 新 `p4_coverage_hardening.test.js` 为高质量 TDD，显著提升 CLI 命令级**行**覆盖（新增 list/search/link/record/plan/doctor/diagnose/overview 大量路径）；但涉命令行本就部分覆盖，增量有限。
- **拖累项**：本轮新增的 hook 守卫/死代码分支未测 → 两 hook 文件分支覆盖极低：
  - `check-work-order.js`：行 70.77% / **分支 36.17%** / 函数 76.92%（未覆盖含 :47-63、:111-116、:224-226、:291-306、:316-355 死代码等）
  - `validate-yaml.js`：行 75.26% / **分支 33.33%** / 函数 73.33%（未覆盖含 :51-75、:111-127、:276-291、:320-325 parseFailed 分支等）
  - `index.js`：行 97.83% / 分支 60% / 函数 66.67%
- 两 hook 分支仅 33-36% 是整体分支未达 70% 的首要缺口（其余 lib/commands 多 ≥90%）。

> 用户所述"覆盖率提升"与统一原生口径实测（不升反降）不一致——可能因口径差异（c8 过程内/部分文件子集，c8 曾给分支 74.30，与原生不同）。审查以**统一归一原生口径**为准：分支 66-67% 未达、且 hooks 分支极低，为发布前唯一硬性未达标项。建议为两 hook 的 deny 净化/parseFailed/超时/状态集分支补专门测试（连同上轮 #3/#5 覆盖缺口），预计可显著抬升分支。

### 21.6 覆盖调整后复测（用户补测试后再测）

> 复测日期：2026-08-24。用户据 §21.5 补测后复核（同统一归一原生口径，多次重跑确认稳定）。

| 指标 | 实测 | §21.5 上轮 | 结论 |
|---|---:|---:|---|
| 测试 | **299 passed / 0 failed**（+9） | 290 | 全绿，补齐 hook/edge/reconcile 分支测试 |
| 行覆盖率 | 89.28% | 88.32–88.53% | 回升 |
| 分支覆盖率 | **67.94%** | 66.06–66.73% | **回升约 1.2pp，但 <70%** |
| 函数覆盖率 | 90.58% | 90.58% | 持平 |

**关键文件分支变化**：
- `validate-yaml.js`：分支 **33.33% → 45.31%**（明显提升，补齐 parseFailed/状态集分支；行 75.26→80.66）
- `check-work-order.js`：分支 **36.17% → 36.17%（不变）**，行 69.95（未覆盖含 :47-63、:111-116、:221-251、:313-355 死代码等）——**仍是最大缺口**
- `index.js`：分支 60%（未覆盖 :225-226 等）
- `edge.js` 分支 42.86%、`propagate.js` 分支 48.98%、`reconcile.js` 分支 47.62%（未覆盖含 :141-174、:325-332 等）

**结论：分支回升至 67.94%，但仍差约 2.06 未达 70%。** validate-yaml 补测有效；但 check-work-order（占分支最大缺口）本轮未补测，其 deny 净化/超时/死代码(:313-355)分支仍 36.17%，是下一步最应补的单一文件。补齐后预计分支可过 70%。

> 覆盖复检趋势：§21.5 原生 66-67%（首次复核不升反降）→ §21.6 用户补测后 67.94%（回升但仍 <70%）。统一口径下分支连续 30+ 轮未达；CheckWorkOrder 分支 36.17% 为最后硬缺口，建议优先补其 deny/超时/死代码分支测试。

---

## 22. 第三十轮复审（第二十九轮遗留回归 + 覆盖补测复核 + 独立深审）

> 复审日期：2026-08-24
> 审核方式：并行双子代理（引擎/命令 / 模板·hooks·文档）独立重读最新快照 + 关键项人工直接读取裁决（check-work-order 损坏映射 Fail-Closed、死代码移除、原子写）+ 全量测试（统一命令复测）
> 约束：本轮仅追加审核结论，未修改生产代码或测试代码

### 22.1 测试与覆盖率（统一命令复测）

| 指标 | 实测 | 验收 |
|---|---:|---:|
| 测试 | **302 passed / 0 failed / 0 skipped**（较上轮 299 +3，新增 p4_hooks_booster 等 7 例） | 通过 |
| 行覆盖率 | 90.34% | 通过（≥80%，较上轮 89.28 创新高） |
| 分支覆盖率 | 68.19% | **不通过**（目标 ≥70%；较上轮 67.94 微升，连续 31 轮 <70%） |
| 函数覆盖率 | 91.05% | 通过（≥85%，创新高） |

### 22.2 第二十九轮问题回归（双代理 + 人工核验）

| 项 | 判定 | 证据 |
|---|---|---|
| check-work-order：死代码/deny 纯净化/lockFile/parseFailed | **部分（实现到位，覆盖不足）** | 死代码 getInvocationBackupPaths **已删**；deny 纯净化仅打印退出(:330-338)；lockFile 超时抛错 Fail-Closed(:316)；损坏 JSON parseFailed throw 保留现场(:177-191)（人工核验）；但分支仍 36.96% 是全引擎最大缺口 |
| reconcile 吞 NODES_DRIFT | **NODES_DRIFT 未修复 / docs 已规避** | reconcile:389 无条件覆写 nodesDigest → 掩 validate:64 NODES_DRIFT；docs drift 已规避（reconcile 只刷 Actual 不碰 Expected） |
| status vs propagate --by system 对称 | **未修复** | status.js:38 仍放行 `--by system`（propagate.js:74 已拒）→ verified 人工审计在 status 路径仍可伪造 |
| invocations 原子出队 / edge | **均已修复** | check/validate 均 lock+tmp+rename 原子；graph.js:67 仅 depends；edge 去重含 type(resolve) |
| claude engineVersion / install 双注册 | **engineVersion 未修 / 双注册已修** | claude asa-init:40-51 建 matrix 仍无 engineVersion；install.js:121-140 只清全局不写 → 物理单注册 |
| validate-yaml 状态集按 category | **保持正确** | :224-229 REQ 剔 verified、ARCH 含 approved、TASK 含 blocked，与 state-machine 逐键一致 |
| P2-4 文档口径 | **部分** | 三件套 README/ASA-GUIDE 正确；RUNBOOK:175 allowSimilar、GEMINI [--by]、deprecate 范围、命令数、knowledge、digest、cancel 未修 |

**结论：死代码删除、原子写、parseFailed、双注册、状态集、edge 已闭环；reconcile NODES_DRIFT、status --by system、claude engineVersion、文档口径未修。**

### 22.3 本轮新发现

**新·P2〔并发·mtime 抢占活锁〕hook lockFile 偷活锁**
- check-work-order:296-322 / validate-yaml:264-290 的 lockFile 以**空文件+mtime>10s 即 unlink 重新抢占**（:307-312），锁文件无 PID、持有方从不 touch 心跳。持有者被暂停 >10s（GC/大 payload）即被并发进程偷走**活动**锁 → 队列读改写丢更新。与引擎 lock.js:72「PID 存活判定、活进程无论年龄绝不让步」**不一致**，违反规格 §⑧"活进程不得抢占"。建议锁内写 PID+时间戳、isProcessAlive 判定、touch 心跳。

**新·P2〔错误吞没·回滚完整性〕check 队列写空 catch 吞错**
- check-work-order:193-197 推送 invocation 队列的 tmp+rename 用**空 catch(e){} 吞错**。写入失败后备份/标记已建而队列未持久 → validate 的 PostToolUse 无法按 invocationId 匹配回滚，遗留孤儿 .bak、非法 YAML 无法物理还原。建议向上抛错 Fail-Closed 或打日志（对齐 reconcile saveMatrix）。

**新·P3〔队列孤儿累积〕deny 前已 push+建备份、deny 不消费**：反复 deny 使 invocation-<hash>.json 队列无限增长 + 孤儿 .bak/.created 残留（cleanTmpFiles 也不清）。

**新·（模板子代理）**：hook stdin path 别名缺 tool_call.input→实测恒 deny；clients/claude/scripts/asa-init.js 为孤儿字节同副本（install 只部署 .claude 版）；status --by system 仍放行（P4）。

### 22.4 第三十轮结论与建议顺序

**有条件通过；本轮死代码删除、原子写、parseFailed、双注册、状态集闭环，覆盖行/函数创新高。** 但分支 68.19% 连续 31 轮 <70%（check-work-order 36.96% 为最大缺口），reconcile NODES_DRIFT、status --by system、claude engineVersion、文档口径未闭合，且新指 P2（hook lockFile 偷活锁、队列写吞错）。

建议顺序：
1. **修 hook lockFile 偷活锁（P2）**：锁内写 PID+时间戳 + touch 心跳 + isProcessAlive（对齐引擎 lock.js，符合 §⑧）。
2. **修 check 队列写空 catch 吞错（P2）**：向上抛错 Fail-Closed，保回滚完整性。
3. **修 reconcile 掩 NODES_DRIFT、status --by system 对称**。
4. **修 deny 孤儿累积（P3）：deny 清自建队列/备份，或拦前不建**。
5. **修 claude asa-init（~/.asa 守卫、matrix engineVersion、hook timeout、孤儿副本）**。
6. **修 P2-4 文档口径** + 静态契约测试 + 命令数统一。
7. **补分支测试**使 ≥70%（check-work-order 为首要）。

> 本轮死代码删除、原子写、parseFailed、双注册、状态集闭环，全量 302/0 全绿、行 90.34%/函数 91.05% 创新高；但分支 68.19% 连续 31 轮 <70%（check-work-order 36.96% 为最大缺口），并新指 P2（hook lockFile 偷活锁违反 §⑧、check 队列写吞错危及回滚）——发布仍为有条件通过。

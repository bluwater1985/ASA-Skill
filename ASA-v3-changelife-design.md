# ASA v3 变更生命周期设计

> 日期: 2026-07-30
> 目标: 将 ASA 从「只读快照管理器」升级为「全链路变更管理器」，支持需求的新增、修改、影响分析与自动传播。

---

## 现状诊断

当前 ASA v3 的能力：

| 命令 | 能力 | 方向 |
|------|------|------|
| `compile` | 节点 → docs 编译 | 单向输出 |
| `patch` | docs → 节点反向同步 | 单向回写 |
| `traverse` | 沿 edges 图 BFS，输出 blast radius | 只读分析 |
| `reconcile` | 修复 matrix.yaml 与节点文件的状态不一致 | 状态对齐 |
| `validate` | 检查 digest + 文件存在性 | 只读校验 |

### 四个缺口

1. **没有新增需求入口** — 16 个 REQ 写死在 YAML 里，新增需求没有命令支持
2. **没有变更传播链** — 改一个 REQ 的接受条件后，traverse 只告知影响，不更新受影响节点
3. **没有生命周期状态机** — 所有节点 `status: pending`，没有状态演进
4. **traverse 只读不写** — BFS 出 blast radius 就结束了，没有配套的 impact/propagate

---

## 设计

### 一、数据模型升级

每个节点（REQ / ARCH / TASK）增加 `changeLog` 和 `version` 字段。`matrix.yaml` 的 `meta` 中增加 `schemaVersion` 字段：

```yaml
# 示例：修改后的 REQ 节点
id: "REQ-003"
title: "规则检查引擎"
status: "modified"        # 新状态，非 pending
version: 2

# ── 纯历史记录（已完成的事件，不可变） ──
changeLog:
  - date: "2026-07-30"
    type: "modified"
    version: 2            # 关联的版本号
    summary: "增加爬电距离检查能力"
    by: "user"

# ── 传播待办（仅保留未完成传播的条目，完成后即清除） ──
pendingPropagation:
  - changeVersion: 2
    status: "pending"     # pending | partial（完成后直接清除，不经过 done）
    affectedNodes:
      - id: "ARCH-003"
        action:
          type: set_status          # 支持 set_status | append_to_array | set_field | replace_in_array
          value: "draft"
      - id: "TASK-005"
        action:
          type: append_to_array
          target: "outputs"
          value: "爬电距离原子函数"
      - id: "TASK-006"
        action:
          type: append_to_array
          target: "outputs"
          value: "DSL 支持 CREEPAGE 关键字"
```

**设计理由**：
- `changeLog` 只记已发生的变更（写一次永不改），`pendingPropagation` 只跟踪未完成的传播（完成后清除）。二者职责分离后，查询"所有需要传播的变更"只需扫描 `pendingPropagation` 数组，不需要遍历全部历史记录。
- `action` 使用**结构化指令**而非自然语言字符串，使得 `propagate` 可以**确定性执行**（纯 CLI 操作，不依赖 AI 解析语义）。每条指令包含明确的 `type`（操作类型）、`target`（目标字段）、`value`（目标值），CLI 可据此实现幂等检查（如 `append_to_array` 先检查数组是否已包含目标值）。

### 二、三套独立状态机

```
REQ 状态机:
  proposed ──→ approved ────→ implemented ──→ deprecated
      │              │  ↓           │
      │              │ modified ←───┘              ◄── implemented→modified
      │              │   │
      └──→ rejected  ←───┘
        (评审不通过)    (重新评估后回到 approved)

  说明：proposed 的需求评审不通过则记为 rejected 而非无限期挂在 proposed。
       approved/implemented 的 REQ 在发生需求变更时进入 modified 状态，
       调整后再评估回到 approved。deprecated 的下游任务可批量标记为 cancelled。

ARCH 状态机:
  draft ──→ reviewed ──→ approved ──→ superseded
      ↑                      │
      └──────────→ draft ←───┘
        (修订/否决后重开)

TASK 状态机:
  pending ──→ in_progress ──→ completed ──→ verified
      │  ↑          │  ··│              │
      │  │          ↓    ·               │
      │  └─── blocked ─→ in_progress     │
      ↓                (解封)            │
  cancelled ───── pending (恢复)          │
      ↑··································│
      ↑ (虚线：仅 deprecate 级联可触发，绕过状态机校验)
```

**非法跳转规则**：直接拒绝不符合状态机路径的转换（例如 `pending → verified` 不允许、`completed → in_progress` 不允许）。

**状态变更动作**：每个状态变更记录到对应节点的 `changeLog`（追加一条 type 为对应状态名称的记录）。

### 三、新增 CLI 命令

| 命令 | 做什么 |
|------|--------|
| `asa add-req <title> [--priority P1]` | 分配新 ID，从模板创建节点 YAML，自动建议 edges |
| `asa change-req <REQ-ID>` | 快照当前节点到 `.asa/backups/` → 输出文件路径供 AI Agent 编辑 → 编辑完成后提示运行 `asa impact <REQ-ID>` 做影响分析 |
| `asa change-req <REQ-ID> --editor` | 同上，但启动 `$EDITOR` 交互编辑而非 AI 接管 |
| `asa change-arch <ARCH-ID>` | 修改架构节点（同 change-req 逻辑） |
| `asa change-task <TASK-ID>` | 修改任务节点（不触发 impact——修改 TASK 不触发传播链） |
| `asa impact <REQ-ID>` | 升级版 `traverse`：输出可读 Impact Report |
| `asa propagate <REQ-ID>` | 沿 blast radius 级联更新所有受影响节点 |
| `asa status <ID> <new-status>` | 按状态机规则推进，非法跳转拒绝 |
| `asa journal` | 查看全项目变更历史 |
| `asa history <ID>` | 查看某个节点的变更沿革 |
| `asa add-arch <title>` | 新增架构节点 |
| `asa add-task <title>` | 新增任务节点 |
| `asa deprecate <ID>` | 标记节点为 deprecated + 自动正向 BFS 级联下游 TASK 为 cancelled |
| `asa edge add <from> <to> --type depends\|extends\|refines` | 新增依赖边（新增前执行循环检测） |
| `asa edge rm <from> <to>` | 删除依赖边 |

> **变更链入口**：REQ 是传播链的**唯一入口**。需求变更通过 `change-req` → `impact` → `propagate` 自动级联到下游 ARCH/TASK。`change-arch`/`change-task` 用于直接修改节点数据但**不触发传播链**——架构或任务的修改应通过上游 REQ 变更驱动。

**边的方向约定**：`from → to` 表示"`from` 处于上游，`to` 处于下游"（即 `to` 依赖于/实现自/细化于 `from`）。正向 BFS 沿 `from → to` 方向遍历（找下游），逆向 BFS 沿 `to → from` 方向回溯（找上游）。

**循环检测**（`edge add` 执行时自动运行）：在新增 `from → to` 边之前，从 `to` 节点出发沿**正向**方向做 BFS（遍历现有边中所有 `from → ...`）。如果能到达新边的 `from`，说明新边会形成环，拒绝操作并输出环路径。`traverse/impact` 本身用 `visited set` 避免无限 BFS，这只是自保；`edge add` 的循环检测主动阻止创建坏边。

#### `deprecate` 级联规则

当标记一个节点为 `deprecated` 时，自动触发**正向** BFS（沿 `edges` 的 `from → to` 方向找下游节点）：

```
$ asa deprecate REQ-003
[ASA] REQ-003 → deprecated ◄── 操作确认后执行
  → 正向 BFS 遍历下游节点...
  → TASK-005: set_status cancelled (前: in_progress) ◄── 级联更新
  → TASK-006: set_status cancelled (前: pending)
  → ARCH-003: 保留 draft（ARCH 类型不自动 cancelled，人工评估后手动调整）
```

**规则**：
1. 标记目标节点为 `deprecated`（非法跳转：如果目标节点允许从当前状态到 `deprecated` 的路径）
2. 从目标节点出发沿 `edges` 做**正向** BFS（找到所有 `from=目标ID` 的边 → 获取 `to` 节点 → 对其 `to` 节点继续递归遍历）
3. 下游节点中类型为 TASK 的 → 无论当前状态，自动 `set_status cancelled`
4. 下游节点中类型为 REQ/ARCH 的 → **不自动处理**，仅输出建议（`[INFO] REQ-005 可能需要评估是否 deprecated`）
5. 每个级联操作写入对应节点的 `changeLog`（type: "cascaded_from_deprecation"）
6. 运行 `reconcile` 确保 matrix.yaml 摘要同步

#### `impact` CLI vs AI 边界

```
[ASA] Impact Report for REQ-003 (规则检查引擎)
═══════════════════════════════════════════
变更摘要: 增加爬电距离检查能力

关联节点 (RELATED):                    ◄── BFS 图遍历输出（CLI 自动）
  ← REQ-002 (规则管理系统)             ◄── ← 表示上游（当前节点依赖于该节点）
  → REQ-005 (检查过程可视化)           ◄── → 表示下游（该节点依赖于当前节点）
  ...

受影响架构:                             ◄── BFS 图遍历输出（CLI 自动）
  ARCH-003 (规则引擎与原子函数架构)
  ARCH-004 (调度引擎)

建议动作（整体确认 yes/no，不逐个勾选）:  ◄── AI Agent 辅助分析
  - ARCH-003 → 设为 draft 修订
  - TASK-005 → 追加 outputs

是否需要继续传播？(y/N):                ◄── 用户确认点
> _
```

**Impact Report 箭头约定**：`←` 表示上游节点（当前节点的 `from`，即"当前节点依赖于它"），`→` 表示下游节点（当前节点的 `to`，即"它依赖于当前节点"）。与边方向约定（`from=上游 → to=下游`）一致。

**分层规则**：
1. **图遍历层（CLI 负责，确定性）** ── `impact` 基于 matrix.yaml 的 `edges` 做 BFS，输出受影响节点拓扑列表。这部分无歧义、可独立运行。
2. **语义分析层（AI Agent 负责，非确定性）** ── "哪个节点需要改、修改什么"的判断由 AI Agent 分析变更内容 + 节点定义后输出。CLI 不试图判断 semantics。
3. **格式化层（CLI 负责）** ── CLI 将拓扑数据和 AI 语义建议合并为一个可读的 Impact Report 输出。

**用户确认点**：Impact Report 输出后，`propagate` 执行前需要用户确认。确认的是**整体方案**（yes/no），不逐个勾选建议。

#### `propagate` 行为与幂等性

```
$ node .asa/index.js propagate REQ-003

[ASA] 传播 REQ-003 的变更...                ◄── 查找 pendingPropagation 中未完成的条目
  ◇ REQ-003 → v2 传播: 开始 (3/3 steps)
  ✓ ARCH-003: set_status draft (原: approved)   ◄── 幂等：若已是 draft 则跳过
  ✓ ARCH-003 version: 1 → 2 (实质性变更)                ◄── 受影响节点版本递增
  ✓ TASK-005: append_to_array outputs +1        ◄── 幂等：若已有此值则跳过
  ✓ TASK-005 version: 1 → 2 (实质性变更)
  ✓ TASK-006: append_to_array outputs +1
  ✓ TASK-006 version: 1 → 2
  → REQ-003: auto set_status modified (原: approved)    ◄── 源节点状态自动更新
  → REQ-003 version: 2 → 3 (先递增)                     ◄── 先递增
  → REQ-003 changeLog: 追加 type=modified, version=3    ◄── 再记录（version 反映变更后的版本）
  → REQ-003 changeLog: 追加 type=propagation_done, version=3
  → REQ-003 pendingPropagation 条目已清除（不经过 done，直接移除）
  ✓ 重新 compile
```

**支持的 action 类型**：

| type | 含义 | target 示例 | value 示例 | 幂等检查方式 |
|------|------|------------|------------|------------|
| `set_status` | 设置状态字段 | — | `"draft"` | 对比现有 status 值 |
| `append_to_array` | 追加值到数组末尾 | `"outputs"` | `"爬电距离原子函数"` | 检查数组是否已包含 value |
| `set_field` | 设置任意字段值 | `"acceptanceCriteria"` | `"新标准"` | 对比现有字段值 |
| `replace_in_array` | 替换数组中特定值 | `"outputs"` | `{old, new}` | 找到 old → 检查是否已替换 |

**幂等性规则**：
1. 每个修改动作在操作前根据 `action.type` 对应的检查方式做预检，若目标已满足则跳过（例如 `ARCH-003` 已经是 `draft`，`set_status draft` 直接跳过）。
2. `propagate` 每完成一个 affectedNode 的操作，立即 atomic write 更新该节点到 YAML 文件（先写入 `.tmp` 后缀临时文件，再 `renameSync` 覆盖原文件，防止中断导致半写损坏）。受影响的节点如果发生了实质性变更（`set_status` / `append_to_array` 等），其 `version` 同步递增。
3. 所有受影响的子节点处理完毕后，自动将**源节点**（变更发起节点）的 `status` 设为 `modified`，**先递增 `version`**，再在 `changeLog` 中追加**两条**记录——`type: "modified"`（状态变更记录，version 为递增后的值）和 `type: "propagation_done"`（传播完成记录）。
4. 如果执行到一半中断（例如 TASK-005 已完成、TASK-006 未完成），`pendingPropagation[changeVersion].status` 设为 `partial`。
5. 下次运行 `propagate` 时，检测到 `status=partial`，按上述幂等检查跳过已变更节点、执行未变更节点。
6. 所有节点变更完成 → 直接清除 `pendingPropagation` 中对应的条目（不经过 `done` 中间状态）。中断恢复完全依赖幂等检查，不需要持久化的 `done` 标记。

**中断恢复示例**（假设 TASK-005 已完成、TASK-006 未完成）：
```
$ asa propagate REQ-003
  ◇ 检测到 REQ-003 pendingPropagation status=partial
  ✓ ARCH-003: set_status draft → 已是 draft → 跳过          ◄── 幂等命中
  ✓ TASK-005: append_to_array outputs → 已存在值 → 跳过     ◄── 幂等命中
  ✓ TASK-006: append_to_array outputs "DSL 支持 CREEPAGE 关键字"  ← 从上断点继续
  → pendingPropagation 条目已清除（全部完成，直接移除）
  ✓ 重新 compile
```

### 四、AI Agent 工作流变更

当前 CLAUDE.md 要求：

```
变更请求 → traverse <受影响节点ID>
```

升级后：

```
变更请求或需求调整
  → asa change-req <REQ-ID>
  → AI 辅助编辑 acceptanceCriteria / desc / 其他字段
  → 引擎检测到文件变更：自动递增 version，追加 changeLog，创建 pendingPropagation 条目
  → asa impact <REQ-ID>
      ├─ CLI: 输出 BFS 图遍历结果（确定性拓扑列表）
      └─ AI Agent: 读取拓扑列表 + 各节点定义 → 判断语义影响 → 补充 Impact Report
  → 输出完整 Impact Report，等待用户确认
  → (用户确认后) asa propagate <REQ-ID>
      ├─ CLI: 自动执行所有级联修改（幂等 + atomic write）
      ├─ 完成后: 源节点 status 自动设为 modified
      └─ 完成后: pendingPropagation 条目清除
  → auto-compile
```

**AI Agent 的职责清单**：
1. 变更发生后，分析变更内容并生成 `summary` 写入 `changeLog`
2. 运行 `impact` 获取拓扑列表，然后逐节点阅读节点 YAML，判断"此变更对此节点有何影响"
3. 生成建议动作列表（"追加 output"、"设为 draft"、"无影响"等）
4. 输出 Impact Report，询问用户是否继续
5. 用户确认后运行 `propagate`（纯 CLI 操作）+ 更新状态

**`edge` 命令也纳入工作流**：当 AI Agent 分析认为新增需求需要 new edges 时，应更新依赖图（`asa edge add`），`impact` 才能输出正确的拓扑影响。

### 版本号规则

```yaml
version: 1    # 初始值
```

**规则**：
1. **节点级版本**，每个节点（REQ/ARCH/TASK）独立计数，非全局版本号。
2. **只在实质性变更时递增**：修改 `acceptanceCriteria`、`desc`、`outputs`、`status`（状态机跳转）、`edges` 时版本 +1。纯文案修改（修 typo、重写 title 用词）**不递增**。
3. **递增顺序**：**先递增 version，再将递增后的值写入 changeLog**。确保 changeLog 中的版本号反映变更**后**的版本，而非变更前的版本。
4. **自动管理**：AI Agent 或 CLI 不需要手动维护版本号，引擎自动判断。
   - **触发时机**：`change-req` 检测到节点文件内容发生变化后，引擎自动递增 version、追加 changeLog 记录、并创建 `pendingPropagation` 条目。这个动作发生在 `impact` 执行之前，确保 pendingPropagation 中的 `changeVersion` 对应递增后的版本。
5. **版本与 changeLog 的对应关系**：每一次版本递增可能对应**多条** changeLog 记录（例如在一次操作中同时发生状态变更和传播完成，两条记录的 `version` 相同）。溯源时按 `version` 分组读取：`version=3` 下的所有记录共同描述"版本 2→3 之间发生了什么"。
6. **初始值**：新建节点时 `version: 1`。
7. **存量节点**：升级时自动赋予 `version: 1` 和空的 `changeLog: []`、`pendingPropagation: []`。

### 存储方案讨论

`changeLog` 和 `pendingPropagation` 的存储有两种方案，按项目规模选择：

| 方案 | 存储位置 | 适用场景 | 优点 | 缺点 |
|------|---------|---------|------|------|
| **嵌入 YAML**（默认） | 节点 YAML 文件内 | 小型项目（单节点 changeLog ≤ 50 条） | 零额外文件、简单 | YAML 文件随版本增长变大 |
| **独立文件**（可选） | `.asa/changelogs/<ID>.json` | 大型项目（频繁变更） | YAML 保持精简，JSON 格式对数组操作友好 | 多一个目录，读/写多一次文件操作 |

**选择策略**：默认使用嵌入 YAML 方案。当节点的 `changeLog` 超出 50 条或文件超过 200 行时，`reconcile` 自动提示迁移到独立文件方案。

```yaml
# 独立文件方案下的节点 YAML（changeLog 只保留引用）
changeLogRef: ".asa/changelogs/REQ-003.json"
```

### 存量迁移策略

升级到新版本时，现有节点（状态为 `pending`）需要自动迁移到新状态机：

| 存量状态 | → 迁移后状态 | 说明 |
|---------|-------------|------|
| `status: pending` (REQ) | `status: proposed`, `version: 1` | REQ 初始状态从 pending 改为 proposed |
| `status: pending` (ARCH) | `status: draft`, `version: 1` | ARCH 初始状态从 pending 改为 draft |
| `status: pending` (TASK) | `status: pending`, `version: 1` | 兼容 ✅ TASK 初始状态仍然是 pending |
| `status: in_progress` (TASK) | `status: in_progress`, `version: 1` | 兼容 ✅ in_progress 在新状态机中存在 |
| `status: done` (TASK) | `status: completed`, `version: 1` | 存量已完成任务映射到 completed |

**迁移时机**：升级后首次运行 `node .asa/index.js reconcile` 时自动执行迁移，在输出日志中提示：

```
[ASA] 迁移: REQ-001 status: pending → proposed
[ASA] 迁移: ARCH-001 status: pending → draft
[ASA] 迁移: TASK-003 status: done → completed
```

## 七、CI 门禁增强

现有 `validate` 只检查 digest 和文件存在性。增强后额外校验：

- `pendingPropagation` 数组非空？ → 有未完成的传播步骤
- `status: modified` 且 `pendingPropagation` 数组非空？ → 已修改但传播未完成
- 如果任一成立 → `validate` 退出码 1，阻止合并

> **说明**：`pendingPropagation` 不存在 `done` 中间状态（条目完成后直接清除），因此"数组非空"等价于"存在未完成的传播"，无需引入虚构的 `done` 状态做排除。

---

## 实施路线

| 阶段 | 内容 | 前置条件 | 工作量估计 |
|------|------|---------|-----------|
| -1. YAML 解析器修复 | 重写 `parseAsaYaml` 以支持数组中多字段对象的解析与序列化；用 `node:test` 写 10+ 组 parser round-trip 测试 | 无 | 小 |
| 0. 架构拆分 | engine/ 单文件拆分为 commands/ + lib/ + 保留 hooks/；为各 lib 模块写单元测试 | 阶段 -1 | 中 |
| 1. 数据模型 | 节点模板加 changeLog/version/pendingPropagation，三方状态机校验函数，存量迁移逻辑 | 阶段 0 | 小 |
| 2. 核心命令 | `status` (状态机校验 + 变更)、`impact` (BFS + 格式化)、`edge add/rm` (边管理 + 循环检测) | 阶段 1 | 中 |
| 3. 传播链 | `propagate` (幂等 + atomic write + 自动状态更新)、`change-req`、`deprecate` (自动级联 cancelled) | 阶段 2 | 中 |
| 4. 新增命令 | `add-req` / `add-arch` / `add-task` (模板创建)、`journal` / `history` (查询) | 阶段 1 | 中 |
| 5. 工作流更新 | 更新 CLAUDE.md 模板 + SKILL.md + lessons.yaml 记录 | 阶段 3 | 小 |
| 6. CI 增强 | validate 增加 pendingPropagation + 状态机一致性校验；compile/patch 新状态格式兼容 | 阶段 3 | 小 |

**实施优先级建议**：

```
第一优先：阶段 -1         → YAML 解析器修复（其他所有阶段都依赖 YAML 读写）
第二优先：阶段 0 + 1     → 架构 + 数据模型（基础不动无法开工）
第三优先：阶段 2         → impact + status + edge（可见产出）
第四优先：阶段 3         → propagate + change-req（闭环价值）
第五优先：阶段 4-6       → 批量新增 + 查询 + 工作流
```

### Phase -1: YAML 解析器修复

当前 `parseAsaYaml` 无法正确解析"数组中的多字段对象"（sequences of mappings）：

```yaml
changeLog:
  - date: "2026-07-30"
    type: "modified"       # ← 当前 parser 将此字段错误写入根对象
    version: 2
```

**根因**：parser 在处理 `- key: value` 时只识别首个键值对，未将后续缩进行视为该数组项的子字段。

**修复目标**：
1. 重写数组项处理逻辑，使其能正确维护嵌套栈指针
2. 支持等价的序列化（parse → modify → stringify → parse 结果一致）
3. 保持零外部依赖、紧凑型设计

**测试覆盖**（不晚于实现，使用 `node:test`）：

| 用例 | 输入 | 预期 |
|------|------|------|
| 标量数组 | `- a\n- b\n- c` | `['a','b','c']` |
| 单键对象数组 | `- key: val\n- key: val2` | `[{key:'val'},{key:'val2'}]` |
| 多键对象数组 | `- k1: v1\n  k2: v2` | `[{k1:'v1',k2:'v2'}]` |
| 混合深度嵌套 | 三层缩进 | 与 JSON 等价 |
| 空数组 | `arr: []` | `{arr:[]}` |
| round-trip | parse → stringify → parse | 两次 parse 结果一致 |
| 中文/特殊字符 | 含中文的 YAML 值 | 正确编解码 |
| 现有兼容 | 存量 matrix.yaml 保持不变 | 新 parser 兼容旧数据 |

### 架构拆分规划

```
engine/
├── index.js              # CLI 入口 + 命令路由（~50 行，仅路由和参数解析）
├── commands/
│   ├── compile.js        # 现有 compile（保持不动）
│   ├── patch.js          # 现有 patch
│   ├── traverse.js       # 现有 traverse → impact 依赖
│   ├── reconcile.js      # 现有 reconcile + 存量迁移逻辑
│   ├── validate.js       # 现有 validate + CI 增强
│   ├── impact.js         # 新：BFS 拓扑 → 格式化 Impact Report
│   ├── propagate.js      # 新：幂等传播执行器（含 atomic write、自动更新源节点状态）
│   ├── status.js         # 新：状态机校验 + 状态变更
│   ├── add.js            # 新：add-req / add-arch / add-task
│   ├── change.js         # 新：change-req
│   ├── journal.js        # 新：全项目变更历史
│   ├── history.js        # 新：单节点沿革
│   ├── deprecate.js      # 新：废弃 + cascade
│   └── edge.js           # 新：edge add / edge rm（子命令）
├── lib/
│   ├── yaml.js           # 现有 YAML parser/serializer（提取自 index.js）
│   ├── state-machine.js  # 三方状态机定义 + 校验函数
│   ├── graph.js          # 图遍历 BFS（提取自 traverse）
│   └── changelog.js      # changeLog 追加 + pendingPropagation 管理
└── hooks/
    ├── check-work-order.js
    └── validate-yaml.js
```

### 测试策略

使用 Node.js 内置的 `node:test`（Node 18+）保持零外部依赖策略。

| 模块 | 必测场景 | 优先级 |
|------|---------|--------|
| `lib/state-machine.js` | 合法跳转（每种状态机每条路径）、非法跳转（6+ 种）、边界状态（无 changeLog 的首次跳转） | 🔴 最高 |
| `lib/graph.js` | 单边图、多边图、环状图（防止循环 BFS）、无 edges 的图、深层链（N=10） | 🔴 最高 |
| `lib/changelog.js` | changeLog 追加、pendingPropagation 追加/清除/恢复、 | 🔴 最高 |
| `commands/propagate.js` | 全量传播、中断后恢复传播（partial→done）、已全部完成时的幂等跳过 | 🟡 高 |
| `commands/impact.js` | BFS 输出格式、混合 type 边、空结果 | 🟡 高 |
| `commands/status.js` | 跳转成功、跳转拒绝（return error）、不存在的节点 | 🟢 中 |

---

## 与现有设计的兼容性

- 向后兼容：所有现有 YAML 文件无需修改即可继续使用（新字段缺失不会导致崩溃）
- **`compile` 需轻微更新**：新状态值（`proposed`/`modified`/`approved` 等）需在输出的 `- 当前状态:` 中正确显示，并在文档末尾增补 `<!-- ASA-VERSION: <version> -->` 锚点
- **`patch` 需轻微更新**：反向同步 `acceptanceCriteria` 的逻辑不变，但需要识别新锚点格式
- `traverse` 命令保留，但不对外推荐（内部被 `impact` 调用）
- 状态机仅对新操作生效；存量节点通过首次 `reconcile` 自动迁移（见「存量迁移策略」）
- `changeLog`/`pendingPropagation`/`version` 为可选字段，缺失不报错
- `meta` 中新增 `schemaVersion: 2` 标记数据模型版本；存量无此字段视为 v1，首次 `reconcile` 时自动赋值为 2
- `/asa init` 流程不需要修改；已有的 `.asa/` 项目运行 `reconcile` 即可触发静态迁移

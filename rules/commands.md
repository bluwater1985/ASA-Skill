# ASA 命令速查与详细用法（按需加载 · On-Demand）

> 本文件是 **ASA 命令百科全表**，体积较大，**默认不加载**。只有当你不确定某个命令的准确参数/行为、或需要查问题状态机、变更传播细节时，才读取本文件。日常只靠 GEMINI.md/CLAUDE.md 里的“每日 6 步”即可。
>
> 引擎统一入口：`node .asa/index.js <command> [args]`
>
> 通用降噪 flag（可追加在任意命令后）：
> - `--json`：汇总类命令输出一行紧凑 JSON（机器可读，省上下文）
> - `--quiet` / `-q`：抑制信息/装饰行，只留结果与错误

---

## 1. 每日 6 步（核心工作流）

```
【1. 建节点】	add-req / add-arch / add-task；edge add 连依赖；plan-tasks 排任务
【2. 进阶段】	set phase implementation；set active-task <TASK-ID>
【3. 写代码】	激活任务后修改代码（Tier2/3 未激活会被 Hook 拦截）
【4. 收尾】	record-changes <TASK> <files...> → status <TASK> awaiting-confirmation → set active-task clear
【5. 文档】	compile 编译 docs；validate 跑门禁
【6. 审核】	(人) confirm-task / reject-task 裁决 → 进入下一任务
```

> 批处理建议：把多个 ASA 命令用 `;` 拼到同一次终端调用里（如 `add-req ... ; add-task ... ; edge add ... ; plan-tasks`），能显著减少 LLM 回合数与上下文噪音。**一键拼接模板见 `call-minimization.md`（按需加载）。**

---

## 1.5 组合命令（省调用核心 · 一次调用 = 多步）

| 命令 | 一次完成 | 原 → 现 |
|---|---|---|
| `flow add <REQ标题> <TASK标题> [--desc/--inputs/--outputs]` | add-req + add-task(关联) + edge + plan-tasks | 4 → 1 |
| `flow begin <TASK> [phase]` | set phase + set active-task + in_progress | 3 → 1 |
| `flow ship <TASK> <files...>` | record-changes + awaiting-confirmation + set active-task clear + compile + validate（失败原子回滚） | 5 → 1 |
| `flow sync-docs` | compile + validate | 2 → 1 |
| `batch '{"ops":[...]}'` 或 `| batch -` | 任意多条操作顺序执行 | N → 1 |
| `cost [--json]` | 只读估算归因于 ASA 的模型调用次数 | 只读 |

> `flow` / `batch` 都走**单个写事务**，任一步失败整体回滚，不会留下半成品。模型应优先用它们，`;` 仅作引擎命令组合的补充。

---

## 2. 命令速查表

### 诊断 / 自愈
| 命令 | 作用 | 说明 |
|---|---|---|
| `diagnose` | 纯只读自检 | 不写盘、不加锁；探测崩溃脏事务与健康度。会话状态已由 SessionStart 注入，**仅在出现告警时才跑**（懒启动） |
| `doctor` | 一键深度审计 | 坏格式 / 环路边 / 任务孤岛 / 失效依赖 / 未完传播 |
| `reconcile` | 事务对账 + 自举 | 内含 `rollbackAllIncomplete()` 自动自愈；matrix 缺失时自举重建。`-r/--readonly` 只读 |

### 文档同步
| 命令 | 作用 |
|---|---|
| `compile` | 节点 → docs/ Markdown（00/02 叙事型不参与哈希强校验） |
| `patch` | docs → 节点反写（验收标准等） |
| `validate [--json] [--skip-if-fresh]` | CI 门禁：文档哈希 / 节点漂移 / 未完传播（Tier3 强校验）。`--skip-if-fresh`：120s 内已有一次“通过”校验（如 CI 刚跑）则跳过重复校验 |
| `traverse <id>` | BFS 拓扑遍历，输出下游影响层级 JSON |
| `update-overview` | 纯只读项目总览 + Nodes Digest + 叙事锚点 |

### 状态推进
| 命令 | 作用 |
|---|---|
| `status <id> <new-status>` | 按状态机原子推进，拦截非法跳转；awaiting-confirmation 只能由人裁决 |
| `set phase <phase>` | 设阶段：init/discovery/architecture/task-breakdown/implementation/review |
| `set active-task <TASK-ID>` | 激活工作令；`clear` 清除（Tier1 靠此自律） |
| `deprecate <id>` | 级联废弃（REQ→deprecated / ARCH→superseded / TASK→cancelled） |

### 变更影响 / 传播
| 命令 | 作用 |
|---|---|
| `impact <id>` | 上游溯源 + 下游爆炸半径 |
| `propagate <id>` | 级联、幂等执行 pendingPropagation；失败局部 `partial` |
| `change-req/arch/task <id>` | 变更请求入口 + 备份快照 |

### 节点 / 边
| 命令 | 作用 |
|---|---|
| `add-req "<title>" [--priority P1] [--by u] [--spec 文件]` | 新增需求（相似度 >0.9 拦截，`--by` 审计豁免） |
| `add-arch "<title>"` / `add-task "<title>"` | 新增架构 / 任务 |
| `add-issue "<标题>" [--category ...] [--severity P0-P3] [--task/--req/--arch]` | 新增问题节点（默认 observation/P2） |
| `edge add <from> <to> --type depends|extends|refines` | 建依赖边（逆向 BFS 防环路）；`edge rm` 删边 |
| `link-task <TASK> <REQ>` | 任务关联需求 |

### 任务生命周期 / 审核
| 命令 | 作用 | 谁执行 |
|---|---|---|
| `record-changes <TASK> <files...>` | 记录改动文件 | AI |
| `status <TASK> awaiting-confirmation` | 挂起提审 | AI |
| `confirm-task <TASK> --by <u>` | 通过 → completed（须落地门禁） | **人** |
| `reject-task <TASK> --by <u> --reason "<原因>"` | 驳回 → in_progress | **人** |
| `cancel-task <TASK> --by <u>` | 安全取消 | **人** |
| `plan-tasks [REQ-ID]` | Kahn 拓扑编排就绪序列 | AI |

### 查询
| 命令 | 作用 |
|---|---|
| `search-req "<query>"` | 相似检索（阈值 0.3；>0.9 拦截判重） |
| `list-req / list-arch / list-task` | 节点列表 |
| `journal` | 全局变更历史 |
| `history <id>` | 单节点变更沿革 |

---

## 3. ISSUE 问题节点状态机（Schema v4）

- 状态：`open → triaged → in_progress → resolved → verified`（另有 `cancelled` / `wontfix`）。
- `→ resolved` 必须 `--note "<处置原因>"`。
- `resolved→verified`、`resolved→open/in_progress`（返工）、`cancelled→open` 均须 `--by <operator>`。
- `verified` 为验收吸收终态，不可回开。
- **提问题先分流**：bug → 建修复 `TASK`；需求没写清 → 改/补需求文档（`requirement-update` 结算）；否则 observation/risk 观察。
- **自动升单**：`reject-task`、`confirm-task` 门禁被拒、completed 返工回开，都会默认自动建 ISSUE（可用 `--no-issue` 关闭）。

---

## 4. 节点命名铁律

统一 `<ID> - <名称>`：REQ 用**名词**讲能力；TASK 用**动词开头**讲做什么；ISSUE 讲**现象 + 影响场景**；ARCH 用**名词**（组件/抽象层）。
不带版本号/日期/实现细节；名称 ≤ 40 字（ISSUE 可略长）；ID 由引擎自动生成或 `--id` 指定，勿手写编号。

---

> 维护提示：本文件由引擎 `rules/` 目录同步到项目 `.asa/rules/commands.md`。如需调整命令说明，直接改这里，无需动 GEMINI.md/CLAUDE.md 常驻指令。

# ASA 省调用战斗手册（按需加载 · Call Minimization）

> 目的：把「因使用 ASA 而产生的**模型调用次数**」压到最低。
> 计费口径（Gemini 等按调用计费）：**模型每执行一个 ASA 工具调用 ≈ +1 次模型调用**（一轮 LLM 往返）。
> 三条铁律：①本地 hook / CI 能兜底的能力**绝不交给模型重复做**；②多条引擎命令拼进**同一次终端调用**；③只读/汇总命令按需才跑。

---

## 0. 一眼看懂成本

| 动作 | 是否计入模型调用 |
|---|---|
| 模型跑 `node .asa/index.js <cmd>`（1 次工具执行） | ✅ = 1 次 |
| 把 N 条命令用 `;` 拼进**同一次** shell | ✅ 仍 = 1 次（批量后 N→1） |
| BeforeTool / AfterTool / SessionStart hook（本地脚本） | ❌ 0 次 |
| 上下文里加载的契约/token | ❌ 计 token 不计次数 |

> 结论：**合并工具调用 = 直接压调用次数**。hook 与上下文只占 token/延迟，不占次数。

---

## 1. 分工：模型不要重复做

| 能力 | 归谁兜底 | 模型禁止 |
|---|---|---|
| 写盘前“是否有激活任务”拦截 | BeforeTool hook | 不为确认能不能写而额外查状态 |
| 写盘后 YAML 校验 + 物理回滚 | AfterTool hook | 写完后**不要自己再读一遍验证** |
| 会话状态（Phase/ActiveTask/Open/Awaiting/告警） | SessionStart hook | 会话开头**不再跑 diagnose** |
| 静态门禁 validate | CI / pre-commit | 本地**只在收尾跑一次**，不每步跑 |

---

## 2.0 推荐：引擎组合命令（硬降次数，机制级 · 最高优先）

这些是引擎内建的「一次调用 = 多步」命令，模型只需调 **1 次工具**，比 `;` 更稳（单进程、单事务、可原子回滚）：

| 命令 | 一次完成 | 原 → 现调用 |
|---|---|---|
| `flow add <REQ标题> <TASK标题> [--desc/--inputs/--outputs]` | add-req + add-task(关联) + edge + plan-tasks | 4 → 1 |
| `flow begin <TASK> [phase]` | set phase + set active-task + 置 in_progress | 3 → 1 |
| `flow ship <TASK> <files...>` | record-changes + status awaiting-confirmation + set active-task clear + compile + validate | 5 → 1 |
| `flow sync-docs` | compile + validate | 2 → 1 |
| `batch '{"ops":[...]}'`（或 stdin） | 任意多条操作顺序执行 | N → 1 |
| `cost` | 只读估算归因于 ASA 的模型调用次数（可验证收益） | 只读 |

> `flow ship` 末步走 `validate`：若门禁不过，整个 ship **原子回滚**，不会留下半成品。

---

## 2. 一键拼接模板（`;` 批量 · 软约束，flow 不可用时的回退）


### 建节点（需求→任务→边→排序）
```
node .asa/index.js add-req "标题" ; node .asa/index.js add-task "任务名" --req REQ-001 ; node .asa/index.js edge add REQ-001 TASK-001 --type depends ; node .asa/index.js plan-tasks --json
```

### 进阶段
```
node .asa/index.js set phase implementation ; node .asa/index.js set active-task TASK-001
```

### 收尾
```
node .asa/index.js record-changes TASK-001 <file...> ; node .asa/index.js status TASK-001 awaiting-confirmation ; node .asa/index.js set active-task clear
```

### 文档刷新（编译 + 门禁）
```
node .asa/index.js compile ; node .asa/index.js validate --json
```

---

## 3. 少跑清单

| 命令 | 频率 | 理由 |
|---|---|---|
| `diagnose` | 会话开头**有告警才跑** | 健康状态已由 SessionStart 注入 |
| `validate` | 只收尾/合并前一次 | CI/pre-commit 已承担；告警非阻塞不必逐条处理 |
| `doctor` | 仅排障 | 深度审计，非例行 |
| `reconcile` | 仅脏事务/不一致 | 内含自愈，不必无事跑 |
| `list/board/update-overview` | 需要时才读 | 只读盘点，加 `--json` 降噪 |

> **任务定位（省调用）**：拿到新任务先看 SessionStart 注入的 `activeTask`（含标题）与 `readyTasks`；**仅当**需要任务标题/细节、或两者都没有可用项时，才跑 `board` / `list-task`，**不要每个新任务都跑 board**。

---

## 4. 会话习惯（零成本）

1. **一任务一会话**：别把所有任务堆在一个超长会话里（长上下文只增加每请求 token，不省次数）。
2. **implementation 后可压缩**契约 + matrix（只留 phase/activeTask/当前摘要）。
3. 汇总类命令加 `--json` / `--quiet`（省的是单次上下文，顺手做）。
4. 叙事文档 00/02 **不常驻**：只在要重写时读全文。

---

## 5. 硬约束清单（流程/机制级，不依赖模型自觉）

| 机制 | 作用 | 模型调用 |
|---|---|---|
| **SessionStart hook**（`session-start.js`） | 注入 `[ASA STATUS]`（Phase/**ActiveTask 含标题**/OpenTasks/Awaiting/OpenIssues）+ `[ASA NEXT] readyTasks` + `[ASA READY/ACTION]` | 0 |
| **BeforeTool hook**（`check-work-order`） | 写盘前拦截（未激活任务 fail-closed） | 0 |
| **AfterTool hook**（`validate-yaml`） | 写盘后 YAML 校验 + 物理回滚 | 0 |
| **pre-commit / CI `validate`** | 提交/CI 时自动跑门禁 | 0 |
| **`validate --skip-if-fresh`** | 120s 内已有一次“通过”的 validate（CI/pre-commit 刚跑）→ 跳过重复校验 | 0 |
| **组合命令 `flow` / `batch`** | 多步焊进一次引擎进程（单事务原子） | 1（代替 N） |
| **状态机/落地门禁/ISSUE 分流** | 非法跳转、confirm 落地、awaiting 拦截 | 0（模型不可绕过） |

> 铁律再强调：**能由以上硬机制兜底的，模型一律不做**——不跑 diagnose/list/validate 兜底重复、不在写盘后自行复验、不用 `;` 兜底重复 flow 已覆盖的步骤。


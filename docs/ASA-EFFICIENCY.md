# ASA 省 Token / 省调用 优化指南

> 目标读者：在项目中启用 ASA 后，希望在**不牺牲契约纪律**的前提下，把 token 消耗与 API 调用次数压到最低的开发团队。
>
> 所有建议分为「改动产物」（已随本仓库落地）与「使用习惯」（零成本，即日生效）两类。

---

## 0. 结论速览

| 优化 | 类型 | 省什么 | 量级 |
|---|---|---|---|
| 精简契约模板（GEMINI/CLAUDE tier1/2/3） | 已落地 | 常驻 token/请求 | 每请求省 ~1,500 tokens |
| 命令百科移到 `rules/commands.md` 按需加载 | 已落地 | 常驻 token | 同上（并入清单） |
| 引擎 `--json` 紧凑输出 | 已落地 | 上下文噪音/请求 | 汇总类命令单次省 50–300 tokens |
| 引擎 `--quiet` 抑制信息行 | 已落地 | 上下文噪音 | diagnose/doctor 等近静默 |
| 批量执行引擎命令（`;` 拼接） | 使用习惯 | LLM 回合数 | ×1.5–3 → 接近正常 |
| 少跑非必需 validate/doctor | 使用习惯 | LLM 回合数 | 明显 |
| matrix.yaml 只存摘要 | 使用习惯 | 常驻 token | 项目越大越省 |
| 一任务一会话 + 会话中途压缩 | 使用习惯 | 后半程常驻体积 | 明显 |
| 叙事文档 00/02 不常驻 | 使用习惯 | 常驻 token | 中等 |
| **组合命令 `flow`（add/begin/ship/sync-docs）** | 已落地 | **模型调用次数** | 每任务 ~8-14 → **~3** |
| **`batch` 批处理命令** | 已落地 | **模型调用次数** | N 条 → 1 次 |
| **`validate --skip-if-fresh` 去重门禁** | 已落地 | **模型调用次数** | 重复校验 → 0 |
| **SessionStart `[ASA NEXT]` 就绪前沿** | 已落地 | **模型调用次数** | 免跑 plan/list |
| **`cost` 成本观测** | 已落地 | 可验证 | 量化省调用收益 |

---

## 1. 已落地：精简契约模板

`templates/gemini-{tier1,2,3}.md` 与 `templates/CLAUDE-{tier1,2,3}.md` 已重写为精简版：

- **只保留**：强制启动序列、Tier 特有防御、每日 6 步、行为基线铁律、增量方法库触发、问题管理一句话、节点命名。
- **移走**：整本的命令百科与 ISSUE 状态机细节 → 移到 `.asa/rules/commands.md`（**按需加载**，不确定命令参数时才读）。
- **实测体积**：Tier1 5.8K→2.2K、Tier2 6.5K→2.7K、Tier3 6.6K→2.7K 字符（约 **-59%**）。
- **效果**：常驻契约从约 ~2,600 tokens 降到 ~1,100 tokens/请求，每请求直接省约 1,500 tokens。

> 生效方式：重跑 `node install.js`（把新模板与 commands.md 装进全局 `~/.asa`），再对目标项目重跑 `node .asa/index.js <初始化脚本> tierX --force`（旧 GEMINI 会先备份再整文件重建）。保留标记 `<!-- ASA-CONTRACT-BEGIN/END -->`，未来合并不破坏项目自定义规约。

---

## 2. 已落地：引擎 `--json` / `--quiet` 降噪

引擎新增全局开关（`engine/lib/io.js`），**默认行为与旧版逐字节一致**，仅在显式追加 flag 时生效：

| flag | 作用 | 适用命令 |
|---|---|---|
| `--json` | 输出一行紧凑 JSON（机器可读） | `list-req/arch/task`、`plan-tasks`、`journal`、`history`、`search-req`、`overview`、`diagnose`、`doctor`、`validate` |
| `--quiet` / `-q` | 抑制信息/装饰行，只留结果与错误 | `diagnose`、`doctor` 等（近静默） |

```bash
node .asa/index.js plan-tasks --json     # {"targetReq":null,"ready":[],...}
node .asa/index.js list-task --json
node .asa/index.js diagnose --quiet      # 只读自检，几乎无输出
```

> 提示：DSH / 脚本里把 `--json` 输出读回模型，比吞一整段人读排版文本省得多。flag 会被自动从命令参数中剔除，不会误当成人参数（如 `plan-tasks --json` 不会把 `--json` 当 REQ id）。

---

## 3. 使用习惯（零成本，即日生效）

### 3.1 批量执行引擎命令（最省回合数）
把多个 ASA 命令用 `;` 拼到**同一次 shell 调用**，1 次工具调用完成多个动作，直接砍掉多次 LLM 回合：

```bash
node .asa/index.js add-req "支持微信扫码登录" ; node .asa/index.js add-task "实现登录接口" ; node .asa/index.js edge add REQ-001 TASK-001 --type depends ; node .asa/index.js plan-tasks
```

### 3.2 少跑非必需命令
- `validate` 有**非阻塞告警**（孤儿任务/进度不一致/叙事过期…），**只在收尾/合并前跑一次**，别每步都 validate。
- `doctor`/`diagnose` 是排障与开机自检，不要例行反复调。
- Tier 3 的 CI 已自动跑 validate，会话里别重复人工跑同一道门禁。

### 3.3 让 matrix.yaml 只存摘要
Tier 1 每会话读 matrix。别把长验收标准/正文塞进 matrix，**让它存索引/摘要，长文放 `docs/`**。

### 3.4 一任务一会话 + 会话中途压缩
- 每任务一个短会话，别把所有任务堆在一个超长上下文里（越长，每请求复发的常驻体积越大）。
- 进入 implementation 阶段后，可将契约 + matrix 折叠/压缩，只留 phase/activeTask/当前 matrix，后半程每请求立刻变轻。

### 3.5 叙事文档 00/02 不常驻
`overview`/`architecture` 只在需要重写时读全文，不要每次会话都拉出来；`validate` 的 NARRATIVE_OUTDATED 只是告警，正常推进即可。

---

## 4. 建议接入顺序

1. **今天就做**：批量命令（3.1）+ 少跑 validate（3.2）——纯习惯，立省。
2. **想做就做**：对目标项目重跑 init --force，换上精简契约 + commands.md（省每请求 ~1,500 tokens）。
3. **进阶**：脚本/DSH 里给查询命令加 `--json`；引擎已带全局降噪，不需要额外改代码。

---

## 5. 硬约束层（机制级 · 流程式省调用，A–F 已落地）

> 前面的 1–4 是“软约束/习惯”，靠模型自觉。本节是**引擎内建的硬机制**：多步焊进一次进程 = 一次模型调用，且**不依赖模型自觉**。

### 5.1 组合命令 `flow`（每任务 8-14 → ~3 次模型调用）
| 命令 | 一次完成 | 原→现 |
|---|---|---|
| `flow add <需求> <任务> [--desc/--inputs/--outputs]` | add-req + add-task(关联) + edge + plan-tasks | 4→1 |
| `flow begin <TASK> [phase]` | set phase + set active-task + 置 in_progress | 3→1 |
| `flow ship <TASK> <files...>` | record-changes + awaiting + clear + compile + **validate（失败原子回滚）** | 5→1 |
| `flow sync-docs` | compile + validate | 2→1 |

### 5.2 `batch`（任意多操作一次进程）
`node .asa/index.js batch '{"ops":[...]}'` 或 `echo '...' | node .asa/index.js batch -`，单进程顺序执行，N→1 次模型调用，单事务原子。

### 5.3 `validate --skip-if-fresh`（去重门禁）
120s 内已有一次“**通过**”的 validate（如 CI/pre-commit 刚跑）→ 直接跳过重复校验。CI / pre-commit 用不带该 flag 的 `validate`，始终真跑。

### 5.4 SessionStart `[ASA NEXT]`（0 调用）
`session-start.js` 启动时注入 `[ASA STATUS]`（Phase/OpenTasks/Awaiting/OpenIssues）+ `[ASA NEXT] readyTasks` + `[ASA READY/ACTION]`，模型会话开头**不再跑 diagnose/list/plan-tasks**。

### 5.5 `cost`（成本观测）
`node .asa/index.js cost --json`：只读估算归因于 ASA 的模型调用次数（`nodeWriteOps` / `estimateModelCalls` / `estimateModelCallsMerged`），用于量化上述硬机制的收益。

**Tier 3 每“实现+确认”任务成本（硬机制下）**：`flow add`(1) → `flow begin`(1) → 写 → `flow ship`(1，含 validate) = **~3 次模型调用**；会话开头 ~0-1（SessionStart 注入）。

> 对应单测：`engine/commands/flow_batch_cost.test.js`（flow/batch/cost/validate-gate）。

---

## 6. 建议接入顺序（硬机制版）

1. `node install.js <client>` → 把新 `flow/batch/cost`、`rules/`、`hooks/` 装进 `~/.asa`。
2. 目标项目重跑 `node .asa/index.js <asa-init> tier3 --force`（旧 GEMINI.md 自动备份）。
3. 引导模型优先 `flow add → flow begin → flow ship`；收尾用 `validate --skip-if-fresh`；用 `cost` 复核收益。

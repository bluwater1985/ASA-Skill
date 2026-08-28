---
name: asa
description: >-
  AI Software Architect (ASA) — 在任意项目中初始化 ASA 工程管理流程。
  支持 Tier 1（探索验证）、Tier 2（离线防御）、Tier 3（强契约）三级渐进式启用。
  初始化时询问用户选择 Tier，然后自动搭建 .asa/ 引擎目录、
  语义化合并 CLAUDE.md、配置 hooks 和 pre-commit。
  所有操作幂等，多次运行不丢数据、不重复注册 Hook。
metadata:
  origin: custom
---

# ASA — AI Software Architect 初始化技能

在任意项目中初始化 ASA 工程管理流程。

## 用法

```
/asa init            ← 在当前项目中初始化 ASA（会问选哪个 Tier）
/asa init tier1      ← 直接指定 Tier 1
/asa init tier2      ← 直接指定 Tier 2
/asa init tier3      ← 直接指定 Tier 3
```

## 全局模板路径

ASA 的引擎代码和模板文件存储在 `~/.asa/` 目录下：

```
~/.asa/
├── index.js                    # CLI 路由（零外部依赖，内置 ACID 崩溃自愈扫描）
├── version.js                  # 引擎版本与最大支持 Schema 声明（v3）
├── commands/                   # 17+ 核心命令模块（diagnose, doctor, plan-tasks, confirm-task 等）
├── lib/                        # 底层库模块（含 transaction 物理自愈、自研紧凑 YAML 读写等）
├── hooks/
│   ├── check-work-order.js     # PreToolUse 状态拦截（双协议适配，只读诊断不写盘）
│   ├── validate-yaml.js        # PostToolUse YAML 安全校验与写后还原物理协议（hook-<PATH-HASH>.bak）
│   └── session-start.js        # Startup 诊断（纯只读，AwaitingConfirmation 提示）
├── skeleton/
│   └── matrix.yaml             # 空矩阵骨架
├── rules/
│   ├── to-spec.md              # 增量方法：需求分析（按需加载）
│   └── to-tickets.md           # 增量方法：任务拆解/垂直切片（按需加载）
└── templates/
    ├── CLAUDE-tier1.md         # Tier 1 CLAUDE.md 模板
    ├── CLAUDE-tier2.md         # Tier 2 CLAUDE.md 模板
    └── CLAUDE-tier3.md         # Tier 3 CLAUDE.md 模板
```

## 初始化流程

当用户调用 `/asa init` 时，AI 会自动且强刚性地调用内部初始化脚本完成。初始化不再进行手动的多行 shell 命令复制，而是通过调用：

```bash
node ~/.claude/skills/asa/scripts/asa-init.js [tier1|tier2|tier3] [--name=<project-name>] [--force]
```

以 100% 幂等、零出错地实现：

1. **自适应创建目录**：物理创建 `.asa/nodes/requirements`, `.asa/nodes/architecture`, `.asa/nodes/tasks`, `.asa/hooks`, `.asa/knowledge`。
2. **复制引擎与自洁隔离**：将全局 `~/.asa/` 下的 `index.js`, `version.js` 以及 `commands/`, `lib/`, `hooks/` 复制到项目 `.asa/`。复制时**严格加上 `!f.endsWith('helpers.js') && !f.endsWith('.test.js')`** 进行物理剔除，确保测试污染与辅助文件不被拷入。
3. **安全自举 `matrix.yaml`**：如果不存在则基于 Schema v3 模板新建。
4. **生成/合并 `CLAUDE.md`**：若不存在，根据所选 Tier 从 `~/.asa/templates/CLAUDE-tier${num}.md` 复制；若已存在且未指定 `--force`，则契约一致时跳过、契约升级时**先备份 `.bak.<时间戳>` 再做段落级合并**（仅替换标记内的标准契约段，用户手写叙事不受覆盖）；`--force` 则备份后整文件重建。
5. **去重写入项目级 Hook 路径（相对路径隔离）**：物理写入本地项目的 `.claude/settings.local.json`，所写 command 为自适应的相对路径（如 `"node .asa/hooks/check-work-order.js \"$FILE_PATH\""`），完美区分宿主全局绝对路径配置，零干扰外部普通项目！
6. **创建 Husky 本地门禁**：物理生成 `.husky/pre-commit` 门禁并赋予可执行权限：`node .asa/index.js validate || exit 1`。

---

## 核心命令与功能差异

| 命令 | 适用阶段/场景 | 核心防御强度与控制机制 |
|------|--------------|------------------------|
| `diagnose` | 快速、纯只读自诊 | **不加文件锁、不写盘、不改 mtime**，探测崩溃脏事务与健康度评分。 |
| `doctor` | 系统一键深度审计 | 全维度排查坏格式、环路边、任务孤岛、失效依赖和未完成传播。 |
| `plan-tasks` | 拓扑编排多阶段规划 | 依据边拓扑排序，规划串并行实施路线，避免乱序开发。 |
| `confirm-task <id> [--allow-no-files "<理由>"]`| 架构师提审确认 | 审核通过将任务推进至 `completed`。**实现落地门禁（N3/D2）**：须已 `record-changes` 登记且所列文件在工作树真实存在，否则拒绝；确无文件变更时用 `--allow-no-files "<理由>"` 显式豁免并留痕。**completed 返工**：由架构师 `status <id> pending|in_progress --by <user>` 显式回开（须 --by 审计），`verified` 不可回开。 |
| `reject-task <id>` | 架构师提审驳回 | 驳回并退回 `in_progress`，附带原因供 AI 修正。 |
| `validate [--json]` | CI/CD 静态校验门禁 | 哈希指纹、节点漂移、未完成传播校验。**叙事型文档（00, 02）不强制校验哈希**。 |
| `reconcile` | 对账与数据自举 | **内嵌 `rollbackAllIncomplete()` 自动自愈**，在 missing 时可自举重建 matrix。 |
| `add-req [--by user]`| 新增相似判定拦截 | 文本判重相似度 `> 0.9` 会触发拦截，可用 `--by` 强制审计特批豁免。 |
| `add-issue <title> [--category <bug\|requirement-clarification\|observation\|risk>] [--severity P0-P3] [--task <id>] [--req <id>] [--arch <id>]` | 新增问题节点（Schema v4） | 第 4 类节点 `ISSUE-xxx`，默认 `observation / P2`。提出问题时**先分流**：bug → 建修复 TASK；需求没写清 → 改/补需求文档；否则以 observation/risk 观察。`--task/--req/--arch` 自动写 `affects` 边。 |
| `status ISSUE-xxx <状态>` | ISSUE 状态机推进 | `open→triaged→in_progress→resolved→verified`，另有 `cancelled/wontfix`。`→resolved` 须 `--note "<处置>"`；`resolved→verified`、`resolved→open/in_progress`、`cancelled→open` 须 `--by`；`verified` 为吸收终态。 |
| `update-overview` | 只读项目总览摘要 | **不写盘**。需求/任务正文请用 `docs/01-requirements.md` 与 `docs/03-tasks.md` 作素材，问题清单用 `docs/04-issues.md`；本命令仅补齐架构/依赖边/lessons，并输出 `Nodes Digest (当前)`、可直接照抄的 `ASA-BASED-ON` 锚点与重写操作模板。 |

## 📄 叙事文档重写闭环（00-overview / 02-architecture）

`docs/00-overview.md` 与 `docs/02-architecture.md` 是散文叙事型文档，**不由引擎机械编译**，由模型（LLM）编写，并通过 `<!-- ASA-BASED-ON: <nodesDigest> -->` 锚点追踪过期。模型处理这两份文档时必须遵守：

- **首选自动播种**：`compile` 首次运行时若 00/02 缺失，会自动创建占位文件（顶部带当前 digest 锚点），模型只需**填充内容并保持锚点不变**，已存在的文件绝不覆盖。
- **素材来源**：
  - 需求 → 读取 `docs/01-requirements.md`（compile 编译自 REQ 节点，含 spec/AC/状态/优先级）。
  - 任务 → 读取 `docs/03-tasks.md`（compile 编译自 TASK 节点，含完成/未完成状态）。
  - 问题 → 读取 `docs/04-issues.md`（compile 编译自 ISSUE 节点，含状态/类别/严重度/处置）。
  - 架构/依赖边/lessons/digest → `node .asa/index.js update-overview`。
- **更新/重写流程（一次命令闭环）**：
  1. 读 `docs/01-requirements.md` 与 `docs/03-tasks.md` 获取需求/任务真实素材。
  2. `node .asa/index.js update-overview` — 获取架构组件/ARCH 依赖边/lessons，并输出 `Nodes Digest (当前)` 与可直接照抄的锚点。
  3. 用 `write_file` 重写 `docs/00-overview.md` 与 `docs/02-architecture.md`。
  4. **保持顶部 `<!-- ASA-BASED-ON: ... -->` 锚点等于当前 Nodes Digest**（这是同步成败关键）。
  5. `node .asa/index.js validate` — 确认无 `NARRATIVE_OUTDATED` 告警。
- **被动检出**：`doctor` / `validate` 检出 00/02 锚点过期或缺失时，告警文本内附同一份可复制操作模板。
- **`docs/` 写盘永远放行**：`check-work-order` 将 `docs/` 列入白名单，无 activeTask 也可写；且 00/02 为 `.md` 不参与 compile 哈希强校验。

## 🐞 问题管理（ISSUE / Schema v4）

- **自动升 ISSUE**：`reject-task`（被打回）、`confirm-task` 落地门禁被拒（给出 `add-issue` 提示）、`status <TASK> pending/in_progress`（completed 返工回开）都会**默认自动建 ISSUE** 记录"不合规/实现未落地"；可用 `--no-issue` 关闭。
- **分流处置**：提出问题时先判断类别——bug（建修复 TASK）、requirement-clarification（改/补需求文档后以 `requirement-update` 结算）、observation/risk（观察）。
- **关闭口径**：`resolved` 须 `--note` 说明处置；确认解决后 `verified --by <user>` 验收（吸收终态）；确非问题用 `wontfix`。
- Schema v4 无感升级：存量 v3 项目 `reconcile` 后自动补 `matrix.issues`，无需人工迁移。

## 各 Tier 差异速查

| 步骤 | Tier 1 | Tier 2 | Tier 3 |
|------|--------|--------|--------|
| matrix.yaml (Schema v3) | 创建 | 创建 | 创建 |
| index.js + version.js | ✅ | ✅ | ✅ |
| hooks (SessionStart/Pre/Post) | ❌ | ✅ | ✅ |
| pre-commit (validate) | ❌ | ✅ | ✅ |
| CLAUDE.md | tier1 模板 | tier2 模板 | tier3 模板 |
| nodes/ | ❌ | ✅ | ✅ |
| knowledge/ | ❌ | ❌ | ✅ |

## 🔄 增量方法库（按需加载，不常驻）

初始化时脚本自动把 **to-spec（需求分析）** 与 **to-tickets（任务拆解）** 两套增量方法复制到项目 `.asa/rules/`。完整规约**默认不加载**，由 CLAUDE.md / GEMINI.md 的「增量方法库」段兜底触发：

- 用户**明确说要做需求分析 / 需求规格化**时 → 读取并严格执行 `.asa/rules/to-spec.md`（含 Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions / Out of Scope / **Further Notes** 全模板；**用 `add-req --spec <源.md>` 忠实落盘 REQ 节点，杜绝二次回填压缩**）。
- 用户**明确说要做任务拆解 / 拆 tickets**时 → 读取并严格执行 `.asa/rules/to-tickets.md`（Tracer-Bullet 垂直切片、Expand-Contract、**拆解后交用户确认**、**用 `add-task --desc/--inputs/--outputs/--req` 一次全量落盘**、`edge add` + `link-task` + `plan-tasks` 建图、Frontier 前沿驱动）。

> 维护建议：如需调整这两套方法的模板或流程，直接改 `.asa/rules/to-spec.md` / `to-tickets.md`，无需改动 CLAUDE.md 常驻指令。

## 重跑安全性

所有操作均具有强幂等性：无论重复跑多少次：
- **`nodes/`** 绝对不碰不盖，受到完全隔离与物理保护。
- **`matrix.yaml`** 可在 nodes/ 数据完备下随时自举恢复。
- **`CLAUDE.md`** 契约一致则跳过；契约升级时先备份 `.bak.<时间戳>` 再做段落级合并，仅替换 `<!-- ASA-CONTRACT-BEGIN/END -->` 内的标准契约段，**用户手写叙事散文不覆盖**；`--force` 备份后整文件重建。无标记旧文件按标准章节位置尽力合并。
- **`settings.local.json`** 按 Hook 名精准更新，不污染配置。
- **`index.js` + `hooks/`** 始终更新至最新引擎版本。

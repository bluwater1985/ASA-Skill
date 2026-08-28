---
name: asa
description: AI Software Architect（ASA）—— 在项目中初始化 ASA 工程管理流程。支持 Tier 1（探索验证）、Tier 2（离线防御）、Tier 3（强契约）三级渐进式启用。用户输入 "/asa init"、"/asa" 或说"初始化 ASA"时触发，自动搭建 .asa/ 引擎目录、生成 GEMINI.md 项目指令、配置 BeforeTool/AfterTool hooks 和 pre-commit。
---

# ASA — AI Software Architect 初始化

在任意项目中初始化 ASA 工程管理流程。

## 用法

支持两种触发方式（与 Claude Code 保持一致）：

### 方式一：斜杠命令（推荐，与 Claude Code 相同）

```
/asa init            ← 初始化（会问选哪个 Tier）
/asa init tier1      ← 直接指定 Tier 1
/asa init tier2      ← 直接指定 Tier 2
/asa init tier3      ← 直接指定 Tier 3
```

### 方式二：自然语言

> 初始化 ASA
> 或者：初始化 ASA Tier 2

AI 会询问选择哪个 Tier，然后自动搭建。

> **版本要求**：斜杠命令 `/asa` 需要 Gemini CLI 支持「技能斜杠激活」的版本（2026 年起已支持）。若你的版本不支持 `/asa`，请用自然语言「初始化 ASA」触发，或升级 Gemini CLI。

## 初始化流程

当用户要求初始化 ASA 时，按以下步骤执行：

### Step 1: 确认 Tier

如果用户**在命令中指定了 Tier**（如 `/asa init tier2` 或「初始化 ASA Tier 2」），**直接使用该 Tier，不再询问**。

否则询问用户：

> 你的项目适合哪个级别？
> 1. **Tier 1 探索验证** — 个人 Demo / MVP，不设防御，直接开干
> 2. **Tier 2 离线防御** — 小团队，BeforeTool Hook + pre-commit 兜底
> 3. **Tier 3 强契约** — 多团队，CI 门禁与知识管理，validate 强校验

### Step 2: 运行初始化脚本

优先使用 `node ~/.gemini/skills/asa/scripts/asa-init.js` 完成初始化。如果脚本不存在，按后续步骤手动搭建。

```bash
# 根据所选 Tier 运行（tier1 / tier2 / tier3）
node ~/.gemini/skills/asa/scripts/asa-init.js tier2

# 加 --force 可重新生成 GEMINI.md（旧文件自动备份）
node ~/.gemini/skills/asa/scripts/asa-init.js tier2 --force
```

初始化脚本会自动完成（**幂等**：已有文件不覆盖）：
- 创建 `.asa/` 目录结构和引擎文件
- `matrix.yaml` 和 `GEMINI.md` → 存在即跳过，不覆盖已有数据
- 复制增量方法库 `to-spec.md` / `to-tickets.md` → `.asa/rules/`
- 配置 `.gemini/settings.json`（按 name 更新，不重复注册）
- 配置 `.husky/pre-commit`

> **重跑安全**：无论执行多少次初始化：
> - **`nodes/`**（需求、任务、架构）→ 永远不碰，这是不可丢的数据
> - **`matrix.yaml`**（摘要索引）→ 可更新，摘要从 nodes/ 重建（edges/meta 需备份）
> - **`GEMINI.md`**（项目指令）→ 默认：契约一致则跳过；契约升级时**先备份 `.bak.<时间戳>` 再做段落级合并**，仅替换标记 `<!-- ASA-CONTRACT-BEGIN/END -->` 内的标准契约段，**项目自定义规约不覆盖**；`--force` 则备份后整文件重新生成。无标记旧文件按标准章节位置尽力合并。
> - **`.gemini/settings.json`** → 按 Hook `name` 精准更新，不重复注册
> - **`index.js` + `hooks/`** → 引擎文件始终更新到最新

### Step 3（备选）：手动搭建

如果初始化脚本不可用，按以下步骤手动搭建：

#### 创建目录结构
```bash
mkdir -p .asa/nodes/requirements .asa/nodes/architecture .asa/nodes/tasks .asa/hooks .asa/rules
```

#### 复制增量方法库规则（to-spec / to-tickets）
```bash
mkdir -p .asa/rules
cp ~/.asa/rules/to-spec.md ~/.asa/rules/to-tickets.md .asa/rules/
```

#### 复制引擎
```bash
cp ~/.asa/index.js .asa/index.js
cp ~/.asa/version.js .asa/version.js
mkdir -p .asa/commands .asa/lib
cp ~/.asa/commands/*.js .asa/commands/ 2>/dev/null
cp ~/.asa/lib/*.js .asa/lib/ 2>/dev/null
cp ~/.asa/hooks/check-work-order.js .asa/hooks/
cp ~/.asa/hooks/validate-yaml.js .asa/hooks/
chmod +x .asa/hooks/*.js
```

#### 创建/更新 matrix.yaml (Schema v3 升级)

> matrix.yaml 是 nodes/ 的摘要索引，数据主体在 nodes/ 中。reconcile 可从 nodes/ 重建 requirements/architecture/tasks 摘要并对账；在旧项目升级时，系统会自动后向兼容补全 TASK 节点缺失的 `linkedReqs` 和 `changedFiles` 默认值 `[]`，防止因格式不一引发崩坏。

```yaml
# .asa/matrix.yaml
meta:
  project: "<项目名称>"
  phase: "discovery"
  schemaVersion: 3
  compiledDocsExpectedDigest: "sha256:empty"
  compiledDocsActualDigest: "sha256:empty"
risks: []
requirements: {}
architecture: {}
tasks: {}
edges: []
```

#### 生成/合并 GEMINI.md

**文件不存在时**：从 `~/.asa/templates/gemini-tier{1,2,3}.md` 读取对应模板创建。

**文件已存在时**：执行以下步骤完成语义化合并：

1. 用 `read_file` 读取已存在的 `GEMINI.md` 全文。
2. 提取并保留用户手写的非冲突规约。
3. 替换标准启动序列段落。
4. 重新写入。

#### 配置 hooks（Tier 2/3 需要）

修改用户目录下的 `.gemini/settings.json`，在 `hooks` 中配置：

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "name": "asa-check-work-order",
        "matcher": "write_file|replace|edit_file|patch_file|apply_diff|move_file",
        "hooks": [
          {
            "type": "command",
            "command": "node .asa/hooks/check-work-order.js"
          }
        ],
        "description": "ASA: 状态拦截：无活跃 Task 时阻止修改"
      }
    ],
    "AfterTool": [
      {
        "name": "asa-validate-yaml",
        "matcher": "write_file|replace|edit_file|patch_file|apply_diff|move_file",
        "hooks": [
          {
            "type": "command",
            "command": "node .asa/hooks/validate-yaml.js"
          }
        ],
        "description": "ASA: 写入后校验 YAML，失败物理一键还原"
      }
    ]
  }
}
```

#### 配置 pre-commit Hook（Tier 2/3 需要）

```bash
mkdir -p .husky
echo "node .asa/index.js validate || exit 1" > .husky/pre-commit
chmod +x .husky/pre-commit
```

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
| `update-overview` | 只读项目总览摘要 | **不写盘**。需求/任务正文请用 `docs/01-requirements.md` 与 `docs/03-tasks.md` 作素材；本命令仅补齐架构/依赖边/lessons，并输出 `Nodes Digest (当前)`、可直接照抄的 `ASA-BASED-ON` 锚点与重写操作模板。 |

## 📄 叙事文档重写闭环（00-overview / 02-architecture）

`docs/00-overview.md` 与 `docs/02-architecture.md` 是散文叙事型文档，**不由引擎机械编译**，由模型（LLM）编写，并通过 `<!-- ASA-BASED-ON: <nodesDigest> -->` 锚点追踪过期。模型处理这两份文档时必须遵守：

- **首选自动播种**：`compile` 首次运行时若 00/02 缺失，会自动创建占位文件（顶部带当前 digest 锚点），模型只需**填充内容并保持锚点不变**，已存在的文件绝不覆盖。
- **素材来源**：
  - 需求 → 读取 `docs/01-requirements.md`（compile 编译自 REQ 节点，含 spec/AC/状态/优先级）。
  - 任务 → 读取 `docs/03-tasks.md`（compile 编译自 TASK 节点，含完成/未完成状态）。
  - 架构/依赖边/lessons/digest → `node .asa/index.js update-overview`。
- **更新/重写流程（一次命令闭环）**：
  1. 读 `docs/01-requirements.md` 与 `docs/03-tasks.md` 获取需求/任务真实素材。
  2. `node .asa/index.js update-overview` — 获取架构组件/ARCH 依赖边/lessons，并输出 `Nodes Digest (当前)` 与可直接照抄的锚点。
  3. 用 `write_file` 重写 `docs/00-overview.md` 与 `docs/02-architecture.md`。
  4. **保持顶部 `<!-- ASA-BASED-ON: ... -->` 锚点等于当前 Nodes Digest**（这是同步成败关键）。
  5. `node .asa/index.js validate` — 确认无 `NARRATIVE_OUTDATED` 告警。
- **被动检出**：`doctor` / `validate` 检出 00/02 锚点过期或缺失时，告警文本内附同一份可复制操作模板。
- **`docs/` 写盘永远放行**：`check-work-order` 将 `docs/` 列入白名单，无 activeTask 也可写；且 00/02 为 `.md` 不参与 compile 哈希强校验。

## 各 Tier 差异速查

| 步骤 | Tier 1 | Tier 2 | Tier 3 |
|------|--------|--------|--------|
| matrix.yaml (Schema v3) | 创建 | 创建 | 创建 |
| index.js + version.js | ✅ | ✅ | ✅ |
| hooks (BeforeTool/AfterTool) | ❌ | ✅ | ✅ |
| pre-commit (validate) | ❌ | ✅ | ✅ |
| GEMINI.md | tier1 模板 | tier2 模板 | tier3 模板 |
| nodes/ | ❌ | ✅ | ✅ |
| knowledge/ | ❌ | ❌ | ✅ |

---

## 🔄 增量方法库（按需加载，不常驻）

初始化时脚本会自动把 **to-spec（需求分析）** 与 **to-tickets（任务拆解）** 两套增量方法复制到项目 `.asa/rules/`。这两套方法的完整规约**默认不加载**，由 GEMINI.md / CLAUDE.md 的「增量方法库」段兜底触发：

- 用户**明确说要做需求分析 / 需求规格化**时 → 读取并严格执行 `.asa/rules/to-spec.md`（含 Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions / Out of Scope / **Further Notes** 全模板；**用 `add-req --spec <源.md>` 忠实落盘 REQ 节点，杜绝二次回填压缩**）。
- 用户**明确说要做任务拆解 / 拆 tickets**时 → 读取并严格执行 `.asa/rules/to-tickets.md`（Tracer-Bullet 垂直切片、Expand-Contract、**拆解后交用户确认**、**用 `add-task --desc/--inputs/--outputs/--req` 一次全量落盘**、`edge add` + `link-task` + `plan-tasks` 建图、Frontier 前沿驱动）。

> 维护建议：如需调整这两套方法的模板或流程，直接改 `.asa/rules/to-spec.md` / `to-tickets.md`，无需改动 GEMINI.md 常驻指令。

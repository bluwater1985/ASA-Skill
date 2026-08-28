# ASA (AI Software Architect) 规范化工程管理流程指南

本文件是 **ASA-Skill-main** 项目的系统上下文指南与行为准则，供未来所有在此工作区进行开发与维护的 AI 智能体阅读、遵循并无条件执行。

---

## 🎯 1. 项目概述与核心定位

### 1.1 项目简介
**ASA (AI Software Architect)** 是一个革命性的 Spec-Driven（规格驱动）和 Document-Driven（文档驱动）的 AI 协同工程管理框架。它通过高契约的节点数据矩阵与状态机网络，将 AI 从一个纯粹的“代码生成器”升级为对“项目全生命周期行为负责”的严谨架构师。

- **支持平台**：完美原生兼容 **Claude Code** 和 **Gemini CLI** 双平台。
- **运行环境**：Windows / Mac / Linux。
- **技术理念**：刻意追求 **零外部依赖（Zero External Dependencies）**，完全基于 Node.js 内置 API (fs, path, crypto, os 等) 构建高可靠、轻量级的命令处理引擎。

### 1.2 渐进式运行层级 (Three-Tier System)
ASA 通过三个不同的契约级别（Tier 1 ~ Tier 3），分步对 AI 助手的开发过程进行防守与自动化验证：

| 级别 | 名称 | 防守烈度与核心机制 | 模板路径 |
| :--- | :--- | :--- | :--- |
| **Tier 1** | **Starter Mode (极简启动)** | 每次会话开始强制读取 `matrix.yaml`，按 meta.phase 与 activeTask 自律跟进。适合开发初期或微型项目。 | `templates/gemini-tier1.md`<br>`templates/CLAUDE-tier1.md` |
| **Tier 2** | **Defender Mode (离线防御)** | 引入 CLI 自动对账（reconcile）与反写（patch）维护。支持变更影响分析（impact）与级联传播（propagate）。防止架构漂移。 | `templates/gemini-tier2.md`<br>`templates/CLAUDE-tier2.md` |
| **Tier 3** | **Strong Contract (强契约模式)**| 强制执行 Work Order，代码改写前必须声明活跃 Task。配备严格的 CI 校验门禁（validate），验证 docs digest 一致性、YAML 合法性及未尽传播条目。 | `templates/gemini-tier3.md`<br>`templates/CLAUDE-tier3.md` |

---

## 🚀 2. 安装、构建与运行指令

### 2.1 快速安装与集成
项目提供了跨平台、自适应的快速安装脚本，它能自动检测本地安装的 AI 客户端，并进行 Skill/配置 的注册：

```bash
# Claude Code 平台一键集成
node install.js claude

# Gemini CLI 平台一键集成
node install.js gemini

# 自动检测已安装的客户端并安装
node install.js
```

### 2.2 CLI 引擎运行方式
ASA CLI 引擎内置于 `engine/` 目录。在项目中，引擎通常会被安装或软链接至项目根目录下的 `.asa/`，通过以下命令调度运行：

```bash
node .asa/index.js <command> [args]
```

### 2.3 常用命令表 (CLI Commands)

引擎暴露了 **32 个核心与辅助命令**。按功能可划分为以下几个核心阶段：

#### A. 基础与同步
- **对账与自举**：`node .asa/index.js reconcile`  
  *状态一致性对账。若 `matrix.yaml` 损坏或缺失，可基于 `nodes/` 目录下现有 yaml 文件自举重建。支持 Tab / 块标量等历史数据平滑向下兼容迁移，并自动生成 `.bak` 备份文件。*
- **正向编译**：`node .asa/index.js compile`  
  *解析所有的 `nodes/*.yaml` 节点，编译生成前端展示的 `docs/01-requirements.md`、`02-architecture.md` 与 `03-tasks.md` 等，支持对文档头、尾和节点间用户手写注释/非节点文本进行完美的语义保留和合并。*
- **反向同步**：`node .asa/index.js patch`  
  *提取 markdown 中的变更（主要是验收标准 `acceptanceCriteria`）反写回 `nodes/*.yaml` 文件中，打通双向流转资产。*
- **CI 门禁检查**：`node .asa/index.js validate`  
  *严格校验文档哈希（digest）、节点漂移（nodesDigest 变动）以及任何未完成的 `pendingPropagation` 级联传播，作为 CI/CD 的拦截卡点。*
- **拓扑遍历**：`node .asa/index.js traverse <id>`  
  *基于依赖边进行图的 BFS 拓扑遍历，生成下游影响的 blast radius JSON 格式数据。*

#### B. 状态机推进
- **节点状态流转**：`node .asa/index.js status <id> <new-status>`  
  *按设定的状态机强规则对 REQ, ARCH, TASK 节点状态进行原子推进，拒绝任何非法跳转（如 proposed 直跳 implemented ），同状态幂等拦截。*
- **级联废弃**：`node .asa/index.js deprecate <id>`  
  *一键废弃（REQ 变更为 `deprecated` / ARCH 变更为 `superseded` / TASK 变更为 `cancelled`），并级联将下游所有的 TASK 变更为 `cancelled`。*
- **环境设置**：
  - 设置项目阶段：`node .asa/index.js set phase <phase>`  
    *可选 phase 包括: `init`, `discovery`, `architecture`, `task-breakdown`, `implementation`, `review`*
  - 激活工作任务：`node .asa/index.js set active-task <TASK-ID>`  
    *在 implementation 阶段，用于激活当前的任务。使用 `clear` 清除。*

#### C. 变更影响与传播
- **影响范围分析**：`node .asa/index.js impact <id>`  
  *图级分析报告。正向 BFS 计算下游影响并输出变动树，逆向 BFS 溯源上游依赖。*
- **幂等变更传播**：`node .asa/index.js propagate <id>`  
  *逐条级联执行 `pendingPropagation` 中定义的结构化动作（如 `set_status`, `append_to_array`, `set_field`, `replace_in_array`），具有完全确定性和幂等性，任何节点传播失败会被局部保留为 `partial` 以便排障。*
- **变更请求入口**：
  - `node .asa/index.js change-req <id>`
  - `node .asa/index.js change-arch <id>`
  - `node .asa/index.js change-task <id>`  
    *创建阶段变更请求，生成备份快照，并进入引导式变更流程。*

#### D. 节点生命周期管理
- **需求新增**：`node .asa/index.js add-req <title> [--priority P1]` *(自动分配 ID 并执行 compile)*
- **架构新增**：`node .asa/index.js add-arch <title>`
- **任务新增**：`node .asa/index.js add-task <title>`
- **变更审计**：`node .asa/index.js journal` *(全局系统历史)*
- **单点审计**：`node .asa/index.js history <id>` *(单节点历史追溯)*
- **边管理（环路安全检测）**：
  - `node .asa/index.js edge add <from> <to> --type depends|extends|refines`  
    *建立依赖或扩展边，在加入前利用逆向 BFS 机制运行强环路检测，若出现循环依赖则严词拒绝。*
  - `node .asa/index.js edge rm <from> <to>`

#### E. 任务生命周期与编排 (Task Lifecycle & Orchestration)
- **任务确认**：`node .asa/index.js confirm-task <TASK-ID> [--by <user>] [--note <msg>]`  
  *对提审的任务由架构师确认，记录审计信息并将其推进至 completed 状态。*
- **任务打回**：`node .asa/index.js reject-task <TASK-ID> [--by <user>] [--reason <msg>]`  
  *对有缺陷的任务进行打回，记录审计并将状态重置为 in_progress。*
- **任务取消**：`node .asa/index.js cancel-task <TASK-ID> [--by <user>] [--reason <msg>]`  
  *一键安全取消处于提审中的任务，将其置为 cancelled 终态，自动清理关联的 activeTask。*
- **拓扑编排规划**：`node .asa/index.js plan-tasks`  
  *基于 Kahn 拓扑算法，计算无环就绪及被阻塞的任务图规划。*
- **总览叙事更新**：`node .asa/index.js update-overview`  
  *纯只读汇总项目最新状态，输出叙事锚点，辅助模型对 00/02 文档重写升级。*

---

## 🧪 3. 单元测试与集成测试

ASA 的测试追求物理上的隔离、高覆盖率（整体覆盖率 ≥ 80%，当前约 87.5%）与自建沙箱沙盒体系。

### 3.1 运行测试
项目采用 Node.js 18+ 内置的 `node:test` 测试框架，没有任何外部 npm package 依赖：

```bash
# 1. 跑全量测试（包含单元测试、命令集成、Hooks测试等）
node --test engine/lib/*.test.js engine/commands/commands.test.js engine/hooks/hooks.test.js

# 2. 仅运行库单元测试
node --test engine/lib/*.test.js

# 3. 仅运行命令级集成测试（通过 helpers.js 启动沙盒、模拟运行和进程退出状态断言）
node --test engine/commands/commands.test.js

# 4. 仅运行 Hook 双协议适配测试
node --test engine/hooks/hooks.test.js

# 5. 运行带有测试覆盖率报告的跑测（Node.js 18+ 原生特性）
node --experimental-test-coverage --test engine/lib/*.test.js engine/commands/commands.test.js engine/hooks/hooks.test.js
```

### 3.2 沙盒测试机制 (Sandbox Setup)
在命令集成测试中，严禁在库层直接拦截 `process.exit`（因为容易被模块内部的常规 `catch` 误吞导致静默通过）。
应使用 `engine/commands/helpers.js` 中提供的沙盒创建方法，并在子进程（`child_process.execFileSync`）中独立调用 `index.js`，通过真实返回的进程 `status` 进行失败与断言拦截。

---

## 📐 4. 开发约定与设计规范

在为此项目编写新特性、修改 Bug、或者重构核心逻辑时，必须严格遵守以下工程规范：

### 4.1 零外部依赖 (Zero Dependency)
- 严禁引入任何第三方 npm 包（无论是 `yaml`, `lodash`, 还是测试相关的 `jest`/`mocha` 等）。
- 遇到 YAML 解析、图算法、深度拷贝等复杂操作时，必须基于原生 Node.js 内置库手写或扩展已有的 `engine/lib/` 内部模块。

### 4.2 运行时计算路径 (Dynamic Path Calculation)
- **核心规约**：诸如读取 `matrix.yaml` 的位置等路径，必须在函数内部即时调用 `process.cwd()` 计算得出（例如 `matrixPath()` / `docsDir()`），**绝对禁止**将 `process.cwd()` 缓存到模块级常量中。
- **原因**：支持单次测试运行中动态切换、并发创建多个沙盒沙箱（Sandboxes）而不会造成路径污染和文件交叉篡改。

### 4.3 库层 throw 与 CLI 顶层 Catch
- `engine/lib/*.js` 的库模块严禁随意调用 `process.exit()` 终结程序，一旦遇到致命错误、格式崩坏、不合规跳转等必须直接通过 `throw new Error(...)` 向上传递。
- 最终所有的错误都应冒泡至 `engine/index.js` 的顶级 Try-Catch 块中。由顶层负责友好、美观地打印 `[ASA] ❌ 异常描述`，并以 `process.exit(1)` 退出。

### 4.4 数据不可变性 (Immutability First)
- 库模块在执行操作（例如处理边、序列化数据、图计算）时，尽量不要对传入的节点或数据源执行就地（In-place）修改。应优先通过解构、深拷贝等方式返回修改后的新对象。
- 内部辅助或测试挂载的临时运行时字段，必须统一以 `__` 双下划线前缀命名（例如 `node.__category`），且确保在写盘落盘（写入 YAML）之前，调用过滤函数将所有 `__` 前缀的元数据剔除干净。

### 4.5 YAML 自研解析器安全性约定
`engine/lib/yaml.js` 属于团队精心打磨的高效率、轻量级、无外部依赖解析器：
- **流解析限制**：不支持 YAML 的块标量 `|` 或 `>`。如果发现含有块标量，解析器应立刻报错，并引导用户使用多行引号代替。
- **引号与转义**：精确执行 `escapeDq` 与 `unescapeDq`（控制反斜杠、`"`、换行、Tab）。改动此模块时，必须补充并严格跑通 Round-trip 往返校验测试（即确保 `Parse` -> `Stringify` -> `Parse` 之后所得内容完备且完全一致）。

### 4.6 Dual Protocol 双适配 Hook 铁律
项目中的 `engine/hooks/check-work-order.js` 和 `validate-yaml.js` 需要适配 Claude Code 和 Gemini CLI 两大平台不同的消息格式：
- **Claude Code Hook**：接收命令行 `process.argv`。
- **Gemini CLI Hook**：通过 `process.stdin` 读取传入的标准化 JSON。
- **协议兼容处理**：Hook 脚本应当能在运行时动态辨别调用来源，如果是标准输入非空 JSON，则自动采用 JSON 解析并运行拦截 or 放行逻辑（拦截返回 JSON 格式，其中 `decision: "deny"`，放行则 `decision: "allow"`）；如果是常规 argv，则以进程退出码（`exit(2)` 或 `exit(0)`）的形式进行阻断。

---

## 🛡️ 5. 跨项目避坑与 Windows 适配铁律 (大鹏高定必守规范)

由于本项目在 Windows 环境下会频繁使用到 Shell 命令、脚本生成、一键安装、编码转码等行为，未来任何在此工作区的智能体，**必须 100% 物理死守以下三大防崩溃、防乱码的防呆红线**：

### 5.1 自动化替换与文件读写安全
- 严禁使用 Python 临时脚本的二进制模式（如 `rb`/`wb`）配合字节串（`b"..."`）进行多行文本读写或行级正则匹配。
- 只要文件内包含任何中文注释、全角字符（例如：`“`、`”`、`：` 等）或 Emoji 表情，二进制字节匹配立刻会导致 `SyntaxError: bytes can only contain ASCII literal characters`。
- **正确做法**：一律使用带有 UTF-8 编码的普通文本读写模式（如 `open(..., 'w', encoding='utf-8')`），并采用普通多行字符串。

### 5.2 Windows Powershell 语法兼容
- 在 Windows 环境（win32）下执行多条 Shell 拼接命令时，**严禁使用 Bash 风格的 `&&` 连接符**（Windows 自带的 PowerShell 5.1/7.x 对该符号的条件执行逻辑不支持，会直接抛出严重的解析语法错误）。
- **正确做法**：命令之间必须使用分号 `;` 分开（即使前面一条失败依然会继续运行），或者直接拆解为多条独立的 CLI 工具子进程命令。

### 5.3 Windows Batch (BAT) 编写与编码防崩溃铁律
在编写任何供 Windows 部署、运行、初始化的 `.bat` 或 `.cmd` 批处理文件时，智能体面临极高崩溃率，必须无条件遵循以下两条终极法测：

1. **括号截断语法 Bug 防范**：
   - **绝不能**在 `if (...)` 或 `for (...)` 括号代码块的内部放置任何带有中文注释、中文提示或表情 Emoji 的 `echo` 语句。
   - Windows CMD 在解析带有双字节汉字的 GBK/UTF-8 脚本时，尾字节的拼写错位极易被 CMD 解释器错判为右括号 `)`，导致整个括号控制分支被物理截断、提前闭合，瞬间爆出 `'xxx' 不是内部或外部命令` 并闪退。
   - **正确做法**：只要分支、循环中包含中文内容，**必须彻底废弃 `if (...)` 结构**，重构为扁平的 `goto :label` 跳转跳转跳转跳转结构，从物理层面根除括号解析歧义。

2. **强制 ANSI/GBK 编码转码落盘**：
   - 任何生成的批处理文件（`.bat`/`.cmd`），若其中含有任何中文字符、中文标点或 Emoji 图标，在最终保存写入磁盘时，**写盘后必须 100% 统一转码并保存为 Windows 原生的 GBK (CP936) 编码格式**，绝对禁止存留 UTF-8 格式（即使文件头部声明了 `chcp 936`，UTF-8 依然会导致 CMD 逻辑运行中发生乱码或变量条件解析闪退）。
   - **正确做法**：在写完文件后，应自动启动一段 Python 代码，以 UTF-8 格式读取它，再以 GBK 编码覆盖写盘。
     ```python
     with open(bat_path, 'r', encoding='utf-8') as f:
         content = f.read()
     with open(bat_path, 'w', encoding='gbk', errors='ignore') as f:
         f.write(content)
     ```

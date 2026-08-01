# 贡献指南（CONTRIBUTING）

欢迎为 ASA（AI Software Architect）贡献代码、文档或反馈。本文档帮助开发者快速上手，理解项目架构与约定。

---

## 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | 18+ | 项目零外部依赖，仅用内置模块（`fs`/`path`/`crypto`/`os`） |
| Git | 任意 | 版本管理 |

> 无需 `npm install` —— 项目刻意零外部依赖。

---

## 克隆与目录结构

```bash
git clone <repo-url> ASA
cd ASA
```

```
asa/
├── install.js          # 跨平台安装脚本（部署到 ~/.asa 或 ~/.gemini）
├── engine/             # 核心引擎（零外部依赖）
│   ├── index.js        # CLI 路由（17 个命令）
│   ├── commands/       # 命令实现（每命令一个文件）
│   ├── lib/            # 库模块（yaml/matrix/graph/state-machine/changelog）
│   └── hooks/          # Claude/Gemini 双协议 hook 脚本
├── templates/          # CLAUDE/GEMINI 项目指令模板（tier1~3）
├── skeleton/           # 空矩阵骨架
├── clients/            # 客户端 Skill 定义与初始化脚本
└── docs/               # 文档
```

---

## 运行测试

项目使用 Node.js 内置 `node:test`，无外部测试框架。

### 跑全部测试

```bash
node --test engine/lib/*.test.js engine/commands/commands.test.js engine/hooks/hooks.test.js
```

### 只跑某一类

```bash
# 库模块单元测试
node --test engine/lib/yaml.test.js

# 命令集成测试（沙箱 + 子进程）
node --test engine/commands/commands.test.js

# hook 双协议测试（Claude argv / Gemini stdin）
node --test engine/hooks/hooks.test.js
```

### 覆盖率

```bash
node --experimental-test-coverage --test engine/lib/*.test.js engine/commands/commands.test.js engine/hooks/hooks.test.js
```

当前目标：**整体行覆盖率 ≥ 80%**（当前约 87.5%）。新增代码必须配套测试。

### 测试约定

| 层 | 文件 | 方式 |
|----|------|------|
| 单元测试 | `engine/lib/*.test.js` | 直接调用模块函数 |
| 命令集成 | `engine/commands/commands.test.js` | 沙箱目录 + 子进程执行 `index.js` |
| Hook 测试 | `engine/hooks/hooks.test.js` | 沙箱 + `spawnSync` 模拟 argv/stdin |

**命令测试关键点**：不要拦截 `process.exit`（会被命令内部 catch 误捕）。用子进程方式获取真实退出码：

```js
const { execFileSync } = require('child_process');
const r = execFileSync(process.execPath, [engineIndex, command, ...args], { cwd: sandboxDir, encoding: 'utf8' });
```

沙箱辅助工具：`engine/commands/helpers.js`（`createSandbox` / `run` / `readNode` / `readMatrix` / `writeNode`）。

---

## 架构约定

### 分层

```
index.js (CLI 路由)
  └── commands/*.js    # 命令实现：加载数据 → 处理 → 写回 → 输出
        └── lib/*.js   # 库：yaml 解析 / matrix 读写 / 图遍历 / 状态机 / changelog
              └── hooks/*.js  # 独立脚本，不依赖 commands/
```

### 核心约定

1. **零外部依赖**：只用 Node 内置模块。新增库功能必须自制实现（如 YAML 解析器、图遍历）。
2. **路径调用时计算**：`matrixPath()` / `docsDir()` 在函数内调用 `process.cwd()`，不缓存为模块常量（支持多项目/测试多沙箱）。
3. **数据不可变优先**：函数尽量返回新对象，避免就地修改共享数据。
4. **失败显式化**：库层用 `throw`（而非 `process.exit`），CLI 顶层（`index.js`）统一 try/catch 转友好错误。
5. **`__` 前缀字段是内部元数据**：`loadAllNodes` 挂 `__category`，写盘前剔除。

### 新增命令步骤

1. 在 `engine/commands/` 新建 `yourcmd.js`，导出 `{ run }`
2. 在 `engine/index.js` 引入并注册 case
3. 在 `engine/commands/commands.test.js` 补集成测试（沙箱 + 断言输出/文件）
4. 更新 `README.md` 命令表和 `docs/ASA-GUIDE.html`

### YAML 解析器注意

`engine/lib/yaml.js` 是自制紧凑解析器，有明确语义，改动需谨慎：

- 引号转义：`escapeDq` / `unescapeDq`（反斜杠、`"`、换行、Tab）
- 内联注释：仅引号外、`#` 前有空白才算注释
- flow 集合：`[...]` / `{...}` 支持嵌套（`splitFlow` 感知深度与引号）
- 块标量 `|`/`>` 不支持，解析器显式报错
- 未闭合引号/括号显式报错（转义感知）

**改解析器必须补 round-trip 测试**（parse → stringify → parse 结果一致）。

---

## 提 PR 检查清单

- [ ] 测试通过：`node --test engine/lib/*.test.js engine/commands/commands.test.js engine/hooks/hooks.test.js`
- [ ] 覆盖率 ≥ 80%（新增代码有测试覆盖）
- [ ] 零外部依赖，未引入新 npm 包
- [ ] 无 `console.log` 调试残留（命令输出用 `console.log`/`console.error` 属预期）
- [ ] 错误处理：库层 throw，CLI 顶层友好捕获
- [ ] 路径用 `matrixPath()`/`docsDir()`，不缓存 `process.cwd()`
- [ ] 新命令已注册到 `index.js` + README + HTML 文档
- [ ] 跨平台：路径用 `path.join`，CRLF 归一化，Windows 反斜杠处理

---

## 提交信息规范

```
<type>: <描述>

type: feat | fix | refactor | docs | test | chore | perf | ci
```

示例：`fix: propagate 全部幂等跳过时也落盘清除条目`

---

## 相关文档

- `README.md` — 项目概览、安装、命令表
- `docs/RUNBOOK.md` — 使用与排障手册
- `docs/ASA-GUIDE.html` — 完整可视化指南（结构/原理/使用/架构）
- `ASA-v3-changelife-design.md` — v3 全链路变更管理设计文档

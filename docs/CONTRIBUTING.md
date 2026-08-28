# 贡献指南（CONTRIBUTING）

欢迎为 ASA（AI Software Architect）贡献代码、文档或反馈。本文档帮助开发者快速上手，理解项目架构与最新 v3 规范约定。

---

## 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | 18+ | 项目零外部依赖，仅使用内置模块（`fs`/`path`/`crypto`/`os`） |
| Git | 任意 | 版本管理 |

> 无需 `npm install` —— 项目刻意不引入任何外部 npm 依赖包，以保障极端环境下的开箱即用与纯净健壮。

---

## 克隆与目录结构

```bash
git clone <repo-url> ASA
cd ASA
```

```
asa/
├── install.js          # 跨平台一键安装脚本（部署到 ~/.asa、~/.gemini、~/.claude 客户端）
├── engine/             # 核心引擎（零外部依赖）
│   ├── index.js        # CLI 路由（支持 17+ 核心命令，含 ACID 崩溃事务扫描）
│   ├── version.js      # 引擎版本与支持的 Schema 最大版本（v3）定义
│   ├── commands/       # 命令实现（高内聚，一个文件实现一个命令）
│   ├── lib/            # 底层库（yaml解析/矩阵读写/图遍历/状态机/审计历史/崩溃事务自愈/文件锁）
│   └── hooks/          # Claude/Gemini 客户端 Hook 双协议适配脚本与 AwaitingConfirmation 启动诊断
├── templates/          # CLAUDE/GEMINI 项目指令模板（包含渐进式 Tier 1~3 模板）
├── skeleton/           # 空数据矩阵骨架
├── clients/            # 双平台客户端 Skill 宿主与启动配置
└── docs/               # 全量文档、规范与开发者指南
```

---

## 运行测试

项目完全采用 Node.js 内置的 `node:test` 测试框架，无任何第三方测试包依赖。

### 跑全部测试（含单元、集成、钩子）

```bash
node --test engine/lib/*.test.js engine/commands/*.test.js engine/hooks/hooks.test.js
```

### 运行特定测试

```bash
# 库模块单元测试（例如：自研 YAML 解析、图算法、自愈事务）
node --test engine/lib/yaml.test.js
node --test engine/lib/transaction.test.js

# 命令级集成测试（沙箱环境 + 子进程物理隔离）
node --test engine/commands/commands.test.js

# hook 双协议适配测试（验证 Claude argv 与 Gemini stdin JSON 两套参数流）
node --test engine/hooks/hooks.test.js
```

### 覆盖率测试（Node.js 18+ 原生特性）

```bash
node --experimental-test-coverage --test engine/lib/*.test.js engine/commands/commands.test.js engine/hooks/hooks.test.js
```

当前核心目标：**整体行覆盖率 ≥ 80%**（当前已稳健提升至 85%+）。新增代码或核心修复必须配套相应的测试用例，并在本地跑通。

### 测试隔离与沙箱约定

| 测试层级 | 测试文件位置 | 隔离方式与机制 |
|----------|--------------|----------------|
| 单元测试 | `engine/lib/*.test.js` | 直接调用模块底层 API 函数，采用 Mock 隔离。 |
| 命令集成 | `engine/commands/commands.test.js` | 通过 `helpers.js` 启动独立沙箱，用子进程（物理隔离）执行 `index.js`。 |
| Hook 适配 | `engine/hooks/hooks.test.js` | 建立沙箱，用 `spawnSync` 模拟传入标准 stdin JSON 或 argv 执行 Hook。 |

**命令测试物理防捕获原则**：严禁在底层库中随意捕获并拦截 `process.exit`（容易被中间常规的 try/catch 误捕导致测试静默通过）。命令集成必须利用 `engine/commands/helpers.js` 中提供的 `createSandbox` 和 `run` 在独立的子进程中真实退出，并断言其退出状态码（exit code）和输出文本。

---

## 架构与核心约定

### 分层设计

```
index.js (CLI 顶级入口，执行事务自愈、全局独占文件锁、路由分发)
  └── commands/*.js    # 命令业务实现层：加载数据矩阵 → 业务处理与校验 → 写回数据 → 结果反馈
        └── lib/*.js   # 底层引擎库：自研 YAML 读写 / matrix 数据自举 / 图遍历拓扑 / 状态机规则 / 崩溃物理自愈
              └── hooks/*.js  # 双平台客户端集成 Hook：轻量，零 dependencies 约束
```

### 物理开发核心红线（贡献者必须死守）

1. **绝对零外部依赖**：拒绝任何第三方 npm 包（包含 `yaml`, `lodash`, `chalk` 等）。如遇复杂功能，请在 `engine/lib/` 内部自研实现并补充测试。
2. **动态运行时路径计算**：读取 `matrix.yaml` 等路径必须在方法内部通过调用 `process.cwd()` 动态计算（例如 `matrixPath()`），**严禁**在模块加载时将 `process.cwd()` 缓存为全局模块常量。这对于并发跑测、多项目沙箱并行隔离至关重要。
3. **数据不可变**：对矩阵中的节点进行处理时，推荐使用深拷贝或解构产生新副本，避免直接对传入的节点或边进行就地（In-place）修改。
4. **异常显式上抛**：底层库模块在逻辑出错、校验失败时应一律 `throw new Error(...)`。由顶级 `index.js` 进行 Catch 并以 `process.exit(1)` 退出，防止致命错误被中间逻辑静默吞没。
5. **元数据剔除**：在内存中挂载的运行时内部属性（如 `__category` 等）必须采用 `__` 双下划线前缀。写盘前通过过滤算法将其彻底剔除干净。
6. **崩溃自愈事务一致性**：所有执行磁盘写操作的命令必须纳入 `beginTransaction()` 事务控制中，并将修改清单写入 `.asa/transactions/<TX-ID>/manifest.json`，确保一旦进程遭遇强杀，自愈引擎能在下次启动时执行完整的原物理副本覆盖还原。

---

## 新增或更新命令规范

1. 在 `engine/commands/` 新建对应的 `[command-name].js`，导出 `{ run }` 函数。
2. 在 `engine/index.js` 引入并注册对应的 CLI 路由。若为写操作，注册到 `writeCommands` 独占文件锁集合中，确保并发安全与事务。
3. 在 `engine/commands/commands.test.js` 补齐该命令在沙箱中的物理集成测试，断言生成文件与状态码。
4. 在 `README.md`、`docs/RUNBOOK.md`、以及可视化指南 `docs/ASA-GUIDE.html` 中同步更新该命令的用法与说明。

---

## 提 PR 检查清单

- [ ] 本地测试通过：`node --test engine/lib/*.test.js engine/commands/commands.test.js engine/hooks/hooks.test.js`
- [ ] 覆盖率稳定保持在 80% 以上（新增代码伴随有覆盖率用例）。
- [ ] 物理零外部依赖，没有多余的 `package.json` 依赖引入。
- [ ] 没有任何 `console.log` 的本地调试残留。
- [ ] 底层抛出、顶层捕获，无静默吞异常行为。
- [ ] 路径处理已完全使用 `path.join` 等，在 Windows (win32) 与 Unix 下均能稳定运行（防路径斜杠、盘符大小写不敏感匹配导致 Hook 还原丢失）。
- [ ] 批处理文件（`.bat`/`.cmd`）已满足 **大鹏高定 Windows 防崩溃规范**（扁平 `goto` 跳转防止汉字截断、写盘前 GBK/ANSI 转码覆盖）。
- [ ] 双平台 Hook 协议兼容已通过验证。

---

## 提交信息规范

```
<type>: <描述>

可选 type: feat | fix | refactor | docs | test | chore | perf | ci
```

示例：`feat: 增加 plan-tasks 命令，实现并行任务的多阶段拓扑编排方案`

---

## 相关文档

- `README.md` — 项目主文档、一键安装、命令速查与特性汇总
- `docs/RUNBOOK.md` — 详细的日常操作指南、工作流实践、常见异常自愈与排障手册
- `docs/ASA-GUIDE.html` — 可视化单文件完整系统指南（建议在浏览器中直接双击打开）
- `ASA-v3-changelife-design.md` — v3 全链路变更管理与 ACID 自愈事务设计文档

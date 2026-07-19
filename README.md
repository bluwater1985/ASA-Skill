# ASA — AI Software Architect

> 把 AI 从"代码生成器"变成"项目负责人"。
> Spec-Driven + Document-Driven + AI-Driven Development。

支持 **Claude Code** 和 **Gemini CLI** 双平台。Windows / Mac / Linux 通用。

---

## 快速安装

### 方式一：安装脚本（推荐，跨平台）

```bash
# Claude Code 用户
node install.js claude

# Gemini CLI 用户
node install.js gemini
```

> 要求 Node.js 18+。自动复制引擎、模板、Skill 定义，Gemini 用户还会自动启用 experimental.skills。

### 方式二：手动安装

**Claude Code 用户：**
```bash
# Mac / Linux
cp -r clients/claude/.claude ~/
cp -r engine ~/.asa

# Windows (PowerShell)
Copy-Item -Recurse clients/claude/.claude -Destination $env:USERPROFILE\.claude
Copy-Item -Recurse engine -Destination $env:USERPROFILE\.asa
```

**Gemini CLI 用户：**
```bash
# Mac / Linux
cp -r clients/gemini/.gemini ~/
cp -r engine ~/.asa

# Windows (PowerShell)
Copy-Item -Recurse clients/gemini/.gemini -Destination $env:USERPROFILE\.gemini
Copy-Item -Recurse engine -Destination $env:USERPROFILE\.asa
```

> **Windows 注意**：`pre-commit` 文件需要 Git Bash 或 WSL 环境。如果没有，可以手动跳过。

### 方式三：从源码一键安装

```bash
node install.js
# 脚本会自动检测已安装的 AI 客户端并选择对应版本
```

---

## 目录结构

```
asa/
├── install.js                       # 跨平台安装脚本（推荐）
├── README.md
├── engine/                          # 共用引擎
│   ├── index.js                     # 5 命令引擎
│   └── hooks/
│       ├── check-work-order.js      # 状态拦截器
│       └── validate-yaml.js         # YAML 校验器
├── templates/                       # 项目指令模板
│   ├── CLAUDE-tier1~3.md
│   └── gemini-tier1~3.md
├── skeleton/matrix.yaml             # 空矩阵骨架
└── clients/
    ├── claude/.claude/skills/asa/SKILL.md
    └── gemini/.gemini/skills/asa/
        ├── SKILL.md
        └── scripts/asa-init.js
```

---

## 使用

| 客户端 | 启动方式 | 初始化命令 |
|--------|----------|-----------|
| Claude Code | `claude` | `/asa init` |
| Gemini CLI | `gemini chat` | 说"初始化 ASA" |

---

## 引擎命令（两边通用）

```bash
node ~/.asa/index.js reconcile     # 事务对账 + 状态摘要
node ~/.asa/index.js patch         # 反向同步
node ~/.asa/index.js traverse ID   # 图遍历
node ~/.asa/index.js compile       # 编译文档
node ~/.asa/index.js validate      # 健康检查
```

---

## 跨平台兼容性

| 组件 | Mac | Linux | Windows |
|------|-----|-------|---------|
| 引擎 index.js | ✅ | ✅ | ✅ |
| Hook 脚本 | ✅ | ✅ | ✅ |
| asa-init.js | ✅ | ✅ | ✅ |
| install.js | ✅ | ✅ | ✅ |
| 模板 / 文档 | ✅ | ✅ | ✅ |
| pre-commit | ✅ | ✅ | ⚠️ 需 Git Bash |
| asa-init.sh | ✅ | ✅ | ❌（用 .js 替代） |

---

## 核心特性

- **幂等初始化**：多次运行不丢失项目数据
- **语义化合并**：CLAUDE.md / GEMINI.md 已存在时保留用户手写规约
- **跨平台 Hook**：同一套脚本兼容 Claude Code（argv）和 Gemini CLI（stdin JSON）
- **自定位寻址**：脚本自动定位项目根目录，不依赖 CWD
- **换行符兼容**：哈希计算前标准化 CRLF/LF
- **Windows 安全**：`findProjectRoot` 使用 `parent === dir` 判停，无死循环

## 许可证

MIT

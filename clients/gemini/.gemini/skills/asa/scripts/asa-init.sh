#!/bin/bash
# asa-init.sh — ASA v3（Gemini CLI 版）
# 用法: asa-init.sh [tier1|tier2|tier3]
set -e

TIER="${1:-tier2}"
echo "🚀 ASA v3 初始化 — $TIER"

mkdir -p .asa/nodes/requirements .asa/nodes/architecture .asa/nodes/tasks
mkdir -p .asa/hooks

# 1. matrix.yaml
if [ ! -f .asa/matrix.yaml ]; then
  cat > .asa/matrix.yaml << YAML
meta:
  project: "__PROJECT__"
  phase: "discovery"
  schemaVersion: 2
  docsExpectedDigest: "sha256:empty"
  docsActualDigest: "sha256:empty"
risks: []
requirements: {}
architecture: {}
tasks: {}
edges: []
YAML
  echo "✅ .asa/matrix.yaml"
fi

# 2. 引擎（index.js + commands/ + lib/ + hooks/）
if [ -f "$HOME/.asa/index.js" ]; then
  cp "$HOME/.asa/index.js" .asa/index.js
  echo "✅ .asa/index.js"
fi
if [ -d "$HOME/.asa/commands" ]; then
  mkdir -p .asa/commands
  cp "$HOME/.asa/commands/"*.js .asa/commands/ 2>/dev/null
  echo "✅ .asa/commands/"
fi
if [ -d "$HOME/.asa/lib" ]; then
  mkdir -p .asa/lib
  cp "$HOME/.asa/lib/"*.js .asa/lib/ 2>/dev/null
  echo "✅ .asa/lib/"
fi

# 3. Hook 脚本
if [ -d "$HOME/.asa/hooks" ]; then
  cp "$HOME/.asa/hooks/check-work-order.js" .asa/hooks/
  cp "$HOME/.asa/hooks/validate-yaml.js" .asa/hooks/
  chmod +x .asa/hooks/*.js
  echo "✅ .asa/hooks/"
fi

# 4. GEMINI.md（不覆盖已有文件）
TIER_NUM=1
[ "$TIER" = "tier2" ] && TIER_NUM=2
[ "$TIER" = "tier3" ] && TIER_NUM=3

if [ -f "$HOME/.asa/templates/gemini-tier$TIER_NUM.md" ]; then
  if [ -f GEMINI.md ]; then
    echo "⚠️  GEMINI.md 已存在，跳过"
  else
    cp "$HOME/.asa/templates/gemini-tier$TIER_NUM.md" GEMINI.md
    echo "✅ GEMINI.md"
  fi
fi

# 5. Hooks 配置（Tier 2+）
if [ "$TIER" != "tier1" ]; then
  cat > .gemini/settings.json << CFG
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "write_file|replace|edit_file|patch_file|apply_diff|move_file",
        "hooks": [
          {
            "name": "asa-check-work-order",
            "type": "command",
            "command": "node $(pwd)/.asa/hooks/check-work-order.js",
            "timeout": 5000,
            "description": "ASA: 状态拦截"
          }
        ]
      }
    ],
    "AfterTool": [
      {
        "matcher": "write_file|replace|edit_file|patch_file|apply_diff|move_file",
        "hooks": [
          {
            "name": "asa-validate-yaml",
            "type": "command",
            "command": "node $(pwd)/.asa/hooks/validate-yaml.js",
            "timeout": 5000,
            "description": "ASA: YAML 校验"
          }
        ]
      }
    ]
  }
}
CFG
  echo "✅ .gemini/settings.json"

  # pre-commit
  mkdir -p .husky
  echo "node .asa/index.js validate || exit 1" > .husky/pre-commit
  chmod +x .husky/pre-commit
  echo "✅ .husky/pre-commit"
fi

echo ""
echo "✅ ASA $TIER 初始化完成"
echo ""
echo "📁 项目结构:"
echo "   .asa/"
echo "   ├── index.js         # 引擎"
echo "   ├── matrix.yaml      # 状态索引"
echo "   ├── hooks/           # Hook 脚本"
echo "   └── nodes/"
echo "       ├── requirements/"
echo "       ├── architecture/"
echo "       └── tasks/"
echo "   GEMINI.md            # 项目指令"
echo ""
echo "💡 开始聊需求："
echo "   告诉我你想做什么项目？"

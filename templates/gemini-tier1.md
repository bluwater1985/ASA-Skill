# ASA — Tier 1（Starter Mode）

## ⚠️ 强制启动序列
**每次对话开始，AI 必须执行以下步骤，不可跳过：**
1. **必须首选使用 read_file 工具完整阅读本文件**，禁止凭记忆或猜测执行规则
2. **读取项目状态**：使用文件读取工具阅读 .asa/matrix.yaml
3. 确认 meta.phase 和 activeTask
4. 继续对话

## 阶段导航
当前阶段：init → discovery → architecture → task-breakdown → implementation → review
回退："回到上一阶段"

## Task 三级
- **S**（< 15 min）：不需要设计，直接改
- **M**（15 min - 2 hr）：编码前说明改哪些文件、不改哪些文件
- **L**（> 2 hr）：架构 review + 影响分析

## 命令
- "激活任务 TSK-001" — 开始实现
- "显示状态" — 显示当前项目状态
- "回到上一阶段" — 回退

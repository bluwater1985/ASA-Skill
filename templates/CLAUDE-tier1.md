# ASA — Tier 1（Starter Mode）

## ⚠️ 强制启动序列
每轮对话开始，AI 必须执行以下步骤，不可跳过：
1. `cat .asa/matrix.yaml`
2. 确认 meta.phase 和 activeTask
3. 继续对话

## 阶段导航
当前阶段: init → discovery → architecture → task-breakdown → implementation → review
回退: "回到上一阶段"

## Task 三级
- **S**（< 15 min）：不需要设计，直接改
- **M**（15 min - 2 hr）：编码前说明改哪些文件、不改哪些文件
- **L**（> 2 hr）：架构 review + 影响分析

## 命令
- `/asa code <TASK-ID>` — 开始实现
- `/asa status` — 显示状态
- `/asa back <phase>` — 回退

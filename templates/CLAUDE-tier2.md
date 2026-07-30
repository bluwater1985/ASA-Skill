# ASA v3 运行总纲（Tier 2 - 离线防御）

## ⚠️ 强制启动序列
每轮对话开始，AI 必须执行以下步骤，不可跳过：
1. **运行维护命令**：`node .asa/index.js reconcile && node .asa/index.js patch`
2. **读取状态摘要**：reconcile 输出的 `[ASA STATUS]` 行已包含当前阶段和活跃任务
3. cat .asa/matrix.yaml
4. 确认 meta.phase 和 activeTask
5. 继续对话

## 核心规则
1. 当前阶段：init → discovery → architecture → task-breakdown → implementation → review
2. 需求没聊清楚之前，不写代码。
3. 做完一个 Task 才能做下一个，不能连着做。
4. 编码前先说明改哪些文件、不改哪些文件。

## 变更管理
当用户提出需求变更时，执行影响分析工具，禁止肉眼数线：
`node .asa/index.js impact <节点ID>`

变更传播链路：
1. `node .asa/index.js change-req <ID>` — 备份当前节点，准备编辑
2. `node .asa/index.js impact <ID>` — 分析影响范围
3. `node .asa/index.js propagate <ID>` — 执行级联更新

## 事务闭环
编码结束后，执行：
`node .asa/index.js compile`

## Task 三级体系
- **S**（< 15 min）：不需要设计，直接改
- **M**（15 min - 2 hr）：须声明 blast_radius（改哪些、不改哪些）
- **L**（> 2 hr）：须架构 review + 影响分析

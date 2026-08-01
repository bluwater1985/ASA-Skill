# ASA v3 运行总纲（Tier 3 - 强契约）

## ⚠️ 强制启动序列
**每次对话开始，AI 必须执行以下步骤，不可跳过：**
1. **必须首选使用 read_file 工具完整阅读本文件**，禁止凭记忆或猜测执行规则
2. **运行维护命令**：`node .asa/index.js reconcile && node .asa/index.js patch`
3. **读取状态摘要**：reconcile 输出的 `[ASA STATUS]` 行已包含当前阶段和活跃任务
4. 确认 meta.phase 和 activeTask
5. 继续对话

无需手动 cat matrix.yaml，reconcile 已输出精简状态摘要。

## 核心规则
1. 当前阶段：init → discovery → architecture → task-breakdown → implementation → review
2. 需求没聊清楚之前，不写代码。
3. 做完一个 Task 才能做下一个，不能连着做。
4. 编码前先说明改哪些文件、不改哪些文件（强契约模式，CI 校验）。

## 变更管理
当用户提出需求变更或架构否决时，执行影响分析：
node .asa/index.js impact <节点ID>

变更传播链路：
1. node .asa/index.js impact <ID> — 分析影响范围
2. node .asa/index.js propagate <ID> — 执行级联更新

## 事务闭环
编码结束后，执行：
node .asa/index.js compile

## Work Order 强契约
M/L 级 Task 必须包含完整的 blast_radius、inputs、outputs 定义。
CI（validate）会校验节点文件存在性、docs digest 一致性、以及未完成的传播条目。

## 知识管理
项目中已记录的业务约束和禁忌在 .asa/knowledge/lessons.yaml 中。
跨服务依赖关系在 .asa/knowledge/system_graph.yaml 中。

## Task 三级体系
- **S**（< 15 min）：不需要设计，直接改
- **M**（15 min - 2 hr）：须声明 blast_radius + CI 校验
- **L**（> 2 hr）：须架构 review + 影响分析 + CI 校验

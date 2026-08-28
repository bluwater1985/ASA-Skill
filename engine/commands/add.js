// engine/commands/add.js — 新增节点 (add-req / add-arch / add-task)
const path = require('path');
const fs = require('fs');
const { loadMatrix, saveMatrix, loadAllNodes, atomicWriteYaml } = require('../lib/matrix.js');
const { parseAsaYaml } = require('../lib/yaml.js');
const { topCandidates, dice, scoreReq } = require('../lib/similarity.js');

const TEMPLATES = {
  REQ: {
    dir: 'requirements',
    template: {
      title: '新需求',
      status: 'proposed',
      version: 1,
      priority: 'P2',
      acceptanceCriteria: [],
      changeLog: [],
      pendingPropagation: [],
    },
  },
  ARCH: {
    dir: 'architecture',
    template: {
      title: '新架构组件',
      status: 'draft',
      version: 1,
      changeLog: [],
      pendingPropagation: [],
    },
  },
  TASK: {
    dir: 'tasks',
    template: {
      title: '新任务',
      status: 'pending',
      version: 1,
      inputs: [],
      outputs: [],
      linkedReqs: [],
      changedFiles: [],
      changeLog: [],
      pendingPropagation: [],
    },
  },
};

function getNextId(nodesDir) {
  let max = 0;
  if (fs.existsSync(nodesDir)) {
    for (const f of fs.readdirSync(nodesDir)) {
      const match = f.match(/^(REQ|ARCH|TASK)-(\d+)\.yaml$/);
      if (match) {
        const num = parseInt(match[2], 10);
        if (num > max) max = num;
      }
    }
  }
  return max + 1;
}

// 去重（保持首次出现顺序）
function dedupe(arr) {
  return Array.from(new Set(arr));
}

// 若值是已存在的文件路径，则读取其内容作为字符串；否则按字面量使用
function existsOrInline(val) {
  return fs.existsSync(val) ? fs.readFileSync(val, 'utf-8') : val;
}

// 把 --inputs/--outputs 的值解析为数组：值是文件则按行拆分；否则按逗号拆分
function toList(val) {
  const raw = fs.existsSync(val) ? fs.readFileSync(val, 'utf-8') : val;
  const items = String(raw).includes('\n')
    ? String(raw).split(/\r?\n/)
    : String(raw).split(',');
  return items.map(s => s.trim()).filter(Boolean);
}

// 从 --spec 源文件文本中提取 spec 正文与验收标准：
//   - '## Acceptance Criteria' 之前的正文逐字保留为 spec
//   - 该章节下的 '- <条目>' 列表解析为 acceptanceCriteria 数组（逐字，去首尾空白）
// 无该章节时，全文作为 spec，ac 为空数组。
function extractSpec(sourceText) {
  const marker = '## Acceptance Criteria';
  const idx = sourceText.indexOf(marker);
  if (idx === -1) return { specBody: sourceText.trim(), ac: [] };
  const specBody = sourceText.slice(0, idx).trim();
  const rest = sourceText.slice(idx + marker.length);
  const ac = [];
  for (const raw of rest.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (/^#{1,6}\s/.test(line)) break; // 遇到下一章节则停止
    const m = line.match(/^-\s+(.+)$/);
    if (m) ac.push(m[1].trim());
    // 非 bullet 行（说明性文字）忽略
  }
  return { specBody, ac };
}

function runNode(prefix, args) {
  const prefixMap = { 'req': 'REQ', 'arch': 'ARCH', 'task': 'TASK' };
  const p = prefixMap[prefix];
  if (!p) {
    console.error(`[ASA] ❌ 未知类型: ${prefix}，请使用 req/arch/task`);
    process.exit(1);
  }

  // 解析参数
  let priority = null;
  let allowSimilarId = null;
  let allowReason = null;
  let operator = 'system';
  let specSrc = null;        // add-req --spec <源文件.md>
  let requestId = null;      // --id <REQ-xxx>（认领指定 id）
  const taskOpts = { desc: null, inputs: null, outputs: null, req: null }; // add-task 全量字段
  const argList = Array.isArray(args) ? args : [args];
  const titleParts = [];

  for (let i = 0; i < argList.length; i++) {
    const a = argList[i];
    const next = () => argList[++i];
    if (a === '--priority') { priority = next(); }
    else if (a === '--allow-similar') { allowSimilarId = next(); }
    else if (a === '--reason') { allowReason = next(); }
    else if (a === '--by') { operator = next(); }
    else if (a === '--id') { requestId = next(); }
    else if (a === '--spec') { specSrc = next(); }
    else if (a === '--desc') { taskOpts.desc = next(); }
    else if (a === '--inputs') { taskOpts.inputs = next(); }
    else if (a === '--outputs') { taskOpts.outputs = next(); }
    else if (a === '--req') { taskOpts.req = next(); }
    else if (a && a.startsWith('--')) {
      console.error(`[ASA] ❌ 未知参数: ${a}`);
      process.exit(1);
    } else { titleParts.push(a); }
  }
  const title = titleParts.join(' ').trim();
  if (!title) {
    console.error(`[ASA] ❌ 节点标题不能为空。`);
    process.exit(1);
  }

  // 1. 查重拦截 (仅 REQ 类型需求节点校验)
  if (p === 'REQ') {
    const allNodes = loadAllNodes();
    const existingReqs = Object.values(allNodes).filter(n => n.id && n.id.startsWith('REQ-'));

    const allCandidates = [];
    for (const req of existingReqs) {
      const scoreTitle = dice(title, req.title || '');
      const scoreCombined = scoreReq(title, req);
      const finalScore = Math.max(scoreTitle, scoreCombined);
      if (finalScore >= 0.3) {
        allCandidates.push({
          id: req.id,
          title: req.title,
          score: finalScore,
          status: req.status || 'pending',
          version: req.version || 1
        });
      }
    }
    allCandidates.sort((a, b) => b.score - a.score);

    if (allCandidates.length > 0) {
      console.log(`[ASA] ℹ️ 发现相似度相似的需求候选清单 (score >= 0.3):`);
      for (const cand of allCandidates) {
        console.log(`  - [${cand.id}] ${cand.title} (Status: ${cand.status}, Version: ${cand.version}, Score: ${cand.score.toFixed(2)})`);
      }
    }

    const matched = allCandidates.filter(c => c.score > 0.9);
    if (matched.length > 0) {
      const topOne = matched[0];
      const hasOperator = operator && operator !== 'system';
      const isExempt = allowSimilarId && allowSimilarId === topOne.id && allowReason && hasOperator;
      
      if (!isExempt) {
        if (allowSimilarId && allowSimilarId === topOne.id && allowReason && !hasOperator) {
          console.error(`[ASA] ❌ 逃生舱绕过失败：必须使用 --by 指定真实操作人，严禁缺省或为 system。`);
        } else {
          console.error(`[ASA] ❌ 发现相似度极高的存量需求 (${topOne.id}: "${topOne.title}", 相似度: ${topOne.score.toFixed(2)})，已拦截。`);
          console.error(`[ASA] 💡 提示: 若确需新增，请使用逃生舱参数强制允许:`);
          console.error(`  node .asa/index.js add-req "${title}" --allow-similar ${topOne.id} --reason "您的绕过原因" --by "您的名字"`);
        }
        process.exit(1);
      }
    } else {
      // 没有任何高相似度冲突时，严禁写入任何伪造的 allowSimilar 审计元数据
      allowSimilarId = null;
      allowReason = null;
    }
  }

  const cfg = TEMPLATES[p];
  const dir = path.join(process.cwd(), `.asa/nodes/${cfg.dir}`);
  fs.mkdirSync(dir, { recursive: true });

  // id：指定 --id 则认领该校验过的 id；否则自动取下一序号
  let id;
  if (requestId) {
    if (!new RegExp(`^${p}-\\d+$`).test(requestId)) {
      console.error(`[ASA] ❌ --id 格式错误，应为 ${p}-<数字>: ${requestId}`);
      process.exit(1);
    }
    id = requestId;
  } else {
    id = `${p}-${String(getNextId(dir)).padStart(3, '0')}`;
  }

  // B：若目标节点已存在，以其为基底并保留作者已写内容（spec/AC/description/inputs/...），
  // 仅叠盖命令字段与本次显式传入的字段；否则以模板默认字段新建。杜绝"空模板覆盖 + 二次回填"。
  const nodePath = path.join(dir, `${id}.yaml`);
  let node = {};
  if (fs.existsSync(nodePath)) {
    try { node = parseAsaYaml(fs.readFileSync(nodePath, 'utf-8')) || {}; }
    catch (e) { node = {}; }
  }
  // 以模板补全缺失的默认字段（不覆盖已有值）
  for (const [k, v] of Object.entries(JSON.parse(JSON.stringify(cfg.template)))) {
    if (node[k] === undefined) node[k] = Array.isArray(v) ? [] : v;
  }
  node.id = id;
  if (title) node.title = title;
  if (priority && p === 'REQ') node.priority = priority;

  // add-req：--spec 源文件导入（忠实落盘，Layer D）
  if (p === 'REQ' && specSrc) {
    if (!fs.existsSync(specSrc)) {
      console.error(`[ASA] ❌ --spec 文件不存在: ${specSrc}`);
      process.exit(1);
    }
    const sourceText = fs.readFileSync(specSrc, 'utf-8').replace(/\r\n/g, '\n');
    const { specBody, ac } = extractSpec(sourceText);
    node.spec = specBody;
    node.acceptanceCriteria = dedupe([...(node.acceptanceCriteria || []), ...ac]);
    // 归档来源文件为可审阅的唯一真值源（按 id 落 .asa/specs/<id>.md）
    const specsDir = path.join(process.cwd(), '.asa/specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, `${id}.md`), sourceText, 'utf-8');
  }

  // add-task：description/inputs/outputs/linkedReqs 一次全量写入（Layer D）
  if (p === 'TASK') {
    if (taskOpts.desc) node.description = existsOrInline(taskOpts.desc);
    if (taskOpts.inputs) node.inputs = toList(taskOpts.inputs);
    if (taskOpts.outputs) node.outputs = toList(taskOpts.outputs);
    if (taskOpts.req) node.linkedReqs = dedupe([...(node.linkedReqs || []), taskOpts.req]);
  }

  // 记录逃生舱凭证至节点中
  if (p === 'REQ' && allowSimilarId && allowReason) {
    node.allowSimilar = {
      id: allowSimilarId,
      reason: allowReason,
      by: operator
    };
  }

  atomicWriteYaml(nodePath, node);

  // 登记到 matrix 摘要索引
  const matrix = loadMatrix();
  const key = p === 'REQ' ? 'requirements' : p === 'ARCH' ? 'architecture' : 'tasks';
  matrix[key] = matrix[key] || {};
  matrix[key][id] = { title: node.title, status: node.status };
  if (key === 'tasks') matrix[key][id].file = `.asa/nodes/tasks/${id}.yaml`;
  saveMatrix(matrix);

  console.log(`[ASA] ✅ ${id} 已创建: ${node.title}`);

  // 自动重编译 docs + 刷新 nodesDigest，避免 docs/nodes 漂移
  try {
    const { run: compile } = require('./compile.js');
    compile();
  } catch (e) {
    console.error(`[ASA] ❌ compile 失败，将回滚当前写入。错误: ${e.message}`);
    throw e;
  }
}

module.exports = { run: runNode };

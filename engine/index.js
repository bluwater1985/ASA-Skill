// .asa/index.js — ASA v3 确定性状态机工具链（零外部依赖）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ══════════════════════════════════════════
// OPTION C: ASA 专属紧凑型 YAML 解析/序列化器
// ══════════════════════════════════════════
function parseAsaYaml(text) {
  const lines = text.split('\n');
  const root = {};
  const stack = [{ indent: -1, obj: root, key: null }];

  for (const rawLine of lines) {
    const trimmed = rawLine.trimEnd();
    if (trimmed.trimStart().startsWith('#') || trimmed === '') continue;

    const indent = trimmed.length - trimmed.trimStart().length;
    const content = trimmed.trimStart();

    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const currentStack = stack[stack.length - 1];
    let parent = currentStack.obj;

    if (content.startsWith('- ') || content === '-') {
      if (currentStack.key && !Array.isArray(parent[currentStack.key])) {
        parent[currentStack.key] = [];
      }
      const arrayContainer = currentStack.key ? parent[currentStack.key] : parent;
      if (!Array.isArray(arrayContainer)) continue;

      const rawSlice = content.startsWith('- ') ? content.slice(2) : '';
      const value = rawSlice === '' ? {} : parseScalar(rawSlice);
      arrayContainer.push(value);

      if (rawSlice === '' || typeof value === 'object') {
        stack.push({ indent, obj: arrayContainer[arrayContainer.length - 1], key: null });
      }
      continue;
    }

    const colonIdx = content.indexOf(':');
    if (colonIdx === -1) continue;
    const key = content.slice(0, colonIdx).trim();
    const rawVal = content.slice(colonIdx + 1).trim();

    if (rawVal === '') {
      parent[key] = parent[key] || {};
      stack.push({ indent, obj: parent, key: key });
    } else {
      parent[key] = parseScalar(rawVal);
    }
  }
  return root;
}

function parseScalar(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    return inner ? inner.split(',').map(item => parseScalar(item.trim())) : [];
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === 'true' || s === 'false') return s === 'true';
  if (s === 'null' || s === '~') return null;
  return s;
}

function stringifyAsaYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  let out = '';
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) { out += `${pad}${key}: []\n`; continue; }
      out += `${pad}${key}:\n`;
      for (const item of value) {
        if (typeof item === 'object' && item !== null) {
          const entries = Object.entries(item);
          if (entries.length > 0) {
            const [firstKey, firstVal] = entries[0];
            out += `${pad}  - ${firstKey}: ${stringifyScalar(firstVal)}\n`;
            const innerPad = pad + '    ';
            for (let i = 1; i < entries.length; i++) {
              const [k, v] = entries[i];
              out += `${innerPad}${k}: ${stringifyScalar(v)}\n`;
            }
          } else {
            out += `${pad}  -\n`;
          }
        } else {
          out += `${pad}  - ${stringifyScalar(item)}\n`;
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      out += `${pad}${key}:\n`;
      out += stringifyAsaYaml(value, indent + 1);
    } else {
      out += `${pad}${key}: ${stringifyScalar(value)}\n`;
    }
  }
  return out;
}

function stringifyScalar(v) {
  if (typeof v === 'string') {
    if (v.includes(': ') || v.includes('#') || v.startsWith('-') || v === '') return `"${v}"`;
    return v;
  }
  return String(v);
}

// ══════════════════════════════════════════
// ASA 工具箱辅助函数
// ══════════════════════════════════════════
const MATRIX_PATH = path.join(process.cwd(), '.asa/matrix.yaml');
const DOCS_DIR = path.join(process.cwd(), 'docs');

function loadMatrix() {
  if (!fs.existsSync(MATRIX_PATH)) {
    console.error('[ASA] 错误: 找不到 .asa/matrix.yaml 文件');
    process.exit(1);
  }
  return parseAsaYaml(fs.readFileSync(MATRIX_PATH, 'utf-8'));
}

function saveMatrix(matrix) {
  fs.writeFileSync(MATRIX_PATH, stringifyAsaYaml(matrix), 'utf-8');
}

function calculateDocsDigest() {
  if (!fs.existsSync(DOCS_DIR)) return 'sha256:empty';
  const files = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.md')).sort();
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    // 标准化换行符：\r\n → \n，抹平 Windows/Mac/Linux 差异
    const content = fs.readFileSync(path.join(DOCS_DIR, file), 'utf-8')
      .replace(/\r\n/g, '\n');
    hash.update(content);
  }
  return `sha256:${hash.digest('hex')}`;
}

function loadAllNodes() {
  const nodes = {};
  const categories = ['requirements', 'architecture', 'tasks'];
  for (const cat of categories) {
    const dir = path.join(process.cwd(), `.asa/nodes/${cat}`);
    if (!fs.existsSync(dir)) continue;
    fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).forEach(file => {
      const id = path.basename(file, '.yaml');
      nodes[id] = parseAsaYaml(fs.readFileSync(path.join(dir, file), 'utf-8'));
      nodes[id].__category = cat;
    });
  }
  return nodes;
}

// ══════════════════════════════════════════
// 5 原子命令实现
// ══════════════════════════════════════════

function compile() {
  const matrix = loadMatrix();
  const nodes = loadAllNodes();
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR);

  let reqContent = '# 项目核心需求资产清单\n\n';
  for (const [id, node] of Object.entries(nodes)) {
    if (node.__category !== 'requirements') continue;
    reqContent += `<!-- ASA-NODE: ${id} -->\n`;
    reqContent += `## ${id}: ${node.title || '未命名'}\n\n`;
    reqContent += `- 优先级: ${node.priority || 'P1'}\n`;
    reqContent += `- 当前状态: ${node.status || 'pending'}\n\n`;
    reqContent += `<!-- ASA-FIELD: acceptanceCriteria -->\n`;
    if (Array.isArray(node.acceptanceCriteria)) {
      node.acceptanceCriteria.forEach(c => { reqContent += `- ${c}\n`; });
    }
    reqContent += `<!-- ASA-NODE-END -->\n\n---\n\n`;
  }

  fs.writeFileSync(path.join(DOCS_DIR, '01-requirements.md'), reqContent.trim(), 'utf-8');
  console.log('[ASA] Docs 编译完成。');

  const newDigest = calculateDocsDigest();
  matrix.meta = matrix.meta || {};
  matrix.meta.docsExpectedDigest = newDigest;
  matrix.meta.docsActualDigest = newDigest;
  saveMatrix(matrix);
}

function patch() {
  const matrix = loadMatrix();
  if (matrix.meta.docsExpectedDigest === matrix.meta.docsActualDigest) return;

  console.log('[ASA] 检测到人类直接修改了 docs/，启动定向 Patch 反向同步...');
  const mdFiles = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.md'));
  const nodes = loadAllNodes();
  let hasChanges = false;

  for (const file of mdFiles) {
    const content = fs.readFileSync(path.join(DOCS_DIR, file), 'utf-8');
    for (const [id, node] of Object.entries(nodes)) {
      if (node.__category !== 'requirements') continue;
      let criteria = null;
      const nodeRegex = new RegExp(`<!-- ASA-NODE: ${id} -->([\\s\\S]*?)<!-- ASA-NODE-END -->`);
      const nodeMatch = content.match(nodeRegex);
      if (nodeMatch) {
        const fieldRegex = /<!-- ASA-FIELD: acceptanceCriteria -->\n([\s\S]*?)(?=(<!-- ASA-|$))/;
        const fieldMatch = nodeMatch[1].match(fieldRegex);
        if (fieldMatch) {
          criteria = fieldMatch[1].trim().split('\n').map(l => l.replace(/^-\s*/, '')).filter(Boolean);
        }
      } else {
        const titleRegex = new RegExp(`## ${id}:[\\s\\S]*?\\n([\\s\\S]*?)(?=(## |---|$))`);
        const titleMatch = content.match(titleRegex);
        if (titleMatch) {
          console.warn(`[ASA] 警告: ${id} 锚点损坏，已降级为宽松标题匹配。`);
          criteria = titleMatch[1].split('\n')
            .filter(l => l.trim().startsWith('-') && !l.includes('优先级:') && !l.includes('当前状态:'))
            .map(l => l.replace(/^-\s*/, '')).filter(Boolean);
        }
      }

      if (criteria) {
        if (JSON.stringify(node.acceptanceCriteria) !== JSON.stringify(criteria)) {
          node.acceptanceCriteria = criteria;
          const cat = node.__category;
          delete node.__category;
          fs.writeFileSync(
            path.join(process.cwd(), `.asa/nodes/${cat}/${id}.yaml`),
            stringifyAsaYaml(node), 'utf-8'
          );
          hasChanges = true;
          console.log(`[ASA] ${id}.yaml 已定向 Patch 反写。`);
        }
      } else {
        console.warn(`[ASA] 无法定位 ${id} 的字段，放弃反向同步。`);
      }
    }
  }

  if (hasChanges) compile();
  else {
    matrix.meta.docsActualDigest = matrix.meta.docsExpectedDigest;
    saveMatrix(matrix);
  }
}

function traverse(startId) {
  const matrix = loadMatrix();
  if (!matrix.edges) { console.log(JSON.stringify({ source: startId, blastRadius: [] })); return; }

  const affected = [];
  const queue = [startId];
  const visited = new Set([startId]);

  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of (matrix.edges || []).filter(e => e.from === current)) {
      if (!edge.to) continue;
      const targets = Array.isArray(edge.to) ? edge.to : [edge.to];
      for (const toId of targets) {
        if (!visited.has(toId)) {
          visited.add(toId);
          queue.push(toId);
          affected.push({ id: toId, type: toId.split('-')[0] });
        }
      }
    }
  }
  console.log(JSON.stringify({ source: startId, blastRadius: affected }, null, 2));
}

function reconcile() {
  const matrix = loadMatrix();
  const nodes = loadAllNodes();
  let hasChanges = false;

  if (matrix.tasks) {
    for (const [taskId, summary] of Object.entries(matrix.tasks)) {
      if (nodes[taskId] && nodes[taskId].status !== summary.status) {
        console.log(`[ASA] 🔄 断裂事务修复: ${taskId} [${summary.status}] → [${nodes[taskId].status}]`);
        matrix.tasks[taskId].status = nodes[taskId].status;
        hasChanges = true;
      }
    }
  }

  const currentDigest = calculateDocsDigest();
  if (matrix.meta?.docsActualDigest !== currentDigest) {
    matrix.meta.docsActualDigest = currentDigest;
    hasChanges = true;
  }

  if (hasChanges) saveMatrix(matrix);

  // 输出精简状态摘要（供 AI 快速读取，替代 cat 完整 matrix.yaml）
  const activeTask = matrix.meta?.activeTask || '(none)';
  const phase = matrix.meta?.phase || '(unknown)';
  const total = matrix.tasks ? Object.keys(matrix.tasks).length : 0;
  const done = matrix.tasks ? Object.values(matrix.tasks).filter(t => t.status === 'done').length : 0;
  console.log(`[ASA STATUS] Phase: ${phase} | ActiveTask: ${activeTask} | Tasks: ${done}/${total} done`);
}

function validate() {
  try {
    const matrix = loadMatrix();
    for (const [id, meta] of Object.entries(matrix.tasks || {})) {
      if (meta.file && !fs.existsSync(path.join(process.cwd(), meta.file))) {
        console.error(`[ASA] ❌ 索引任务 ${id} 指向的文件 ${meta.file} 不存在`);
        process.exit(1);
      }
    }

    const physicalDigest = calculateDocsDigest();
    if (matrix.meta?.docsExpectedDigest !== physicalDigest) {
      console.error(`[ASA] ❌ docs/ 已被篡改或未运行 compile`);
      process.exit(1);
    }

    console.log('[ASA] ✅ 全量健康检查通过');
    process.exit(0);
  } catch (e) {
    console.error(`[ASA] ❌ validate 崩溃: ${e.message}`);
    process.exit(2);
  }
}

// ══════════════════════════════════════════
// CLI 路由
// ══════════════════════════════════════════
const [,, command, arg] = process.argv;

switch (command) {
  case 'compile':   compile(); break;
  case 'patch':     patch(); break;
  case 'traverse':  if (!arg) { console.error('需指定节点 ID'); process.exit(1); } traverse(arg); break;
  case 'reconcile': reconcile(); break;
  case 'validate':  validate(); break;
  default:
    console.log('ASA CLI v3 — 用法:\n  compile | patch | traverse <id> | reconcile | validate');
    process.exit(1);
}

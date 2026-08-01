// engine/commands/patch.js — docs → 节点反向同步
const path = require('path');
const fs = require('fs');
const { loadMatrix, saveMatrix, loadAllNodes, calculateDocsDigest, atomicWriteYaml } = require('../lib/matrix.js');
const { appendChangeLog } = require('../lib/changelog.js');

const DOCS_DIR = path.join(process.cwd(), 'docs');

function run() {
  const matrix = loadMatrix();
  // 用物理 digest 判断（而非 matrix 里存储的旧 digest），使 patch 单独运行即自洽
  const physicalDigest = calculateDocsDigest();
  if (physicalDigest === matrix.meta?.docsExpectedDigest) return;

  if (!fs.existsSync(DOCS_DIR)) {
    console.log('[ASA] docs/ 目录不存在，跳过反向同步');
    return;
  }

  console.log('[ASA] 检测到人类直接修改了 docs/，启动定向 Patch 反向同步...');
  const mdFiles = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.md'));
  const nodes = loadAllNodes();
  let hasChanges = false;

  for (const file of mdFiles) {
    // 归一化换行符，避免 CRLF（Windows）导致字段正则 \n 匹配失败
    const content = fs.readFileSync(path.join(DOCS_DIR, file), 'utf-8').replace(/\r\n/g, '\n');
    for (const [id, node] of Object.entries(nodes)) {
      if (node.__category !== 'requirements') continue;
      let criteria = null;
      const nodeRegex = new RegExp(`<!-- ASA-NODE: ${id} -->([\\s\\S]*?)<!-- ASA-NODE-END -->`);
      const nodeMatch = content.match(nodeRegex);
      if (nodeMatch) {
        const fieldRegex = /<!-- ASA-FIELD: acceptanceCriteria -->\n([\s\S]*?)(?=(<!-- ASA-|$))/;
        const fieldMatch = nodeMatch[1].match(fieldRegex);
        if (fieldMatch) {
          // 分组解析：`- ` 开头是新 criterion，续行（缩进非 `- `）追加到上一条，保留换行
          const lines = fieldMatch[1].split('\n');
          const groups = [];
          for (const line of lines) {
            const m = line.match(/^-\s*(.*)$/);
            if (m) {
              groups.push(m[1]);
            } else if (groups.length > 0 && line.trim() !== '') {
              groups[groups.length - 1] += '\n' + line.trim();
            }
          }
          criteria = groups.filter(Boolean);
        }
      } else {
        const titleRegex = new RegExp(`## ${id}:[\\s\\S]*?\\n([\\s\\S]*?)(?=(## |---|$))`);
        const titleMatch = content.match(titleRegex);
        if (titleMatch) {
          console.warn(`[ASA] 警告: ${id} 锚点损坏，已降级为宽松标题匹配。`);
          criteria = titleMatch[1].split('\n')
            .filter(l => l.trim().startsWith('-') && !l.includes('优先级:') && !l.includes('当前状态:') && !l.includes('版本:'))
            .map(l => l.replace(/^-\s*/, '')).filter(Boolean);
        }
      }

      if (criteria) {
        if (JSON.stringify(node.acceptanceCriteria) !== JSON.stringify(criteria)) {
          node.acceptanceCriteria = criteria;
          // 记录变更 + 递增版本，保证可追溯
          appendChangeLog(node, 'modified', `docs 反向同步: 更新 acceptanceCriteria`);
          const cat = node.__category;
          delete node.__category;
          atomicWriteYaml(
            path.join(process.cwd(), `.asa/nodes/${cat}/${id}.yaml`),
            node
          );
          node.__category = cat;
          hasChanges = true;
          console.log(`[ASA] ${id}.yaml 已定向 Patch 反写。`);
        }
      } else {
        console.warn(`[ASA] 无法定位 ${id} 的字段，放弃反向同步。`);
      }
    }
  }

  if (hasChanges) {
    const { run: compile } = require('./compile.js');
    compile();
  } else {
    // 无可反向同步的变更：docs 与节点不一致（如人类只改了优先级行）。
    // 以节点为准重建 docs，避免 digest 假一致导致 validate 永久失败。
    console.warn('[ASA] ⚠️ docs 中无可反向同步的字段变更（如优先级/状态/标题等手工修改），将以节点为准重建，这些手工改动会被覆盖。请改 nodes/ 下的节点文件。');
    const { run: compile } = require('./compile.js');
    compile();
  }
}

module.exports = { run };

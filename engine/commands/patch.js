// engine/commands/patch.js — docs → 节点反向同步
const path = require('path');
const fs = require('fs');
const { loadMatrix, saveMatrix, loadAllNodes, calculateDocsDigest, atomicWriteYaml } = require('../lib/matrix.js');
const { parseAsaYaml, stringifyAsaYaml } = require('../lib/yaml.js');

const DOCS_DIR = path.join(process.cwd(), 'docs');

function run() {
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
            .filter(l => l.trim().startsWith('-') && !l.includes('优先级:') && !l.includes('当前状态:') && !l.includes('版本:'))
            .map(l => l.replace(/^-\s*/, '')).filter(Boolean);
        }
      }

      if (criteria) {
        if (JSON.stringify(node.acceptanceCriteria) !== JSON.stringify(criteria)) {
          node.acceptanceCriteria = criteria;
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
    matrix.meta.docsActualDigest = matrix.meta.docsExpectedDigest;
    saveMatrix(matrix);
  }
}

module.exports = { run };

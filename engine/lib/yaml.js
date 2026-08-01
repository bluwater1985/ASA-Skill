// engine/lib/yaml.js — ASA 紧凑型 YAML 解析/序列化器（零外部依赖）
// 支持：标量、嵌套对象、标量数组、多键对象数组（sequences of mappings）

function isQuoted(s) {
  return (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"));
}

// 双引号字符串转义（用于 stringify）
function escapeDq(s) {
  let out = '';
  for (const ch of s) {
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else out += ch;
  }
  return out;
}

// 双引号字符串反解（用于 parse）
function unescapeDq(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const c = s[i + 1];
      if (c === 'n') { out += '\n'; i++; }
      else if (c === 't') { out += '\t'; i++; }
      else if (c === '\\') { out += '\\'; i++; }
      else if (c === '"') { out += '"'; i++; }
      else out += s[i]; // 未知转义，保留反斜杠
    } else {
      out += s[i];
    }
  }
  return out;
}

// 引号感知剥离行尾注释：仅在引号外、且 # 前有空白时视为注释
function stripInlineComment(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && i > 0 && /\s/.test(s[i - 1])) {
      return s.slice(0, i).trimEnd();
    }
  }
  return s.trim();
}

// 引号感知顶层逗号分拆（用于 flow 数组/映射），感知嵌套 {} / []
function splitFlow(inner) {
  const parts = [];
  let buf = '', quote = null, depth = 0;
  for (const ch of inner) {
    if (quote && ch === quote) { quote = null; buf += ch; }
    else if (!quote && (ch === '"' || ch === "'")) { quote = ch; buf += ch; }
    else if (!quote && (ch === '{' || ch === '[')) { depth++; buf += ch; }
    else if (!quote && (ch === '}' || ch === ']')) { depth--; buf += ch; }
    else if (!quote && depth === 0 && ch === ',') { parts.push(buf.trim()); buf = ''; }
    else { buf += ch; }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function parseScalar(s) {
  // 先剥离引号外的行尾注释，再做引号/数组/对象判定
  s = stripInlineComment(s);
  if (s.startsWith('"') && s.endsWith('"')) return unescapeDq(s.slice(1, -1));
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  if (s === '{}') return {};
  if (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return {};
    // flow mapping: {k: v, k2: v2}
    const obj = {};
    for (const pair of splitFlow(inner)) {
      const colon = pair.indexOf(':');
      if (colon === -1) continue;
      const k = pair.slice(0, colon).trim();
      const v = pair.slice(colon + 1).trim();
      obj[k] = parseScalar(v);
    }
    return obj;
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    return splitFlow(inner).map(item => parseScalar(item));
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === 'true' || s === 'false') return s === 'true';
  if (s === 'null' || s === '~') return null;
  return s;
}

function stringifyScalar(v) {
  if (typeof v === 'string') {
    // 需要引号包裹的情况：内容含特殊字符、换行，或可能被 parseScalar 重新解释
    // 会被 parseScalar 重新解释为 flow 集合的字符串必须加引号
    const flowCollection = (v.startsWith('[') && v.endsWith(']')) || (v.startsWith('{') && v.endsWith('}'));
    const needsQuoting = flowCollection || v.includes(': ') || v.includes('#') || v.startsWith('-') || v === '' ||
      v.includes('\n') || v.includes('\t') || v.includes('\\') || v.includes("'") || v.includes('"') ||
      /^-?\d+(\.\d+)?$/.test(v) || v === 'true' || v === 'false' || v === 'null' || v === '~';
    if (needsQuoting) return `"${escapeDq(v)}"`;
    return v;
  }
  if (typeof v === 'number' && !Number.isInteger(v)) return v.toString();
  return String(v);
}

// ── 解析 ──

function parseAsaYaml(text) {
  const lines = text.split('\n');
  const root = {};
  // stack: [{ indent, obj }]
  //   obj = 当前写入的目标对象（新 key:value 写入至此）
  //   当 key: 后跟 - 时，obj 会被懒转换为数组
  const stack = [{ indent: -1, obj: root }];

  for (const rawLine of lines) {
    const trimmed = rawLine.trimEnd();
    const content = trimmed.trimStart();

    if (content === '' || content.startsWith('#')) continue;
    // 只拒绝行首缩进的 Tab（标准 YAML 规则）；引号串内部的 Tab 由转义处理
    if (/^\s*\t/.test(trimmed)) {
      throw new Error(`YAML 解析错误: 不允许 Tab 缩进，请使用空格 (行: "${content.slice(0, 40)}")`);
    }

    const indent = trimmed.length - trimmed.trimStart().length;

    // 出栈到正确的父级
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    // ── 数组项处理 ──
    if (content.startsWith('- ') || content === '-') {
      // 确保 parent 是数组
      let arr = parent;
      if (!Array.isArray(arr)) {
        // 情况 B：parent 是对象，通过上一级 entry 找到「entryObj[ek] === parent」的引用并替换
        for (let si = stack.length - 2; si >= 0; si--) {
          const entry = stack[si];
          const entryObj = entry.obj;
          if (Array.isArray(entryObj)) continue;
          for (const ek of Object.keys(entryObj)) {
            if (entryObj[ek] === parent && !Array.isArray(entryObj[ek])) {
              entryObj[ek] = [];
              arr = entryObj[ek];
              stack[stack.length - 1].obj = arr;
              break;
            }
          }
          if (Array.isArray(arr)) break;
        }
        // 情况 A：B 找不到引用，且栈顶 obj 就是空对象占位符（`- key:` 空值创建）→ 就地转数组
        if (!Array.isArray(arr) && Object.keys(arr).length === 0 && stack.length > 1) {
          const top = stack[stack.length - 1];
          top.obj = [];
          arr = top.obj;
          // 同步更新父级对象引用（item[key]）
          const parentEntry = stack[stack.length - 2];
          if (parentEntry && parentEntry.nestedKey) {
            parentEntry.obj[parentEntry.nestedKey] = arr;
          }
        }
        if (!Array.isArray(arr)) {
          // 降级：将 parent 设为数组（极少情况）
          throw new Error(`YAML 解析错误：无法将对象转换为数组 (indent=${indent}, content="${content}")`);
        }
      }

      const itemContent = content.startsWith('- ') ? content.slice(2).trim() : '';

      if (itemContent === '') {
        // 空数组项: \n  - \n
        const item = {};
        arr.push(item);
        stack.push({ indent, obj: item });
      } else if (isQuoted(itemContent)) {
        // 引号包裹的标量: \n  - "key: value" → 不是对象
        arr.push(parseScalar(itemContent));
      } else if (itemContent.includes(':')) {
        // 对象数组项: \n  - key: value\n    subkey: val
        const colonIdx = itemContent.indexOf(':');
        const key = itemContent.slice(0, colonIdx).trim();
        const rawVal = itemContent.slice(colonIdx + 1).trim();

        const item = {};
        if (rawVal === '') {
          item[key] = {};
          Object.defineProperty(item[key], '__placeholder', { value: true, enumerable: false, writable: true });
        } else {
          item[key] = parseScalar(rawVal);
        }
        arr.push(item);
        if (rawVal === '') {
          // 嵌套首键：双压栈
          //   先压 item（带 nestedKey 标记，兄弟键可回到 item）
          //   再压 item[key] 的嵌套目标（更深行挂到这里）
          stack.push({ indent: indent, obj: item, nestedKey: key });
          stack.push({ indent: indent + 2, obj: item[key] });
        } else {
          stack.push({ indent, obj: item });
        }
      } else {
        // 标量数组项: \n  - value
        arr.push(parseScalar(itemContent));
      }
      continue;
    }

    // ── 键值对处理 ──
    const colonIdx = content.indexOf(':');
    if (colonIdx === -1) continue;

    const key = content.slice(0, colonIdx).trim();
    const rawVal = content.slice(colonIdx + 1).trim();

    if (rawVal === '') {
      // 嵌套结构: key: \n  subkey: val
      let target = parent[key];
      if (target === null || target === undefined) {
        target = {};
        // 标记为"空值占位符"，解析结束后若无子键则转为 null
        Object.defineProperty(target, '__placeholder', { value: true, enumerable: false, writable: true });
        parent[key] = target;
      }
      if (typeof target === 'object' && target !== null) {
        stack.push({ indent, obj: target });
      }
    } else {
      parent[key] = parseScalar(rawVal);
    }
  }

  // 空值占位符若无任何子键，转为 null（如 `priority:` 应为 null 而非 {}）
  cleanupPlaceholders(root);
  return root;
}

function cleanupPlaceholders(node) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (node[i] && typeof node[i] === 'object') cleanupPlaceholders(node[i]);
      if (node[i] && node[i].__placeholder && Object.keys(node[i]).length === 0) {
        node[i] = null;
      }
    }
  } else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      if (node[k] && typeof node[k] === 'object') cleanupPlaceholders(node[k]);
      if (node[k] && node[k].__placeholder && Object.keys(node[k]).length === 0) {
        node[k] = null;
      }
    }
  }
}

// ── 序列化 ──

// 序列化数组（不含 key 行，只输出 `- item` 项），用于顶层与嵌套数组
function stringifyAsaArray(arr, indent) {
  const pad = '  '.repeat(indent);
  let out = '';
  for (const item of arr) {
    if (typeof item === 'object' && item !== null) {
      const entries = Object.entries(item);
      if (entries.length === 0) {
        out += `${pad}-\n`;
      } else {
        const [firstKey, firstVal] = entries[0];
        if (typeof firstVal === 'object' && firstVal !== null && !Array.isArray(firstVal)) {
          out += `${pad}- ${firstKey}:\n`;
          out += stringifyAsaYaml(firstVal, indent + 2);
        } else if (Array.isArray(firstVal)) {
          out += `${pad}- ${firstKey}:\n`;
          out += stringifyAsaArray(firstVal, indent + 2);
        } else {
          out += `${pad}- ${firstKey}: ${stringifyScalar(firstVal)}\n`;
        }
        // 其余键（包含嵌套数组/对象）
        for (let i = 1; i < entries.length; i++) {
          const [k, v] = entries[i];
          if (Array.isArray(v)) {
            out += `${pad}  ${k}:\n`;
            out += stringifyAsaArray(v, indent + 2);
          } else if (typeof v === 'object' && v !== null) {
            out += `${pad}  ${k}:\n`;
            out += stringifyAsaYaml(v, indent + 2);
          } else {
            out += `${pad}  ${k}: ${stringifyScalar(v)}\n`;
          }
        }
      }
    } else {
      out += `${pad}- ${stringifyScalar(item)}\n`;
    }
  }
  return out;
}

function stringifyAsaYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  let out = '';
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (value === null) {
      out += `${pad}${key}: null\n`;
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        out += `${pad}${key}: []\n`;
        continue;
      }
      out += `${pad}${key}:\n`;
      out += stringifyAsaArray(value, indent + 1);
    } else if (typeof value === 'object' && value !== null) {
      if (Object.keys(value).length === 0) {
        // 空对象输出 {}，避免 round-trip 被解析为空值占位符→null
        out += `${pad}${key}: {}\n`;
        continue;
      }
      out += `${pad}${key}:\n`;
      out += stringifyAsaYaml(value, indent + 1);
    } else {
      out += `${pad}${key}: ${stringifyScalar(value)}\n`;
    }
  }
  return out;
}

module.exports = { parseAsaYaml, stringifyAsaYaml };

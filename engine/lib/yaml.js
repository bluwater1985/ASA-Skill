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
      else if (c === '\\') { out += '\\'; i++; }
      else if (c === '"') { out += '"'; i++; }
      else out += s[i]; // 未知转义，保留反斜杠
    } else {
      out += s[i];
    }
  }
  return out;
}

function parseScalar(s) {
  s = s.trim();
  // 引号包裹 → 不剥离内联注释
  if (s.startsWith('"') && s.endsWith('"')) return unescapeDq(s.slice(1, -1));
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  // 未引号值 → 剥离内联注释（空格后 # 起始；#ff0000 这类无前置空格不剥离）
  if (!s.startsWith('[') && !s.startsWith('{')) {
    const commentIdx = s.indexOf(' #');
    if (commentIdx >= 0) s = s.slice(0, commentIdx).trimEnd();
  }
  if (s === '{}') return {};
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    // 引号感知分拆：尊重引号内的逗号，不拆分
    const items = [];
    let buf = '', quote = null;
    for (const ch of inner) {
      if (quote && ch === quote) { quote = null; buf += ch; }
      else if (!quote && (ch === '"' || ch === "'")) { quote = ch; buf += ch; }
      else if (!quote && ch === ',') { items.push(buf.trim()); buf = ''; }
      else { buf += ch; }
    }
    if (buf.trim()) items.push(buf.trim());
    return items.map(item => parseScalar(item));
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === 'true' || s === 'false') return s === 'true';
  if (s === 'null' || s === '~') return null;
  return s;
}

function stringifyScalar(v) {
  if (typeof v === 'string') {
    // 需要引号包裹的情况：内容含特殊字符、换行，或可能被 parseScalar 重新解释
    const needsQuoting = v.includes(': ') || v.includes('#') || v.startsWith('-') || v === '' ||
      v.includes('\n') || v.includes('\\') || v.includes("'") || v.includes('"') ||
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
    // 检查原始行（trimStart 前），否则前导 Tab 会被误当作普通空格
    if (trimmed.includes('\t')) {
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
        // parent 是对象，需要找到正确的容器并转换
        // 查找 stack 中创建此对象的上一级 entry
        for (let si = stack.length - 2; si >= 0; si--) {
          const entry = stack[si];
          const entryObj = entry.obj;
          for (const ek of Object.keys(entryObj)) {
            if (entryObj[ek] === parent && !Array.isArray(entryObj[ek])) {
              entryObj[ek] = [];
              arr = entryObj[ek];
              // 更新栈顶 obj 为数组
              stack[stack.length - 1].obj = arr;
              break;
            }
          }
          if (Array.isArray(arr)) break;
        }
        // 如果仍然不是数组，尝试在 parent 对象上创建数组属性
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
        } else {
          item[key] = parseScalar(rawVal);
        }
        arr.push(item);
        stack.push({ indent, obj: item });
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
        parent[key] = target;
      }
      if (typeof target === 'object' && target !== null) {
        stack.push({ indent, obj: target });
      }
    } else {
      parent[key] = parseScalar(rawVal);
    }
  }

  return root;
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
          out += stringifyAsaYaml(firstVal, indent + 1);
        } else if (Array.isArray(firstVal)) {
          out += `${pad}- ${firstKey}:\n`;
          out += stringifyAsaArray(firstVal, indent + 1);
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
      out += `${pad}${key}:\n`;
      out += stringifyAsaYaml(value, indent + 1);
    } else {
      out += `${pad}${key}: ${stringifyScalar(value)}\n`;
    }
  }
  return out;
}

module.exports = { parseAsaYaml, stringifyAsaYaml };

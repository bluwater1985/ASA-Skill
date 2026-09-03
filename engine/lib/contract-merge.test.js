// engine/lib/contract-merge.test.js — GEMINI.md/CLAUDE.md 契约段落级合并测试（node:test, 零外部依赖）
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractContractBlock, parseMeta, hasContractMarkers,
  contractUnchanged, mergeContract, detectFallbackRegion
} = require('./contract-merge.js');

const TEMPLATE = `# ASA v3 运行总纲（Tier 2 - 离线防御）

<!-- ASA-CONTRACT-BEGIN: engine=3.x tier=tier2 -->
## ⚠️ 强制启动序列
第一步：先读本文件，再跑 diagnose。
## 📋 AI 协作行为基线铁律
基线五条。
<!-- ASA-CONTRACT-END -->

## 项目自定义区
这里是用户自己追加的内容。
`;

// 从上面模板里提取的"新区块"（含 BEGIN/END 边界）
const NEW_BLOCK = `<!-- ASA-CONTRACT-BEGIN: engine=3.x tier=tier2 -->
## ⚠️ 强制启动序列
第一步：先读本文件，再跑 diagnose。
## 📋 AI 协作行为基线铁律
基线五条。
<!-- ASA-CONTRACT-END -->`;

describe('extractContractBlock / parseMeta', () => {
  it('从带标记模板提取区块与元信息', () => {
    const tb = extractContractBlock(TEMPLATE);
    assert.ok(tb);
    assert.equal(tb.block, NEW_BLOCK);
    assert.equal(tb.meta.engine, '3.x');
    assert.equal(tb.meta.tier, 'tier2');
  });

  it('无标记文本返回 null', () => {
    assert.equal(extractContractBlock('# plain\n## 无标记\n'), null);
  });

  it('parseMeta 解析缺字段为 null', () => {
    const m = parseMeta('foo=bar');
    assert.equal(m.engine, null);
    assert.equal(m.tier, null);
  });
});

describe('hasContractMarkers', () => {
  it('识别完整标记', () => {
    assert.equal(hasContractMarkers(TEMPLATE), true);
    assert.equal(hasContractMarkers('# 只有 BEGIN'), false);
    assert.equal(hasContractMarkers('<!-- ASA-CONTRACT-BEGIN: engine=3.x tier=tier2 -->'), false);
  });
});

describe('contractUnchanged', () => {
  it('契约内容一致 → true（跳过）', () => {
    assert.equal(contractUnchanged(TEMPLATE, NEW_BLOCK), true);
  });
  it('契约内容不一致 → false（需合并）', () => {
    const changed = TEMPLATE.replace('基线五条。', '基线六条。');
    assert.equal(contractUnchanged(changed, NEW_BLOCK), false);
  });
  it('无标记旧文件 → false（视为需合并）', () => {
    assert.equal(contractUnchanged('# 旧文件\n## 强制启动序列\nx', NEW_BLOCK), false);
  });
});

describe('mergeContract — 带标记的现有文件', () => {
  it('精确替换 BEGIN..END 区间，保留头部与尾部自定义内容', () => {
    const existing = `# 旧标题
头部自定义保留
<!-- ASA-CONTRACT-BEGIN: engine=2.x tier=tier2 -->
## ⚠️ 强制启动序列
旧的启动序列
<!-- ASA-CONTRACT-END -->
尾部自定义保留
`;
    const merged = mergeContract(existing, NEW_BLOCK);
    assert.ok(merged.includes('头部自定义保留'));
    assert.ok(merged.includes('尾部自定义保留'));
    assert.ok(merged.includes(NEW_BLOCK));
    assert.ok(!merged.includes('旧的启动序列'));
  });
});

describe('mergeContract — 无标记旧文件（回退 A）', () => {
  it('按标准章节位置替换，保留头部标题与尾部用户追加内容', () => {
    const existing = `# ASA v3 运行总纲（Tier 2 - 离线防御）
项目头部说明

## ⚠️ 强制启动序列
旧的启动序列内容

## 🎯 核心规范与物理防御
旧的规范内容

## 📋 AI 协作行为基线铁律
旧的基线内容

## 🚀 部署说明（用户追加）
用户沉淀的部署规约
`;
    const merged = mergeContract(existing, NEW_BLOCK);
    assert.ok(merged.includes('# ASA v3 运行总纲（Tier 2 - 离线防御）'), '标题保留');
    assert.ok(merged.includes('项目头部说明'), '头部说明保留');
    assert.ok(merged.includes(NEW_BLOCK), '新契约区块插入');
    assert.ok(merged.includes('用户沉淀的部署规约'), '尾部用户内容保留');
    assert.ok(!merged.includes('旧的启动序列内容'), '旧标准段被替换');
  });

  it('找不到任何标准章节 → 返回 null（保守跳过）', () => {
    const existing = '# 纯自定义\n## 完全没有标准章节标题\n随便写点\n';
    assert.equal(mergeContract(existing, NEW_BLOCK), null);
  });
});

// ── 老项目升级迁移：新版模板带「分桶聚焦」节，老项目 GEMINI.md 没有 → 合并后自动补入，且保留自定义头/尾、幂等 ──
describe('mergeContract — 老项目自动补入「分桶聚焦查看」节（选项1 迁移）', () => {
  const NEW_BLOCK_WITH_BUCKET = `<!-- ASA-CONTRACT-BEGIN: engine=3.x tier=tier2 -->
## ⚠️ 强制启动序列
第一步：先读本文件，再跑 diagnose。
## 📋 AI 协作行为基线铁律
基线五条。
## 🔍 聚焦查看（分桶）：默认只看未完成
- \`board\` / \`list-task --active\` 默认只看未完成；已归档默认隐藏。
<!-- ASA-CONTRACT-END -->`;

  it('老项目（无分桶节、有标记）合并后自动带上新节，且保留自定义头/尾', () => {
    const existing = `# 项目头部标题
项目头部自定义说明
<!-- ASA-CONTRACT-BEGIN: engine=2.x tier=tier2 -->
## ⚠️ 强制启动序列
旧的启动序列
## 📋 AI 协作行为基线铁律
旧的基线
<!-- ASA-CONTRACT-END -->
## 项目自定义尾部
这是在契约区外用户手写的专有规约
`;
    const merged = mergeContract(existing, NEW_BLOCK_WITH_BUCKET);
    assert.ok(merged.includes('聚焦查看（分桶）'), '老项目应自动补入分桶聚焦节');
    assert.ok(merged.includes('board'), '新节命令说明被带入');
    assert.ok(merged.includes('项目头部自定义说明'), '头部自定义保留');
    assert.ok(merged.includes('这是在契约区外用户手写的专有规约'), '契约区外用户内容保留');
    assert.ok(!merged.includes('旧的启动序列'), '旧标准段被替换');
  });

  it('合并后再次判断 → contractUnchanged=true（幂等，不重复追加）', () => {
    // 模拟合并后的结果即为"最新契约区块"，再判应跳过
    assert.equal(contractUnchanged(NEW_BLOCK_WITH_BUCKET, NEW_BLOCK_WITH_BUCKET), true);
    // 老文件仍然缺 → false（仍需升级）
    const old = '# h\n<!-- ASA-CONTRACT-BEGIN: engine=2.x tier=tier2 -->\n## ⚠️ 强制启动序列\n旧\n<!-- ASA-CONTRACT-END -->\n';
    assert.equal(contractUnchanged(old, NEW_BLOCK_WITH_BUCKET), false);
  });

  it('detectFallbackRegion 将「分桶聚焦」视为标准章节（回退 A 兼容）', () => {
    const text = `# h\n## ⚠️ 强制启动序列\nA\n## 🔍 聚焦查看（分桶）\nB\n## 用户尾巴\nC\n`;
    const r = detectFallbackRegion(text);
    assert.ok(r);
    assert.equal(r.start, text.indexOf('## ⚠️ 强制启动序列'));
    assert.equal(r.end, text.indexOf('## 用户尾巴'));
  });
});

describe('detectFallbackRegion', () => {
  it('定位首个到末个标准章节标题行', () => {
    const text = `# 标题\n前文\n## ⚠️ 强制启动序列\nA\n## 📋 AI 协作行为基线铁律\nB\n## 用户尾巴\nC\n`;
    const r = detectFallbackRegion(text);
    assert.ok(r);
    assert.equal(r.start, text.indexOf('## ⚠️ 强制启动序列'));
    assert.equal(r.end, text.indexOf('## 用户尾巴'));
  });

  it('无标准章节 → null', () => {
    assert.equal(detectFallbackRegion('# 标题\n## 完全无关\n'), null);
  });
});

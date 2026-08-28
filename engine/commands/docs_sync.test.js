// docs_sync.test.js — 叙事文档（00-overview / 02-architecture）重写闭环
// TDD 用例：
//   1) update-overview 输出 Nodes Digest (当前) + 标准操作模板（一次命令闭环）
//   2) doctor / validate 的过期告警输出可复制的操作模板（被动检出路径）
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createSandbox } = require('./helpers.js');
const { stringifyAsaYaml } = require('../lib/yaml.js');
const { calculateNodesDigest } = require('../lib/matrix.js');
const { NARRATIVE_SYNC_TEMPLATE, digestLine, basedOnAnchor, seedNarrativeDocs } = require('../lib/narrative-sync.js');

// 捕获 run() 的 stdout/stderr，并把 process.exit 短路成抛错（避免测试进程被杀死）
function capture(runFn) {
  const logs = [];
  const errs = [];
  const origLog = console.log;
  const origErr = console.error;
  const origExit = process.exit;
  console.log = (m) => logs.push(String(m));
  console.error = (m) => errs.push(String(m));
  process.exit = (code) => { throw new Error('__PROCESS_EXIT__:' + code); };
  try {
    runFn();
  } catch (e) {
    if (!String(e && e.message).includes('__PROCESS_EXIT__')) throw e;
  } finally {
    console.log = origLog;
    console.error = origErr;
    process.exit = origExit;
  }
  return { stdout: logs.join('\n'), stderr: errs.join('\n'), all: logs.join('\n') + '\n' + errs.join('\n') };
}

function seedReq(dir) {
  const node = {
    id: 'REQ-001',
    title: 'Sample Requirement',
    status: 'proposed',
    priority: 'P2',
    version: 1,
    spec: 'line one\nline two',
    acceptanceCriteria: ['AC1', 'AC2'],
  };
  fs.writeFileSync(
    path.join(dir, '.asa/nodes/requirements/REQ-001.yaml'),
    stringifyAsaYaml(node)
  );
}

function seedStaleDocs(dir) {
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  const stale = '<!-- ASA-BASED-ON: sha256:0000000000000000000000000000000000000000000000000000000000000000 -->\n# Stale\n';
  fs.writeFileSync(path.join(dir, 'docs/00-overview.md'), stale);
  fs.writeFileSync(path.join(dir, 'docs/02-architecture.md'), stale);
}

function seedArch(dir) {
  fs.writeFileSync(path.join(dir, '.asa/nodes/architecture/ARCH-001.yaml'),
    stringifyAsaYaml({ id: 'ARCH-001', title: '核心模块 A', status: 'active', version: 1, description: '模块A描述' }));
  fs.writeFileSync(path.join(dir, '.asa/nodes/architecture/ARCH-002.yaml'),
    stringifyAsaYaml({ id: 'ARCH-002', title: '核心模块 B', status: 'active', version: 1, description: '模块B描述' }));
  fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'),
    `meta:\n  project: "test"\n  phase: "discovery"\n  schemaVersion: 3\n  compiledDocsExpectedDigest: "sha256:empty"\n  compiledDocsActualDigest: "sha256:empty"\nrisks: []\nrequirements: {}\narchitecture: {}\ntasks: {}\nedges:\n  - from: "ARCH-001"\n    to: "ARCH-002"\n    type: "extends"\n`);
}

describe('helper: narrative-sync 模板工具', () => {
  it('digestLine 输出带标签的 Nodes Digest 行', () => {
    assert.equal(digestLine('当前', 'sha256:abc'), 'Nodes Digest (当前): sha256:abc');
  });

  it('basedOnAnchor 输出标准锚点格式', () => {
    assert.equal(basedOnAnchor('sha256:abc'), '<!-- ASA-BASED-ON: sha256:abc -->');
  });

  it('NARRATIVE_SYNC_TEMPLATE 覆盖完整可复制步骤', () => {
    assert.match(NARRATIVE_SYNC_TEMPLATE, /update-overview/);
    assert.match(NARRATIVE_SYNC_TEMPLATE, /diagnose/);
    assert.match(NARRATIVE_SYNC_TEMPLATE, /write_file/);
    assert.match(NARRATIVE_SYNC_TEMPLATE, /ASA-BASED-ON/);
    assert.match(NARRATIVE_SYNC_TEMPLATE, /validate/);
  });
});

describe('update-overview：输出 Nodes Digest + 标准操作模板', () => {
  let dir;
  before(() => { dir = createSandbox(); seedReq(dir); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('打印当前 Nodes Digest（一次命令闭环，无需再跑 diagnose）', () => {
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const expected = calculateNodesDigest(dir);
      const out = capture(() => require('./overview.js').run());
      assert.match(out.all, new RegExp(`Nodes Digest \\(当前\\): ${expected}`));
      assert.match(out.all, /Nodes Digest \(当前\): sha256:[0-9a-f]{64}/);
    } finally { process.chdir(prev); }
  });

  it('输出标准操作模板（含锚点写法与 update-overview / validate 步骤）', () => {
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const out = capture(() => require('./overview.js').run());
      assert.match(out.all, /<!-- ASA-BASED-ON: sha256:[0-9a-f]{64} -->/);
      assert.ok(out.all.includes(NARRATIVE_SYNC_TEMPLATE), '应包含可复制操作模板');
    } finally { process.chdir(prev); }
  });
});

describe('update-overview 瘦身：需求/任务交给 01/03，只给架构/依赖/lessons/digest', () => {
  let dir;
  before(() => { dir = createSandbox(); seedReq(dir); seedArch(dir); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('输出架构组件（含描述摘要）、ARCH 依赖边与规模统计', () => {
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const out = capture(() => require('./overview.js').run());
      assert.match(out.all, /Architecture \(架构节点\): 2/);
      assert.match(out.all, /ARCH-001/);
      assert.match(out.all, /核心模块 A/);
      assert.match(out.all, /模块A描述/);          // 架构描述摘要
      assert.match(out.all, /ARCH-001 --\[extends\]--> ARCH-002/); // 依赖边
    } finally { process.chdir(prev); }
  });

  it('不再枚举每条需求/任务标题（指引读取 01/03 作为素材）', () => {
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const out = capture(() => require('./overview.js').run());
      assert.ok(!out.all.includes('Sample Requirement'), '需求标题不应再被枚举');
      assert.match(out.all, /01-requirements\.md/); // 指引读取需求素材
      assert.match(out.all, /03-tasks\.md/);        // 指引读取任务素材
    } finally { process.chdir(prev); }
  });
});

describe('doctor：过期告警内输出可复制操作模板（被动检出）', () => {
  let dir;
  before(() => { dir = createSandbox(); seedReq(dir); seedStaleDocs(dir); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('当 00/02 锚点过期时，告警文本包含完整操作模板', () => {
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const out = capture(() => require('./doctor.js').run());
      assert.match(out.all, /已过期/);
      assert.match(out.all, /update-overview/);
      assert.ok(out.all.includes(NARRATIVE_SYNC_TEMPLATE), 'doctor 应给出可复制的操作模板');
    } finally { process.chdir(prev); }
  });
});

describe('seedNarrativeDocs：首次自动播种占位 00/02', () => {
  let dir;
  before(() => { dir = createSandbox(); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('docs/ 缺失时创建 00-overview.md 与 02-architecture.md，并写入当前 digest 锚点', () => {
    const docs = path.join(dir, 'docs');
    const created = seedNarrativeDocs(docs, 'sha256:seed123', 'Demo');
    assert.deepEqual(created.sort(), ['00-overview.md', '02-architecture.md'].sort());
    for (const f of ['00-overview.md', '02-architecture.md']) {
      const content = fs.readFileSync(path.join(docs, f), 'utf-8');
      assert.match(content, /<!-- ASA-BASED-ON: sha256:seed123 -->/);
      assert.match(content, /# Demo/);
    }
  });

  it('已存在时不覆盖，只补缺失文件，原内容保留', () => {
    const docs = path.join(dir, 'docs2');
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(
      path.join(docs, '00-overview.md'),
      '<!-- ASA-BASED-ON: sha256:OLD -->\n# 自定义概览\n'
    );
    const created = seedNarrativeDocs(docs, 'sha256:NEW', 'Demo');
    assert.deepEqual(created, ['02-architecture.md']);
    const kept = fs.readFileSync(path.join(docs, '00-overview.md'), 'utf-8');
    assert.match(kept, /# 自定义概览/);      // 未被覆盖
    assert.match(kept, /sha256:OLD/);        // 锚点未被改动
  });
});

describe('validate：NARRATIVE_OUTDATED 告警内输出可复制操作模板（被动检出）', () => {
  let dir;
  before(() => { dir = createSandbox(); seedReq(dir); seedStaleDocs(dir); });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('当 00/02 锚点过期时，validate 告警包含操作模板', () => {
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const out = capture(() => require('./validate.js').run([]));
      assert.match(out.all, /NARRATIVE_OUTDATED/);
      assert.ok(out.all.includes(NARRATIVE_SYNC_TEMPLATE), 'validate 告警应包含可复制的操作模板');
    } finally { process.chdir(prev); }
  });
});

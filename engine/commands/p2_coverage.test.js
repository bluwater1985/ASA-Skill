const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createSandbox, run, readNode, readMatrix } = require('./helpers.js');
const { execFileSync } = require('child_process');
const { stringifyAsaYaml } = require('../lib/yaml.js');

describe('Stage 4 Coverage & Feature Hardening', () => {
  let dir;
  before(() => {
    dir = createSandbox();
    
    // 1. 初始化一个符合 Schema 3 规范的 matrix.yaml
    const matrix = {
      meta: {
        project: "test-coverage",
        phase: "discovery",
        schemaVersion: 3,
        engineVersion: "3.x",
        activeTask: "(none)"
      },
      requirements: {},
      architecture: {},
      tasks: {},
      edges: []
    };
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(matrix));

    // 2. 写入一个标准的 REQ-001 节点，支持 link-task 关联
    fs.mkdirSync(path.join(dir, '.asa/nodes/requirements'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.asa/nodes/requirements/REQ-001.yaml'), 'id: REQ-001\ntitle: "标准需求 REQ-001"\nstatus: proposed\nversion: 1\n');
  });
  
  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('runs doctor command successfully on a healthy project', () => {
    const r = run(dir, 'doctor');
    assert.equal(r.exitCode, 0);
    assert.match(r.output, /doctor|项目 Schema|一键项目诊断/);
  });

  it('runs update-overview command and prints status successfully', () => {
    const r = run(dir, 'update-overview');
    assert.equal(r.exitCode, 0);
    assert.match(r.output, /总览|Overview/i);
  });

  it('supports link-task and record-changes and validates standard fields', () => {
    // 1. 新增一个 TASK
    run(dir, 'add-task', ['测试覆盖率任务']);
    const task = readNode(dir, 'tasks', 'TASK-001');
    assert.equal(task.title, '测试覆盖率任务');

    // 2. 关联 REQ-001
    const rLink = run(dir, 'link-task', ['TASK-001', 'REQ-001']);
    assert.equal(rLink.exitCode, 0);
    const linkedTask = readNode(dir, 'tasks', 'TASK-001');
    assert.ok(linkedTask.linkedReqs.includes('REQ-001'));

    // 3. 记录变更文件
    const rRecord = run(dir, 'record-changes', ['TASK-001', 'src/math.js', 'src/util.js']);
    assert.equal(rRecord.exitCode, 0);
    const recordedTask = readNode(dir, 'tasks', 'TASK-001');
    assert.ok(recordedTask.changedFiles.includes('src/math.js'));
    assert.ok(recordedTask.changedFiles.includes('src/util.js'));
  });

  it('runs plan-tasks with and without REQ-ID filtering', () => {
    // Write edges
    const matrix = readMatrix(dir);
    matrix.edges = matrix.edges || [];
    matrix.edges.push({ from: 'REQ-001', to: 'TASK-001', type: 'depends' });
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(matrix));

    // 1. 无 REQ-ID 规划所有
    const rAll = run(dir, 'plan-tasks');
    assert.equal(rAll.exitCode, 0);
    assert.match(rAll.output, /任务拓扑编排/);

    // 2. 携带 REQ-ID 规划特定关联
    const rFiltered = run(dir, 'plan-tasks', ['REQ-001']);
    assert.equal(rFiltered.exitCode, 0);
    assert.match(rFiltered.output, /REQ-001/);
  });

  it('verifies validate --json output schema and exit code behavior', () => {
    // 1. 无错误绿态，validate 应该正常成功
    const rGreen = run(dir, 'validate', ['--json']);
    assert.equal(rGreen.exitCode, 0);
    const resGreen = JSON.parse(rGreen.output);
    assert.equal(resGreen.status, 'ok');
    assert.equal(resGreen.blockingErrors.length, 0);

    // 2. 注入一个孤儿任务作为警告
    run(dir, 'add-task', ['孤儿任务测试']);

    const rWarn = run(dir, 'validate', ['--json']);
    // 仅有 warnings 时，exitCode 应该仍为 0 正常放行！
    assert.equal(rWarn.exitCode, 0, 'Should exit 0 when only warnings are present');
    const resWarn = JSON.parse(rWarn.output);
    assert.equal(resWarn.status, 'ok', 'Should remain status ok even with warnings');
    assert.ok(resWarn.warnings.length > 0);
  });

  it('covers link-task and record-changes error branches', () => {
    // Missing arguments
    const rL1 = run(dir, 'link-task');
    assert.notEqual(rL1.exitCode, 0);

    const rR1 = run(dir, 'record-changes');
    assert.notEqual(rR1.exitCode, 0);

    // Non-existing task
    const rL2 = run(dir, 'link-task', ['TASK-GHOST', 'REQ-001']);
    assert.notEqual(rL2.exitCode, 0);

    const rR2 = run(dir, 'record-changes', ['TASK-GHOST', 'src/app.js']);
    assert.notEqual(rR2.exitCode, 0);

    // Non-existing req
    const rL3 = run(dir, 'link-task', ['TASK-001', 'REQ-GHOST']);
    assert.notEqual(rL3.exitCode, 0);
  });

  it('covers check-work-order Hook and validate-yaml Hook branches', () => {
    const beforeHook = path.join(dir, '.asa/hooks/check-work-order.js');
    const afterHook = path.join(dir, '.asa/hooks/validate-yaml.js');

    fs.mkdirSync(path.join(dir, '.asa/hooks'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.asa/lib'), { recursive: true });
    fs.copyFileSync(path.resolve('engine/hooks/check-work-order.js'), beforeHook);
    fs.copyFileSync(path.resolve('engine/hooks/validate-yaml.js'), afterHook);
    fs.copyFileSync(path.resolve('engine/version.js'), path.join(dir, '.asa/version.js'));
    fs.copyFileSync(path.resolve('engine/lib/yaml.js'), path.join(dir, '.asa/lib/yaml.js'));
    fs.copyFileSync(path.resolve('engine/lib/matrix.js'), path.join(dir, '.asa/lib/matrix.js'));

    const env = { ...process.env };
    delete env.ASA_INTERNAL_WRITE;

    // Validate YAML: missing title
    const badPath = path.join(dir, '.asa/nodes/requirements/REQ-BAD.yaml');
    fs.mkdirSync(path.dirname(badPath), { recursive: true });
    fs.writeFileSync(badPath, 'id: REQ-BAD\nstatus: proposed\n');

    let out1 = '';
    try {
      out1 = execFileSync(process.execPath, [afterHook], {
        cwd: dir,
        input: JSON.stringify({ arguments: { file_path: '.asa/nodes/requirements/REQ-BAD.yaml' } }),
        encoding: 'utf8',
        env
      });
    } catch (e) {
      out1 = e.stdout || '';
      console.log("EXEC ERROR 1:", e.message, "STDOUT:", e.stdout, "STDERR:", e.stderr);
    }
    const res1 = JSON.parse(out1);
    assert.equal(res1.decision, 'deny');

    // Validate YAML: invalid status
    fs.writeFileSync(badPath, 'id: REQ-BAD\ntitle: "Bad"\nstatus: bogus\n');
    let out2 = '';
    try {
      out2 = execFileSync(process.execPath, [afterHook], {
        cwd: dir,
        input: JSON.stringify({ arguments: { file_path: '.asa/nodes/requirements/REQ-BAD.yaml' } }),
        encoding: 'utf8',
        env
      });
    } catch (e) {
      out2 = e.stdout || '';
      console.log("EXEC ERROR 2:", e.message, "STDOUT:", e.stdout, "STDERR:", e.stderr);
    }
    const res2 = JSON.parse(out2);
    assert.equal(res2.decision, 'deny');

    // check-work-order: completed task block
    const matrix = readMatrix(dir);
    matrix.meta.phase = 'implementation';
    matrix.meta.activeTask = 'TASK-001';
    matrix.tasks['TASK-001'].status = 'completed';
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(matrix));

    fs.writeFileSync(path.join(dir, '.asa/nodes/tasks/TASK-001.yaml'), 'id: TASK-001\ntitle: "Completed task"\nstatus: completed\nlinkedReqs: []\nchangedFiles: []\n');

    let out3 = '';
    try {
      out3 = execFileSync(process.execPath, [beforeHook], {
        cwd: dir,
        input: JSON.stringify({ arguments: { file_path: 'src/app.js' } }),
        encoding: 'utf8',
        env
      });
    } catch (e) {
      out3 = e.stdout || '';
    }
    const res3 = JSON.parse(out3);
    assert.equal(res3.decision, 'deny');
    assert.match(res3.reason, /已完成|completed/);
  });

  it('covers cycle-detection in plan-tasks', () => {
    const matrix = readMatrix(dir);
    matrix.edges = matrix.edges || [];
    matrix.edges.push({ from: 'TASK-002', to: 'TASK-002', type: 'depends' });
    fs.writeFileSync(path.join(dir, '.asa/matrix.yaml'), stringifyAsaYaml(matrix));

    const r = run(dir, 'plan-tasks');
    assert.equal(r.exitCode, 0);
    assert.match(r.output, /循环依赖|环/);
  });
});

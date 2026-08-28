// engine/commands/p4_coverage_hardening.test.js — CLI 覆盖率硬核提升集成测试
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createSandbox, run, writeNode } = require('./helpers.js');

describe('Coverage Hardening - CLI Command Gaps', () => {
  let dir;
  before(() => {
    dir = createSandbox();
    // 注入基础节点以备测试
    run(dir, 'add-req', ['需求1']);
    run(dir, 'add-arch', ['架构1']);
    run(dir, 'add-task', ['任务1']);
  });

  after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  // ── list-req / list-arch / list-task ──
  describe('list command', () => {
    it('lists requirements correctly', () => {
      const r = run(dir, 'list-req');
      assert.equal(r.exitCode, 0);
      assert.match(r.output, /需求1/);
    });

    it('lists architectures correctly', () => {
      const r = run(dir, 'list-arch');
      assert.equal(r.exitCode, 0);
      assert.match(r.output, /架构1/);
    });

    it('lists tasks correctly', () => {
      const r = run(dir, 'list-task');
      assert.equal(r.exitCode, 0);
      assert.match(r.output, /任务1/);
    });

    it('handles empty lists gracefully', () => {
      const emptyDir = createSandbox();
      const r = run(emptyDir, 'list-req');
      assert.equal(r.exitCode, 0);
      assert.match(r.output, /列表为空/);
      try { fs.rmSync(emptyDir, { recursive: true, force: true }); } catch {}
    });

    it('rejects unknown list type', () => {
      const r = run(dir, 'list-banana');
      assert.notEqual(r.exitCode, 0);
      assert.match(r.output, /未知命令/);
    });
  });

  // ── search-req ──
  describe('search command', () => {
    it('searches requirements by similarity', () => {
      const r = run(dir, 'search-req', ['需求']);
      assert.equal(r.exitCode, 0);
      assert.match(r.output, /需求1/);
    });

    it('handles no similarity matches', () => {
      const r = run(dir, 'search-req', ['完全不相关的极长专有名词']);
      assert.equal(r.exitCode, 0);
      assert.match(r.output, /未找到相似的需求节点/);
    });

    it('rejects empty query', () => {
      const r = run(dir, 'search-req', []);
      assert.notEqual(r.exitCode, 0);
      assert.match(r.output, /检索词不能为空/);
    });
  });

  // ── link-task ──
  describe('link command', () => {
    it('rejects incomplete arguments', () => {
      const r = run(dir, 'link-task', []);
      assert.notEqual(r.exitCode, 0);
      assert.match(r.output, /用法/);
    });

    it('rejects mismatched node type format', () => {
      const r1 = run(dir, 'link-task', ['REQ-001', 'TASK-001']);
      assert.notEqual(r1.exitCode, 0);
      assert.match(r1.output, /不是 TASK 节点/);

      const r2 = run(dir, 'link-task', ['TASK-001', 'TASK-001']);
      assert.notEqual(r2.exitCode, 0);
      assert.match(r2.output, /不是 REQ 节点/);
    });

    it('rejects linking non-existent nodes', () => {
      const r1 = run(dir, 'link-task', ['TASK-999', 'REQ-001']);
      assert.notEqual(r1.exitCode, 0);
      assert.match(r1.output, /任务 TASK-999 不存在/);

      const r2 = run(dir, 'link-task', ['TASK-001', 'REQ-999']);
      assert.notEqual(r2.exitCode, 0);
      assert.match(r2.output, /需求 REQ-999 不存在/);
    });

    it('links nodes successfully and handles idempotency', () => {
      // 首次关联应该成功
      const r1 = run(dir, 'link-task', ['TASK-001', 'REQ-001']);
      assert.equal(r1.exitCode, 0);
      assert.match(r1.output, /任务关联成功/);

      // 重复关联应当幂等跳过
      const r2 = run(dir, 'link-task', ['TASK-001', 'REQ-001']);
      assert.equal(r2.exitCode, 0);
      assert.match(r2.output, /无需重复操作/);
    });

    it('rejects linking when task is cancelled', () => {
      writeNode(dir, 'tasks', 'TASK-002', {
        id: 'TASK-002', title: '取消任务', status: 'cancelled'
      });
      const r = run(dir, 'link-task', ['TASK-002', 'REQ-001']);
      assert.notEqual(r.exitCode, 0);
      assert.match(r.output, /处于 cancelled 状态/);
    });

    it('rejects linking when req is rejected or deprecated', () => {
      writeNode(dir, 'requirements', 'REQ-002', {
        id: 'REQ-002', title: '驳回需求', status: 'rejected', priority: 'P2'
      });
      const r = run(dir, 'link-task', ['TASK-001', 'REQ-002']);
      assert.notEqual(r.exitCode, 0);
      assert.match(r.output, /处于 rejected 状态/);
    });
  });

  // ── record-changes ──
  describe('record-changes command', () => {
    it('rejects incomplete arguments', () => {
      const r = run(dir, 'record-changes', []);
      assert.notEqual(r.exitCode, 0);
      assert.match(r.output, /用法/);
    });

    it('rejects non-TASK node as target', () => {
      const r = run(dir, 'record-changes', ['REQ-001', 'src/app.js']);
      assert.notEqual(r.exitCode, 0);
      assert.match(r.output, /不是 TASK 节点/);
    });

    it('rejects non-existent TASK', () => {
      const r = run(dir, 'record-changes', ['TASK-999', 'src/app.js']);
      assert.notEqual(r.exitCode, 0);
      assert.match(r.output, /任务 TASK-999 不存在/);
    });

    it('records file changes successfully and handles idempotency', () => {
      // 1. 成功记录
      const r1 = run(dir, 'record-changes', ['TASK-001', 'src/main.js', 'src\\app.js']);
      assert.equal(r1.exitCode, 0);
      assert.match(r1.output, /任务变更记录成功/);

      // 2. 幂等跳过
      const r2 = run(dir, 'record-changes', ['TASK-001', 'src/main.js', 'src/app.js']);
      assert.equal(r2.exitCode, 0);
      assert.match(r2.output, /无需重复记录/);
    });

    it('rejects recording when task status is completed', () => {
      writeNode(dir, 'tasks', 'TASK-003', {
        id: 'TASK-003', title: '已完成任务', status: 'completed'
      });
      const r = run(dir, 'record-changes', ['TASK-003', 'src/app.js']);
      assert.notEqual(r.exitCode, 0);
      assert.match(r.output, /处于 completed 状态/);
    });
  });

  // ── plan-tasks ──
  describe('plan-tasks command', () => {
    it('plans all tasks topologically', () => {
      const r = run(dir, 'plan-tasks');
      assert.equal(r.exitCode, 0);
      assert.match(r.output, /任务拓扑编排计划/);
    });

    it('rejects non-REQ filter argument', () => {
      const r = run(dir, 'plan-tasks', ['TASK-001']);
      assert.notEqual(r.exitCode, 0);
      assert.match(r.output, /不是 REQ 节点/);
    });

    it('rejects planning for non-existent REQ filter', () => {
      const r = run(dir, 'plan-tasks', ['REQ-999']);
      assert.notEqual(r.exitCode, 0);
      assert.match(r.output, /需求 REQ-999 不存在/);
    });

    it('plans topologically under specified REQ', () => {
      const r = run(dir, 'plan-tasks', ['REQ-001']);
      assert.equal(r.exitCode, 0);
      assert.match(r.output, /任务拓扑编排计划/);
    });
  });

  // ── doctor ──
  describe('doctor command', () => {
    it('runs doctor diagnosis successfully', () => {
      const r = run(dir, 'doctor');
      assert.equal(r.exitCode, 0);
      assert.match(r.output, /一键项目诊断报告/);
    });

    it('warns about missing md docs', () => {
      const noDocsDir = createSandbox();
      const r = run(noDocsDir, 'doctor');
      assert.equal(r.exitCode, 0);
      assert.match(r.output, /缺失叙事型文件/);
      try { fs.rmSync(noDocsDir, { recursive: true, force: true }); } catch {}
    });
  });

  // ── diagnose ──
  describe('diagnose command', () => {
    it('runs diagnose verification successfully', () => {
      const r = run(dir, 'diagnose');
      assert.equal(r.exitCode, 0);
      assert.match(r.output, /DIAGNOSE/);
    });
  });

  // ── update-overview ──
  describe('update-overview command', () => {
    it('runs update-overview successfully', () => {
      const r = run(dir, 'update-overview');
      assert.equal(r.exitCode, 0);
      assert.match(r.output, /项目总览摘要/);
    });

    it('loads lessons.yaml if exists', () => {
      fs.mkdirSync(path.join(dir, 'knowledge'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'knowledge/lessons.yaml'), 'lessons: []\n');
      const r = run(dir, 'update-overview');
      assert.equal(r.exitCode, 0);
      assert.match(r.output, /lessons.yaml/);
    });
  });

  // ── 终极分支爆破 (Branch Blasting) ──
  describe('Extreme Error Paths Branch Blasting', () => {
    it('covers status command missing args, non-existent node, missing --by', () => {
      assert.notEqual(run(dir, 'status', []).exitCode, 0);
      assert.notEqual(run(dir, 'status', ['TASK-001']).exitCode, 0);
      assert.notEqual(run(dir, 'status', ['TASK-001', 'completed']).exitCode, 0); // 缺 --by 拦截
      assert.notEqual(run(dir, 'status', ['GHOST-001', 'completed', '--by', '大鹏']).exitCode, 0); // 节点不存在
    });

    it('covers add-req similarity candidates, missing reason, missing by, and incorrect allow-similar ID', () => {
      const local = createSandbox();
      run(local, 'add-req', ['用户登录核心功能']); // 创建 REQ-001

      // 1. 相似度 >= 0.3 且 < 0.9 的检索 (覆盖 add.js:118-122 candidates 打印)
      const r1 = run(local, 'add-req', ['用户登录']); 
      assert.equal(r1.exitCode, 0);

      // 2. 相似度 >= 0.9 但不带 allow-similar 强拦截
      const r2 = run(local, 'add-req', ['用户登录核心功能']);
      assert.notEqual(r2.exitCode, 0);

      // 3. 带 allow-similar 但缺 by
      const r3 = run(local, 'add-req', ['用户登录核心功能', '--allow-similar', 'REQ-001']);
      assert.notEqual(r3.exitCode, 0);

      // 4. 带 allow-similar 和 by 但缺 reason
      const r4 = run(local, 'add-req', ['用户登录核心功能', '--allow-similar', 'REQ-001', '--by', '大鹏']);
      assert.notEqual(r4.exitCode, 0);

      // 5. 带不匹配的 allow-similar ID
      const r5 = run(local, 'add-req', ['用户登录核心功能', '--allow-similar', 'REQ-999', '--reason', '特批', '--by', '大鹏']);
      assert.notEqual(r5.exitCode, 0);

      // 6. 成功放行 (覆盖 add.js:140-154 豁免写入)
      const r6 = run(local, 'add-req', ['用户登录核心功能', '--allow-similar', 'REQ-001', '--reason', '特批', '--by', '大鹏']);
      assert.equal(r6.exitCode, 0);

      try { fs.rmSync(local, { recursive: true, force: true }); } catch {}
    });

    it('covers cancel/confirm/reject commands missing args, non-existent, missing --by', () => {
      assert.notEqual(run(dir, 'cancel-task', []).exitCode, 0);
      assert.notEqual(run(dir, 'cancel-task', ['TASK-001']).exitCode, 0); // 缺 --by
      assert.notEqual(run(dir, 'cancel-task', ['GHOST-001', '--by', '大鹏']).exitCode, 0);

      assert.notEqual(run(dir, 'confirm-task', []).exitCode, 0);
      assert.notEqual(run(dir, 'confirm-task', ['TASK-001']).exitCode, 0); // 缺 --by
      assert.notEqual(run(dir, 'confirm-task', ['GHOST-001', '--by', '大鹏']).exitCode, 0);

      assert.notEqual(run(dir, 'reject-task', []).exitCode, 0);
      assert.notEqual(run(dir, 'reject-task', ['TASK-001']).exitCode, 0); // 缺 --by
      assert.notEqual(run(dir, 'reject-task', ['GHOST-001', '--by', '大鹏']).exitCode, 0);
    });

    it('covers add commands empty titles', () => {
      assert.notEqual(run(dir, 'add-req', []).exitCode, 0);
      assert.notEqual(run(dir, 'add-arch', []).exitCode, 0);
      assert.notEqual(run(dir, 'add-task', []).exitCode, 0);
    });

    it('covers edge command error and unknown subcommands', () => {
      assert.notEqual(run(dir, 'edge', ['rm', 'REQ-001', 'TASK-999']).exitCode, 0);
      assert.notEqual(run(dir, 'edge', ['rm', 'TASK-999', 'REQ-001']).exitCode, 0);
      assert.notEqual(run(dir, 'edge', ['banana']).exitCode, 0);
    });

    it('covers reconcile --readonly and -r only-diagnose branches', () => {
      const r1 = run(dir, 'reconcile', ['--readonly']);
      assert.equal(r1.exitCode, 0);

      const r2 = run(dir, 'reconcile', ['-r']);
      assert.equal(r2.exitCode, 0);
    });

    it('covers history/impact/journal/traverse/set error branches', () => {
      assert.notEqual(run(dir, 'history', []).exitCode, 0);
      assert.notEqual(run(dir, 'impact', []).exitCode, 0);
      assert.notEqual(run(dir, 'traverse', []).exitCode, 0);
      assert.notEqual(run(dir, 'set', ['phase', 'bogus']).exitCode, 0);
      assert.notEqual(run(dir, 'set', []).exitCode, 0);
    });
  });
});
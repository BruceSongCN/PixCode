import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { installHostAdapter, listHostAdapters } from "../adapters/agents.mjs";
import { resolveOpenSpec, runOpenSpec } from "../adapters/openspec.mjs";
import {
  validateModelDocument,
  validateReviewDocument,
} from "../lib/artifact-validation.mjs";
import {
  finalizeCapabilityPublication,
  prepareCapabilityPublication,
  readPublicationMap,
  validateCapabilities,
} from "../lib/capabilities.mjs";
import { assertChangeId, exists, parseFlags } from "../lib/project.mjs";
import { listTargets, targetStatus } from "../lib/targets.mjs";

const testRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cliPath = path.join(testRoot, ".pixcode", "cli", "pixcode.mjs");

function runCli(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, PATH: "" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value) => {
      stdout += value;
    });
    child.stderr.on("data", (value) => {
      stderr += value;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("OpenSpec 必须解析为项目本地锁定版本", async () => {
  const engine = await resolveOpenSpec("1.6.0");
  assert.equal(engine.version, "1.6.0");
  assert.match(engine.packageRoot, /node_modules[\\/]@fission-ai[\\/]openspec$/);
});

test("清空 PATH 后仍可执行本地 OpenSpec", async () => {
  const result = await runOpenSpec(["--version"], {
    cwd: testRoot,
    expectedVersion: "1.6.0",
    env: { PATH: "" },
  });
  assert.equal(result.ok, true, result.stderr);
  assert.match(result.stdout, /1\.6\.0/);
});

test("Change 标识只接受小写 kebab-case", () => {
  assert.doesNotThrow(() => assertChangeId("warehouse-offline-inventory"));
  assert.throws(() => assertChangeId("CHANGE-001"));
  assert.throws(() => assertChangeId("中文变更"));
  assert.throws(() => assertChangeId("../outside"));
});

test("命令参数同时解析位置参数与标志", () => {
  assert.deepEqual(parseFlags(["demo-change", "--json", "--agent", "codex"]), {
    positional: ["demo-change"],
    flags: { json: true, agent: "codex" },
  });
});

test("工作区清单声明普通独立仓库而不要求 Git submodule", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixcode-targets-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, ".pixcode"), { recursive: true });
  await writeFile(
    path.join(root, ".pixcode", "workspace.yaml"),
    `schema_version: 1
name: Demo
targets:
  backend:
    path: src/backend
    repository: https://example.com/backend.git
    branch: main
`,
    "utf8",
  );

  assert.deepEqual(await listTargets(root), [
    {
      id: "backend",
      path: "src/backend",
      repository: "https://example.com/backend.git",
      branch: "main",
    },
  ]);
  const status = await targetStatus(root);
  assert.equal(status[0].state, "missing");
});

test("模型字段校验接受逐字段标准矩阵", () => {
  const result = validateModelDocument(`
## 适用性

适用。

## 模型变化

| 类型 | 名称 | 变化 | 所属 Target |
| --- | --- | --- | --- |
| 实体 | \`DemoEntity\` | 新增 | \`backend\` |

## 实体字段定义

### \`DemoEntity\`（示例实体）

| 字段 | 类型 | 空值 | 默认长度 | 中文含义/XML 字段说明 | 来源/规则 |
| --- | --- | --- | --- | --- | --- |
| \`Id\` | \`Guid\` | 否 | - | 示例实体主键 | 系统生成 |
`);
  assert.equal(result.ok, true, result.errors.join("；"));
});

test("模型字段校验拒绝字段组合", () => {
  const result = validateModelDocument(`
## 适用性

适用。

## 模型变化

| 类型 | 名称 | 变化 | 所属 Target |
| --- | --- | --- | --- |
| 实体 | \`DemoEntity\` | 新增 | \`backend\` |

## 实体字段定义

### \`DemoEntity\`（示例实体）

| 字段 | 类型 | 空值 | 默认长度 | 中文含义/XML 字段说明 | 来源/规则 |
| --- | --- | --- | --- | --- | --- |
| \`Code/Name\` | \`string\` | 否 | 64 | 编码和名称 | 用户输入 |
`);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("；"), /一行一个代码标识/);
});

test("模型字段校验拒绝缺失的实体字段章节", () => {
  const result = validateModelDocument(`
## 适用性

适用。

## 模型变化

| 类型 | 名称 | 变化 | 所属 Target |
| --- | --- | --- | --- |
| 实体 | \`DemoEntity\` | 新增 | \`backend\` |
`);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("；"), /缺少“实体字段定义”章节/);
});

test("设计评审只有真实通过且无未关闭阻断问题时才允许交付", () => {
  assert.equal(
    validateReviewDocument("| 评审状态 | 待评审 |\n").ok,
    false,
  );
  assert.equal(
    validateReviewDocument(`
| 评审状态 | 通过 |

| 编号 | 级别 | 问题 | 决定 | 责任人 | 状态 |
| --- | --- | --- | --- | --- | --- |
| R-001 | 阻断 | 并发策略缺失 | 补充设计 | 后端 | 待处理 |
`).ok,
    false,
  );
  assert.equal(
    validateReviewDocument("| 评审状态 | 有条件通过 |\n\n## 条件与遗留项\n\n无。\n").ok,
    true,
  );
});

test("Agent 适配可安装和刷新受管理 Skill", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixcode-adapter-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, ".pixcode"), { recursive: true });
  await mkdir(path.join(root, ".pixcode", "skills"), { recursive: true });
  const sourceSkills = path.join(testRoot, ".pixcode", "skills");
  const { cp } = await import("node:fs/promises");
  await cp(sourceSkills, path.join(root, ".pixcode", "skills"), { recursive: true });

  const installed = await installHostAdapter(root, "codex", "0.1.0");
  assert.equal(installed.installed.length, 2);
  const markerPath = path.join(
    root,
    ".codex",
    "skills",
    "pixcode-workflow",
    ".pixcode-managed.json",
  );
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  assert.equal(marker.managedBy, "PixCode");

  const states = await listHostAdapters(root);
  assert.equal(states.find((state) => state.host === "codex").managed.length, 2);
  await installHostAdapter(root, "codex", "0.1.0");
});

test("Agent 适配不覆盖未受管理的同名 Skill", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixcode-unmanaged-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const { cp } = await import("node:fs/promises");
  await mkdir(path.join(root, ".pixcode"), { recursive: true });
  await cp(path.join(testRoot, ".pixcode", "skills"), path.join(root, ".pixcode", "skills"), {
    recursive: true,
  });
  const unmanaged = path.join(root, ".codex", "skills", "pixcode-workflow");
  await mkdir(unmanaged, { recursive: true });
  await writeFile(path.join(unmanaged, "SKILL.md"), "user-owned\n", "utf8");

  await assert.rejects(
    () => installHostAdapter(root, "codex", "0.1.0"),
    /不受 PixCode 管理/,
  );
  assert.equal(await readFile(path.join(unmanaged, "SKILL.md"), "utf8"), "user-owned\n");
  assert.equal(
    await exists(path.join(root, ".codex", "skills", "pixcode-verify-delivery")),
    false,
  );
});

test("CLI 可在新工作区创建并查询 Change", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixcode-change-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const { cp } = await import("node:fs/promises");
  await mkdir(path.join(root, ".pixcode"), { recursive: true });
  await writeFile(
    path.join(root, ".pixcode", "workspace.yaml"),
    "schema_version: 1\nname: Test\ntargets: {}\n",
    "utf8",
  );
  await cp(
    path.join(testRoot, ".pixcode", "pixcode.json"),
    path.join(root, ".pixcode", "pixcode.json"),
  );
  await mkdir(path.join(root, "openspec", "schemas"), { recursive: true });
  await cp(
    path.join(testRoot, ".pixcode", "scaffolds", "openspec", "config.yaml"),
    path.join(root, "openspec", "config.yaml"),
  );
  await cp(
    path.join(
      testRoot,
      ".pixcode",
      "scaffolds",
      "openspec",
      "schemas",
      "pixcode-delivery",
    ),
    path.join(root, "openspec", "schemas", "pixcode-delivery"),
    { recursive: true },
  );

  const created = await runCli(["change", "create", "demo-feature", "--json"], root);
  assert.equal(created.code, 0, created.stderr || created.stdout);
  assert.equal(
    await exists(path.join(root, "openspec", "changes", "demo-feature", ".openspec.yaml")),
    true,
  );

  const status = await runCli(["status", "demo-feature", "--json"], root);
  assert.equal(status.code, 0, status.stderr || status.stdout);
  const statusJson = JSON.parse(status.stdout);
  assert.equal(statusJson.changeName, "demo-feature");
  assert.equal(Object.hasOwn(statusJson.artifactPaths, "design"), true);
  assert.equal(Object.hasOwn(statusJson.artifactPaths, "test-plan"), true);
  assert.equal(Object.hasOwn(statusJson.artifactPaths, "review"), true);
  assert.equal(Object.hasOwn(statusJson.artifactPaths, "model"), false);
  assert.equal(Object.hasOwn(statusJson.artifactPaths, "acceptance"), false);
});

test("pixcode init 从框架脚手架生成 OpenSpec 项目目录并保留项目配置", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixcode-init-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const { cp } = await import("node:fs/promises");
  await mkdir(path.join(root, ".pixcode"), { recursive: true });
  await writeFile(
    path.join(root, ".pixcode", "workspace.yaml"),
    "schema_version: 1\nname: Test\ntargets: {}\n",
    "utf8",
  );
  await cp(
    path.join(testRoot, ".pixcode", "pixcode.json"),
    path.join(root, ".pixcode", "pixcode.json"),
  );
  await cp(
    path.join(testRoot, ".pixcode", "skills"),
    path.join(root, ".pixcode", "skills"),
    { recursive: true },
  );
  await cp(
    path.join(testRoot, ".pixcode", "scaffolds"),
    path.join(root, ".pixcode", "scaffolds"),
    { recursive: true },
  );
  await cp(
    path.join(testRoot, ".pixcode", "templates"),
    path.join(root, ".pixcode", "templates"),
    { recursive: true },
  );
  await mkdir(path.join(root, "src"), { recursive: true });

  const initialized = await runCli(["init", "--agent", "none", "--json"], root);
  assert.equal(initialized.code, 0, initialized.stderr || initialized.stdout);
  assert.equal(await exists(path.join(root, "openspec", "config.yaml")), true);
  assert.equal(
    await exists(
      path.join(
        root,
        "openspec",
        "schemas",
        "pixcode-delivery",
        ".pixcode-managed.json",
      ),
    ),
    true,
  );

  const configPath = path.join(root, "openspec", "config.yaml");
  const projectConfig = `${await readFile(configPath, "utf8")}\n# 项目自定义配置保留\n`;
  await writeFile(configPath, projectConfig, "utf8");
  const initializedAgain = await runCli(["init", "--agent", "none", "--json"], root);
  assert.equal(initializedAgain.code, 0, initializedAgain.stderr || initializedAgain.stdout);
  assert.equal(await readFile(configPath, "utf8"), projectConfig);
});

test("当前态功能资产支持多级中文路径并保留 OpenSpec 映射", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixcode-capability-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const { cp } = await import("node:fs/promises");
  const config = {
    publication: {
      root: "pix-specs",
      template: "capability-baseline",
      templateVersion: 1,
    },
  };
  await mkdir(path.join(root, ".pixcode", "templates"), { recursive: true });
  await cp(
    path.join(testRoot, ".pixcode", "templates", "capability-baseline"),
    path.join(root, ".pixcode", "templates", "capability-baseline"),
    { recursive: true },
  );
  const archiveName = "2026-07-27-supply-general-approval";
  const archive = path.join(root, "openspec", "changes", "archive", archiveName);
  await mkdir(path.join(archive, "artifacts"), { recursive: true });
  await mkdir(
    path.join(root, "openspec", "specs", "supply-general-approval"),
    { recursive: true },
  );
  await writeFile(
    path.join(root, "openspec", "specs", "supply-general-approval", "spec.md"),
    "# 当前需求\n",
    "utf8",
  );
  await writeFile(
    path.join(archive, "pixcode.yaml"),
    `schema_version: 1
capabilities:
  - id: supply-general-approval
    name: 通用审核
    action: create
    publication_path: [供应管理, 审核管理, 通用审核]
    assets: [requirements, solution, process, model, contracts, interaction, test-strategy, quality]
`,
    "utf8",
  );

  const prepared = await prepareCapabilityPublication(root, config, archiveName);
  assert.equal(prepared.plans[0].created.length, 9);
  const capabilityDirectory = path.join(
    root,
    "pix-specs",
    "供应管理",
    "审核管理",
    "通用审核",
  );
  for (const fileName of prepared.plans[0].created) {
    const filePath = path.join(capabilityDirectory, fileName);
    const content = await readFile(filePath, "utf8");
    await writeFile(
      filePath,
      `${content
        .replaceAll("PIXCODE:TODO", "已完成")
        .replaceAll("{{entity_name}}", "DemoEntity")
        .replaceAll("{{entity_display_name}}", "示例实体")}

最近更新 Change：\`supply-general-approval\`
`,
      "utf8",
    );
  }
  const finalized = await finalizeCapabilityPublication(root, config, archiveName);
  assert.equal(finalized.finalized[0].revision, 1);
  const replayed = await finalizeCapabilityPublication(root, config, archiveName);
  assert.equal(replayed.finalized[0].revision, 1);
  assert.equal(
    await exists(path.join(capabilityDirectory, "capability.yaml")),
    true,
  );
  assert.equal(
    await exists(path.join(root, "pix-specs", "供应管理", "README.md")),
    true,
  );
  const validation = await validateCapabilities(root, config);
  assert.equal(validation.ok, true, validation.errors.join("；"));
});

test("功能资产发布映射拒绝路径穿越", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixcode-map-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(
    path.join(root, "pixcode.yaml"),
    `schema_version: 1
capabilities:
  - id: unsafe-capability
    name: 非法目录
    action: create
    publication_path: [供应管理, ..]
    assets: [requirements]
`,
    "utf8",
  );
  await assert.rejects(
    () => readPublicationMap(root, new Set(["requirements"])),
    /不安全的功能资产目录名/,
  );
});

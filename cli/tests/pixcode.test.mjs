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
  validateVerificationDocument,
} from "../lib/artifact-validation.mjs";
import {
  finalizeCapabilityPublication,
  prepareCapabilityPublication,
  readPublicationMap,
  validateCapabilities,
} from "../lib/capabilities.mjs";
import {
  assertChangeId,
  exists,
  parseFlags,
  readWorkspaceConfig,
} from "../lib/project.mjs";
import {
  installOpenSpecScaffold,
  scaffoldMatchesRuntime,
} from "../lib/scaffold.mjs";
import { bootstrapTargets, listTargets, targetStatus } from "../lib/targets.mjs";

const testRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cliPath = path.join(testRoot, "cli", "pixcode.mjs");

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
  assert.equal(
    path.relative(path.join(testRoot, "node_modules"), engine.packageRoot).startsWith(".."),
    false,
  );
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
  assert.deepEqual(parseFlags(["--all", "--json"]), {
    positional: [],
    flags: { all: true, json: true },
  });
  assert.throws(() => parseFlags(["--force"]), /未知参数/);
});

test("CLI 拒绝把合法标志用于错误命令", async () => {
  const result = await runCli(["doctor", "--all", "--json"], testRoot);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /doctor 不支持参数：--all/);
});

test("workspace init 可从空目录生成最小工作区", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixcode-workspace-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const initialized = await runCli(
    ["workspace", "init", "--name", "Demo Workspace", "--json"],
    root,
  );
  assert.equal(initialized.code, 0, initialized.stderr || initialized.stdout);
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.workspace.name, "Demo Workspace");
  assert.deepEqual(manifest.targets, {});
  assert.equal(await exists(path.join(root, "src")), true);
  assert.match(await readFile(path.join(root, ".gitignore"), "utf8"), /\/src\/\*\//);
  const packageManifest = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  assert.equal(packageManifest.scripts.pixcode, "node .pixcode/cli/pixcode.mjs");

  const repeated = await runCli(
    ["workspace", "init", "--name", "Ignored", "--json"],
    root,
  );
  assert.equal(repeated.code, 0, repeated.stderr || repeated.stdout);
  assert.equal(
    JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")).workspace.name,
    "Demo Workspace",
  );
});

test("工作区清单严格拒绝未知字段", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixcode-manifest-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(
    path.join(root, "manifest.json"),
    '{"schemaVersion":1,"workspace":{"name":"Demo"},"targets":{},"typo":true}\n',
    "utf8",
  );
  await assert.rejects(() => readWorkspaceConfig(root), /不允许字段 typo/);
});

test("工作区清单声明普通独立仓库而不要求 Git submodule", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixcode-targets-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(
    path.join(root, "manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        workspace: { name: "Demo" },
        targets: {
          backend: {
            path: "src/backend",
            repository: "https://example.com/backend.git",
            defaultBranch: "main",
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  assert.deepEqual(await listTargets(root), [
    {
      id: "backend",
      path: "src/backend",
      repository: "https://example.com/backend.git",
      expectedBranch: "main",
    },
  ]);
  const status = await targetStatus(root);
  assert.equal(status[0].state, "missing");
});

test("多个 Target 不得映射到同一目录", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixcode-target-path-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(
    path.join(root, "manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      workspace: { name: "Demo" },
      targets: {
        backend: {
          path: "src/shared",
          repository: "https://example.com/backend.git",
        },
        "frontend-web": {
          path: "src/shared",
          repository: "https://example.com/frontend.git",
        },
      },
    })}\n`,
    "utf8",
  );
  await assert.rejects(() => listTargets(root), /不能使用同一目录/);
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
    false,
  );
  assert.equal(
    validateReviewDocument(
      "| 评审状态 | 有条件通过 |\n\n## 条件与遗留项\n\n上线前由后端负责人关闭 R-002。\n",
    ).ok,
    true,
  );
  assert.equal(
    validateReviewDocument(
      "| 评审状态 | 通过 |\n| 流程与状态 | `design.md` | 待评审 | |\n",
    ).ok,
    false,
  );
});

test("交付验证必须给出正向结论且不存在未执行项", () => {
  assert.equal(
    validateVerificationDocument(
      "| 验证状态 | 待执行 |\n| 交付决定 | 待验收 |\n",
    ).ok,
    false,
  );
  assert.equal(
    validateVerificationDocument(
      "| 验证状态 | 通过 / 失败 / 未执行 |\n| 交付决定 | 通过 / 不通过 |\n",
    ).ok,
    false,
  );
  assert.equal(
    validateVerificationDocument(
      "| 验证状态 | 通过 |\n| 交付决定 | 通过 |\n",
    ).ok,
    true,
  );
  assert.equal(
    validateVerificationDocument(
      "| 验证状态 | 有条件通过 |\n| 交付决定 | 有条件通过 |\n\n## 失败、未执行与遗留风险\n\n无。\n",
    ).ok,
    false,
  );
  assert.equal(
    validateVerificationDocument(
      "| 验证状态 | 通过 |\n| 交付决定 | 通过 |\n| API | 未执行（环境不可用） | evidence |\n",
    ).ok,
    false,
  );
});

test("Agent 适配可安装和刷新受管理 Skill", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixcode-adapter-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
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
  const codex = states.find((state) => state.host === "codex");
  assert.equal(codex.managed.length, 2);
  assert.equal(codex.managed.every((skill) => skill.state === "current"), true);
  await writeFile(
    path.join(root, ".codex", "skills", "pixcode-workflow", "SKILL.md"),
    "tampered\n",
    "utf8",
  );
  const stale = await listHostAdapters(root);
  assert.equal(
    stale
      .find((state) => state.host === "codex")
      .managed.find((skill) => skill.skill === "pixcode-workflow").state,
    "stale",
  );
  await installHostAdapter(root, "codex", "0.1.0");
  await rm(
    path.join(root, ".codex", "skills", "pixcode-verify-delivery"),
    { recursive: true },
  );
  const missing = await listHostAdapters(root);
  assert.equal(
    missing
      .find((state) => state.host === "codex")
      .managed.find((skill) => skill.skill === "pixcode-verify-delivery").state,
    "missing-install",
  );
});

test("Agent 适配不覆盖未受管理的同名 Skill", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixcode-unmanaged-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
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
  await writeFile(
    path.join(root, "manifest.json"),
    "{\"schemaVersion\":1,\"workspace\":{\"name\":\"Test\"},\"targets\":{}}\n",
    "utf8",
  );
  await mkdir(path.join(root, "openspec", "schemas"), { recursive: true });
  await cp(
    path.join(testRoot, "scaffolds", "openspec", "config.yaml"),
    path.join(root, "openspec", "config.yaml"),
  );
  await cp(
    path.join(
      testRoot,
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
  await writeFile(
    path.join(root, "manifest.json"),
    "{\"schemaVersion\":1,\"workspace\":{\"name\":\"Test\"},\"targets\":{}}\n",
    "utf8",
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
  await writeFile(
    path.join(
      root,
      "openspec",
      "schemas",
      "pixcode-delivery",
      "rogue.txt",
    ),
    "unexpected\n",
    "utf8",
  );
  const config = JSON.parse(await readFile(path.join(testRoot, "pixcode.json"), "utf8"));
  assert.equal(await scaffoldMatchesRuntime(root, config), false);
  const initializedAgain = await runCli(["init", "--agent", "none", "--json"], root);
  assert.equal(initializedAgain.code, 0, initializedAgain.stderr || initializedAgain.stdout);
  assert.equal(await readFile(configPath, "utf8"), projectConfig);
  assert.equal(await scaffoldMatchesRuntime(root, config), true);
  const initializedThird = await runCli(["init", "--agent", "none", "--json"], root);
  assert.equal(initializedThird.code, 0, initializedThird.stderr || initializedThird.stdout);
  assert.equal(JSON.parse(initializedThird.stdout).scaffold.schema.refreshed, false);
});

test("pixcode init 不覆盖同名但未受管理的 Schema", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixcode-schema-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const config = JSON.parse(await readFile(path.join(testRoot, "pixcode.json"), "utf8"));
  const target = path.join(
    root,
    "openspec",
    "schemas",
    config.defaultSchema,
  );
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "schema.yaml"), "user-owned: true\n", "utf8");

  await assert.rejects(
    () => installOpenSpecScaffold(root, config),
    /不受 PixCode 管理/,
  );
  assert.equal(await readFile(path.join(target, "schema.yaml"), "utf8"), "user-owned: true\n");
});

test("Target bootstrap 拒绝接管已存在的错误目录", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixcode-bootstrap-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(
    path.join(root, "manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      workspace: { name: "Demo" },
      targets: {
        backend: {
          path: "src/backend",
          repository: "https://example.com/backend.git",
          defaultBranch: "main",
        },
      },
    })}\n`,
    "utf8",
  );
  await mkdir(path.join(root, "src", "backend"), { recursive: true });
  await assert.rejects(
    () => bootstrapTargets(root),
    /不会接管或覆盖/,
  );
});

test("当前态功能资产支持多级中文路径并保留 OpenSpec 映射", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pixcode-capability-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const config = {
    publication: {
      root: "pix-specs",
      template: "capability-baseline",
      templateVersion: 1,
    },
  };
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

  const secondArchiveName = "2026-08-01-move-supply-general-approval";
  const secondArchive = path.join(
    root,
    "openspec",
    "changes",
    "archive",
    secondArchiveName,
  );
  await mkdir(secondArchive, { recursive: true });
  await writeFile(
    path.join(secondArchive, "pixcode.yaml"),
    `schema_version: 1
capabilities:
  - id: supply-general-approval
    name: 通用审核
    action: update
    publication_path: [物资管理系统, 通用审核]
    assets: [requirements]
`,
    "utf8",
  );
  const relocation = await prepareCapabilityPublication(
    root,
    config,
    secondArchiveName,
  );
  const relocatedDirectory = path.join(root, "pix-specs", "物资管理系统", "通用审核");
  assert.equal(relocation.plans[0].relocationPending, true);
  assert.equal(relocation.plans[0].directory, capabilityDirectory);
  assert.equal(await exists(capabilityDirectory), true);
  assert.equal(await exists(relocatedDirectory), false);
  for (const fileName of ["README.md", "010-需求基线.md"]) {
    const filePath = path.join(capabilityDirectory, fileName);
    await writeFile(
      filePath,
      `${await readFile(filePath, "utf8")}\n最近更新 Change：\`move-supply-general-approval\`\n`,
      "utf8",
    );
  }
  const moved = await finalizeCapabilityPublication(root, config, secondArchiveName);
  assert.equal(moved.finalized[0].revision, 2);
  assert.equal(await exists(capabilityDirectory), false);
  assert.equal(await exists(relocatedDirectory), true);
  assert.equal(await exists(path.join(root, "pix-specs", "供应管理")), false);

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

#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installHostAdapter, listHostAdapters, refreshHostAdapters } from "./adapters/agents.mjs";
import { parseOpenSpecJson, runOpenSpec } from "./adapters/openspec.mjs";
import { doctor, validateSkills } from "./lib/checks.mjs";
import {
  validateModelArtifacts,
  validateReviewDocument,
} from "./lib/artifact-validation.mjs";
import {
  finalizeCapabilityPublication,
  prepareCapabilityPublication,
  rebuildCapabilityIndexes,
  validateCapabilities,
  validateCapabilityPublicationMap,
} from "./lib/capabilities.mjs";
import { installOpenSpecScaffold } from "./lib/scaffold.mjs";
import {
  assertChangeId,
  exists,
  findProjectRoot,
  parseFlags,
  readPixCodeConfig,
} from "./lib/project.mjs";

const HELP = `PixCode 轻量 AI 工程驱动器

用法：
  pixcode init [--agent codex|claude|opencode|none]
  pixcode doctor [--json]
  pixcode validate [change|--all] [--json]
  pixcode change create <change-id> [--json]
  pixcode status [change] [--json]
  pixcode archive <change> [--yes] [--json]
  pixcode capabilities prepare <archive> [--json]
  pixcode capabilities finalize <archive> [--json]
  pixcode capabilities reindex [--json]
  pixcode capabilities validate [--json]
  pixcode adapters install <codex|claude|opencode>
  pixcode adapters refresh
  pixcode adapters list [--json]

通过 npm 执行：npm run --silent pixcode -- <命令>`;

function output(value, json = false) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
  } else if (typeof value === "string") {
    if (value) console.log(value);
  } else {
    console.log(JSON.stringify(value, null, 2));
  }
}

function emitOpenSpec(result, json) {
  if (json) {
    if (result.stdout) {
      try {
        output(JSON.parse(result.stdout), true);
      } catch {
        output({ ok: result.ok, stdout: result.stdout, stderr: result.stderr }, true);
      }
    } else {
      output({ ok: result.ok, stderr: result.stderr }, true);
    }
  } else {
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
  }
  if (!result.ok) process.exitCode = result.code;
}

async function validate(root, config, positional, flags) {
  const skillChecks = await validateSkills(root);
  const schema = await runOpenSpec(["schema", "validate", config.defaultSchema], {
    cwd: root,
    expectedVersion: config.engine.version,
  });
  const target = positional[0];
  if (target) assertChangeId(target);
  const modelChecks = await validateModelArtifacts(root, config, target);
  const validationArgs = target ? ["validate", target, "--strict"] : ["validate", "--all", "--strict"];
  const changes = await runOpenSpec(validationArgs, {
    cwd: root,
    expectedVersion: config.engine.version,
  });
  const capabilities = await validateCapabilities(root, config);
  const result = {
    ok:
      skillChecks.every((check) => check.ok) &&
      modelChecks.every((check) => check.ok) &&
      capabilities.ok &&
      schema.ok &&
      changes.ok,
    skills: skillChecks,
    models: modelChecks,
    capabilities,
    schema: { ok: schema.ok, stdout: schema.stdout, stderr: schema.stderr },
    changes: { ok: changes.ok, stdout: changes.stdout, stderr: changes.stderr },
  };
  if (flags.json) {
    output(result, true);
  } else {
    for (const check of skillChecks) {
      console.log(`${check.ok ? "✓" : "✗"} Skill ${check.item}: ${check.detail}`);
    }
    for (const check of modelChecks) {
      console.log(
        `${check.ok ? "✓" : "✗"} 模型字段 ${check.change}: ${
          check.ok ? "有效" : check.errors.join("；")
        }`,
      );
    }
    console.log(
      `${capabilities.ok ? "✓" : "✗"} 当前态功能资产: ${capabilities.count} 个 Capability${
        capabilities.errors.length ? `；${capabilities.errors.join("；")}` : ""
      }`,
    );
    emitOpenSpec(schema, false);
    emitOpenSpec(changes, false);
  }
  if (!result.ok) process.exitCode = 1;
}

async function init(root, config, flags) {
  const scaffold = await installOpenSpecScaffold(root, config);
  if (flags.agent && flags.agent !== "none") {
    await installHostAdapter(root, flags.agent, config.frameworkVersion);
  }
  const report = await doctor(root, config);
  const schema = await runOpenSpec(["schema", "validate", config.defaultSchema], {
    cwd: root,
    expectedVersion: config.engine.version,
  });
  const result = {
    ...report,
    ok: report.ok && schema.ok,
    scaffold,
    schema: { ok: schema.ok, stdout: schema.stdout, stderr: schema.stderr },
  };
  output(result, Boolean(flags.json));
  if (!result.ok) process.exitCode = 1;
}

async function archive(root, config, change, flags) {
  assertChangeId(change);
  const statusResult = await runOpenSpec(["status", "--change", change, "--json"], {
    cwd: root,
    expectedVersion: config.engine.version,
  });
  const status = parseOpenSpecJson(statusResult);
  const changeDirectory = path.join(root, "openspec", "changes", change);
  const publicationMap = await validateCapabilityPublicationMap(
    root,
    config,
    changeDirectory,
  );
  const tasksPath = status.artifactPaths?.tasks?.existingOutputPaths?.[0];
  const reviewPath = status.artifactPaths?.review?.existingOutputPaths?.[0];
  const verificationPath = status.artifactPaths?.verification?.existingOutputPaths?.[0];
  const blockers = [];
  if (!tasksPath) {
    blockers.push("当前 Schema 定义的 tasks 资产尚未生成");
  } else {
    const tasks = await readFile(tasksPath, "utf8");
    const pending = tasks.match(/^- \[ \]/gm)?.length ?? 0;
      if (pending > 0) blockers.push(`仍有 ${pending} 项任务未完成`);
  }
  if (!reviewPath) {
    blockers.push("当前 Schema 定义的 review 资产尚未生成");
  } else {
    blockers.push(
      ...validateReviewDocument(await readFile(reviewPath, "utf8")).errors,
    );
  }
  if (!verificationPath) {
    blockers.push("当前 Schema 定义的 verification 资产尚未生成");
  } else if (/结论[\s\S]{0,80}不通过/.test(await readFile(verificationPath, "utf8"))) {
    blockers.push("verification 资产的结论为不通过");
  }
  if (blockers.length && !flags.yes) {
    throw new Error(`归档前检查未通过：${blockers.join("；")}。确认例外时显式传入 --yes。`);
  }

  const validation = await runOpenSpec(["validate", change, "--strict"], {
    cwd: root,
    expectedVersion: config.engine.version,
  });
  if (!validation.ok) {
    throw new Error(validation.stderr || validation.stdout || "严格校验失败。");
  }
  const archived = await runOpenSpec(["archive", change, "--yes", "--json"], {
    cwd: root,
    expectedVersion: config.engine.version,
  });
  const archiveResult = parseOpenSpecJson(archived);
  let publication;
  try {
    publication = await prepareCapabilityPublication(root, config, archiveResult.archivedAs);
  } catch (error) {
    throw new Error(
      `OpenSpec 已归档为 ${archiveResult.archivedAs}，但 pix-specs 发布准备失败：${error.message}。修复后执行 pixcode capabilities prepare ${archiveResult.archivedAs}。`,
    );
  }
  const result = {
    ...archiveResult,
    publication: {
      status: "pending-agent-merge",
      archiveMapping: publication.mapping,
      capabilities: publicationMap.capabilities,
      plans: publication.plans,
      next: `pixcode capabilities finalize ${archiveResult.archivedAs}`,
    },
  };
  if (flags.json) {
    output(result, true);
  } else {
    console.log(`Change '${change}' 已由 OpenSpec 归档为 '${archiveResult.archivedAs}'。`);
    console.log(`已准备 ${publication.plans.length} 个 pix-specs 功能资产合并计划。`);
    for (const plan of publication.plans) {
      console.log(`- ${plan.name}（${plan.id}）：${plan.directory}`);
    }
    console.log("请由 Agent 合并当前完整结论，然后执行：");
    console.log(`npm run --silent pixcode -- capabilities finalize ${archiveResult.archivedAs}`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || ["help", "--help", "-h"].includes(argv[0])) {
    console.log(HELP);
    return;
  }
  if (["version", "--version", "-v"].includes(argv[0])) {
    const root = await findProjectRoot();
    const config = await readPixCodeConfig(root);
    console.log(`PixCode ${config.frameworkVersion}`);
    return;
  }

  const root = await findProjectRoot();
  const config = await readPixCodeConfig(root);
  const command = argv[0];
  const { positional, flags } = parseFlags(argv.slice(1));

  if (command === "doctor") {
    const report = await doctor(root, config);
    if (flags.json) output(report, true);
    else {
      for (const check of report.checks) {
        console.log(`${check.ok ? "✓" : "✗"} ${check.item}: ${check.detail}`);
      }
    }
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (command === "validate") {
    await validate(root, config, positional, flags);
    return;
  }
  if (command === "init") {
    await init(root, config, flags);
    return;
  }
  if (command === "status") {
    const change = positional[0];
    if (change) assertChangeId(change);
    const args = change ? ["status", "--change", change] : ["list"];
    if (flags.json) args.push("--json");
    emitOpenSpec(
      await runOpenSpec(args, { cwd: root, expectedVersion: config.engine.version }),
      Boolean(flags.json),
    );
    return;
  }
  if (command === "change" && positional[0] === "create") {
    const change = positional[1];
    assertChangeId(change);
    if (await exists(path.join(root, "openspec", "changes", change))) {
      throw new Error(`Change 已存在：${change}`);
    }
    const args = ["new", "change", change, "--schema", config.defaultSchema];
    if (flags.json) args.push("--json");
    emitOpenSpec(
      await runOpenSpec(args, { cwd: root, expectedVersion: config.engine.version }),
      Boolean(flags.json),
    );
    return;
  }
  if (command === "archive") {
    await archive(root, config, positional[0], flags);
    return;
  }
  if (command === "capabilities") {
    const action = positional[0];
    if (action === "prepare") {
      output(
        await prepareCapabilityPublication(root, config, positional[1]),
        Boolean(flags.json),
      );
      return;
    }
    if (action === "finalize") {
      output(
        await finalizeCapabilityPublication(root, config, positional[1]),
        Boolean(flags.json),
      );
      return;
    }
    if (["reindex", "rebuild"].includes(action)) {
      output(
        { ok: true, indexes: await rebuildCapabilityIndexes(root, config) },
        Boolean(flags.json),
      );
      return;
    }
    if (action === "validate") {
      const result = await validateCapabilities(root, config);
      output(result, Boolean(flags.json));
      if (!result.ok) process.exitCode = 1;
      return;
    }
  }
  if (command === "adapters") {
    const action = positional[0];
    if (action === "install") {
      output(
        await installHostAdapter(root, positional[1], config.frameworkVersion),
        Boolean(flags.json),
      );
      return;
    }
    if (action === "refresh") {
      output(await refreshHostAdapters(root, config.frameworkVersion), Boolean(flags.json));
      return;
    }
    if (action === "list") {
      output(await listHostAdapters(root), Boolean(flags.json));
      return;
    }
  }
  throw new Error(`未知命令：${argv.join(" ")}\n\n${HELP}`);
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch((error) => {
    const json = process.argv.includes("--json");
    if (json) console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    else console.error(`PixCode 错误：${error.message}`);
    process.exitCode = 1;
  });
}

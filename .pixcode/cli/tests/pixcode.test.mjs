import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { installHostAdapter, listHostAdapters } from "../adapters/agents.mjs";
import { resolveOpenSpec, runOpenSpec } from "../adapters/openspec.mjs";
import { assertChangeId, exists, parseFlags } from "../lib/project.mjs";

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
  await cp(
    path.join(testRoot, ".pixcode", "pixcode.json"),
    path.join(root, ".pixcode", "pixcode.json"),
  );
  await mkdir(path.join(root, "openspec", "schemas"), { recursive: true });
  await cp(
    path.join(testRoot, "openspec", "config.yaml"),
    path.join(root, "openspec", "config.yaml"),
  );
  await cp(
    path.join(testRoot, "openspec", "schemas", "pixcode-delivery"),
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
  assert.equal(JSON.parse(status.stdout).changeName, "demo-feature");
});

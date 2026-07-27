import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { exists } from "../lib/project.mjs";
import { frameworkAssetsRoot } from "../lib/runtime.mjs";

export const HOSTS = {
  codex: ".codex",
  claude: ".claude",
  opencode: ".opencode",
};

const MARKER = ".pixcode-managed.json";

async function listFiles(folder, prefix = "") {
  const entries = await readdir(folder, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = path.join(prefix, entry.name);
    const absolute = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolute, relative)));
    } else {
      files.push(relative);
    }
  }
  return files;
}

async function sourceHash(folder) {
  const hash = createHash("sha256");
  for (const relative of await listFiles(folder)) {
    hash.update(relative.replaceAll("\\", "/"));
    hash.update(await readFile(path.join(folder, relative)));
  }
  return hash.digest("hex");
}

function assertManagedTarget(root, host, target) {
  const parent = path.resolve(root, HOSTS[host], "skills");
  const resolved = path.resolve(target);
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith("pixcode-")) {
    throw new Error(`拒绝修改非 PixCode 适配目录：${resolved}`);
  }
}

export async function installHostAdapter(root, host, frameworkVersion) {
  if (!HOSTS[host]) {
    throw new Error(`不支持的 Agent 宿主：${host}。可选值：${Object.keys(HOSTS).join("、")}。`);
  }

  const sourceRoot = path.join(frameworkAssetsRoot, "skills");
  const sourceSkills = (await readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("pixcode-"))
    .map((entry) => entry.name);
  const installed = [];

  for (const skillName of sourceSkills) {
    const target = path.join(root, HOSTS[host], "skills", skillName);
    assertManagedTarget(root, host, target);
    if ((await exists(target)) && !(await exists(path.join(target, MARKER)))) {
      throw new Error(`目标已存在且不受 PixCode 管理，未覆盖：${target}`);
    }
  }

  for (const skillName of sourceSkills) {
    const source = path.join(sourceRoot, skillName);
    const target = path.join(root, HOSTS[host], "skills", skillName);
    assertManagedTarget(root, host, target);
    if (await exists(target)) {
      await rm(target, { recursive: true, force: false });
    }
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: true });
    const marker = {
      managedBy: "PixCode",
      frameworkVersion,
      source: `PixCode:${path.relative(frameworkAssetsRoot, source).split(path.sep).join("/")}`,
      sourceHash: await sourceHash(source),
    };
    await writeFile(path.join(target, MARKER), `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    installed.push({ skill: skillName, target });
  }
  return { host, installed };
}

export async function listHostAdapters(root) {
  const result = [];
  for (const [host, directory] of Object.entries(HOSTS)) {
    const skillRoot = path.join(root, directory, "skills");
    const managed = [];
    if (await exists(skillRoot)) {
      for (const entry of await readdir(skillRoot, { withFileTypes: true })) {
        if (
          entry.isDirectory() &&
          entry.name.startsWith("pixcode-") &&
          (await exists(path.join(skillRoot, entry.name, MARKER)))
        ) {
          const marker = JSON.parse(await readFile(path.join(skillRoot, entry.name, MARKER), "utf8"));
          managed.push({ skill: entry.name, sourceHash: marker.sourceHash });
        }
      }
    }
    result.push({
      host,
      hostDirectoryExists: await exists(path.join(root, directory)),
      managed,
    });
  }
  return result;
}

export async function refreshHostAdapters(root, frameworkVersion) {
  const states = await listHostAdapters(root);
  const targets = states
    .filter((state) => state.hostDirectoryExists || state.managed.length > 0)
    .map((state) => state.host);
  const refreshed = [];
  for (const host of targets) {
    refreshed.push(await installHostAdapter(root, host, frameworkVersion));
  }
  return refreshed;
}

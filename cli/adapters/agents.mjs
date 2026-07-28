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
const HOST_MARKER = ".pixcode-adapter.json";

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

async function sourceHash(folder, ignoredFiles = new Set()) {
  const hash = createHash("sha256");
  for (const relative of await listFiles(folder)) {
    if (ignoredFiles.has(relative.replaceAll("\\", "/"))) continue;
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
  const skillRoot = path.join(root, HOSTS[host], "skills");
  await writeFile(
    path.join(skillRoot, HOST_MARKER),
    `${JSON.stringify(
      {
        managedBy: "PixCode",
        frameworkVersion,
        skills: sourceSkills,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { host, installed };
}

export async function listHostAdapters(root) {
  const sourceRoot = path.join(frameworkAssetsRoot, "skills");
  const result = [];
  for (const [host, directory] of Object.entries(HOSTS)) {
    const skillRoot = path.join(root, directory, "skills");
    const managed = [];
    let expectedSkills = [];
    const hostMarkerPath = path.join(skillRoot, HOST_MARKER);
    if (await exists(hostMarkerPath)) {
      try {
        const hostMarker = JSON.parse(await readFile(hostMarkerPath, "utf8"));
        if (hostMarker.managedBy !== "PixCode" || !Array.isArray(hostMarker.skills)) {
          throw new Error("invalid marker");
        }
        expectedSkills = hostMarker.skills;
      } catch {
        managed.push({ skill: "<adapter>", state: "invalid-marker" });
      }
    }
    if (await exists(skillRoot)) {
      for (const entry of await readdir(skillRoot, { withFileTypes: true })) {
        if (
          entry.isDirectory() &&
          entry.name.startsWith("pixcode-") &&
          (await exists(path.join(skillRoot, entry.name, MARKER)))
        ) {
          const installedDirectory = path.join(skillRoot, entry.name);
          const markerPath = path.join(installedDirectory, MARKER);
          let marker;
          try {
            marker = JSON.parse(await readFile(markerPath, "utf8"));
          } catch {
            managed.push({ skill: entry.name, state: "invalid-marker" });
            continue;
          }
          const sourceDirectory = path.join(sourceRoot, entry.name);
          const currentSourceHash = (await exists(sourceDirectory))
            ? await sourceHash(sourceDirectory)
            : null;
          const installedHash = await sourceHash(
            installedDirectory,
            new Set([MARKER]),
          );
          const state =
            marker.managedBy === "PixCode" &&
            marker.sourceHash &&
            marker.sourceHash === currentSourceHash &&
            marker.sourceHash === installedHash
              ? "current"
              : currentSourceHash
                ? "stale"
                : "missing-source";
          managed.push({
            skill: entry.name,
            state,
            sourceHash: marker.sourceHash,
            currentSourceHash,
            installedHash,
          });
        }
      }
    }
    const installedNames = new Set(managed.map((skill) => skill.skill));
    for (const skill of expectedSkills) {
      if (!installedNames.has(skill)) {
        managed.push({ skill, state: "missing-install" });
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

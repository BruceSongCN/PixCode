import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { exists, readWorkspaceConfig } from "./project.mjs";

function runGit(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) =>
      resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() }),
    );
  });
}

function normalizeTargets(root, workspace) {
  return Object.entries(workspace.targets ?? {}).map(([id, target]) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new Error(`Target 标识必须是小写 kebab-case：${id}`);
    }
    if (!target || typeof target !== "object") {
      throw new Error(`Target ${id} 配置无效。`);
    }
    const relative = target.path;
    if (!relative || path.isAbsolute(relative)) {
      throw new Error(`Target ${id} 的 path 必须是项目内相对路径。`);
    }
    const directory = path.resolve(root, relative);
    const relativeToRoot = path.relative(root, directory);
    if (
      !relativeToRoot ||
      relativeToRoot.startsWith("..") ||
      path.isAbsolute(relativeToRoot)
    ) {
      throw new Error(`Target ${id} 的 path 越出工作区：${relative}`);
    }
    if (!target.repository) {
      throw new Error(`Target ${id} 缺少 repository。`);
    }
    return {
      id,
      path: relative.split(path.sep).join("/"),
      directory,
      repository: target.repository,
      branch: target.branch ?? null,
    };
  });
}

export async function listTargets(root) {
  return normalizeTargets(root, await readWorkspaceConfig(root)).map(
    ({ directory: _directory, ...target }) => target,
  );
}

export async function targetStatus(root) {
  const targets = normalizeTargets(root, await readWorkspaceConfig(root));
  const result = [];
  for (const target of targets) {
    if (!(await exists(target.directory))) {
      result.push({ ...target, state: "missing", origin: null, branch: null, dirty: null });
      continue;
    }
    if (!(await exists(path.join(target.directory, ".git")))) {
      result.push({ ...target, state: "not-a-repository", origin: null, branch: null, dirty: null });
      continue;
    }
    const [origin, branch, changes] = await Promise.all([
      runGit(["remote", "get-url", "origin"], { cwd: target.directory }),
      runGit(["branch", "--show-current"], { cwd: target.directory }),
      runGit(["status", "--porcelain"], { cwd: target.directory }),
    ]);
    result.push({
      ...target,
      state: origin.ok ? "ready" : "invalid",
      origin: origin.ok ? origin.stdout : null,
      branch: branch.ok ? branch.stdout : null,
      dirty: changes.ok ? Boolean(changes.stdout) : null,
      repositoryMatches:
        origin.ok &&
        origin.stdout.replace(/\.git$/i, "").toLowerCase() ===
          target.repository.replace(/\.git$/i, "").toLowerCase(),
    });
  }
  return result.map(({ directory: _directory, ...target }) => target);
}

export async function bootstrapTargets(root) {
  const targets = normalizeTargets(root, await readWorkspaceConfig(root));
  await mkdir(path.join(root, "src"), { recursive: true });
  const result = [];
  for (const target of targets) {
    if (await exists(target.directory)) {
      result.push({ id: target.id, path: target.path, action: "preserved" });
      continue;
    }
    await mkdir(path.dirname(target.directory), { recursive: true });
    const args = ["clone"];
    if (target.branch) args.push("--branch", target.branch);
    args.push(target.repository, target.directory);
    const clone = await runGit(args, { cwd: root });
    if (!clone.ok) {
      throw new Error(`拉取 Target ${target.id} 失败：${clone.stderr || clone.stdout}`);
    }
    result.push({ id: target.id, path: target.path, action: "cloned" });
  }
  return result;
}

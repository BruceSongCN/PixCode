import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { exists, readWorkspaceConfig } from "./project.mjs";

function runGit(args, options = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
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
    child.once("error", (error) =>
      finish({ ok: false, code: 1, stdout: stdout.trim(), stderr: error.message }),
    );
    child.once("close", (code) =>
      finish({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() }),
    );
    timer = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        code: 1,
        stdout: stdout.trim(),
        stderr: `Git 命令超时：git ${args.join(" ")}`,
      });
    }, options.timeoutMs ?? 30_000);
  });
}

function normalizeTargets(root, workspace) {
  const directories = new Map();
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
    const normalizedDirectory = directory.toLocaleLowerCase("en-US");
    if (directories.has(normalizedDirectory)) {
      throw new Error(
        `Target ${id} 与 ${directories.get(normalizedDirectory)} 不能使用同一目录：${relative}`,
      );
    }
    directories.set(normalizedDirectory, id);
    return {
      id,
      path: relative.split(path.sep).join("/"),
      directory,
      repository: target.repository,
      expectedBranch: target.defaultBranch ?? null,
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
    const repositoryMatches =
      origin.ok &&
      origin.stdout.replace(/\.git$/i, "").toLowerCase() ===
        target.repository.replace(/\.git$/i, "").toLowerCase();
    const branchMatches =
      branch.ok && (!target.expectedBranch || branch.stdout === target.expectedBranch);
    const state =
      !origin.ok || !repositoryMatches
        ? "mismatch"
        : !branch.ok || !changes.ok
          ? "git-error"
          : !branchMatches
            ? "branch-mismatch"
            : "ready";
    result.push({
      ...target,
      state,
      origin: origin.ok ? origin.stdout : null,
      branch: branch.ok ? branch.stdout : null,
      dirty: changes.ok ? Boolean(changes.stdout) : null,
      repositoryMatches,
      branchMatches,
    });
  }
  return result.map(({ directory: _directory, ...target }) => target);
}

export async function bootstrapTargets(root) {
  const targets = normalizeTargets(root, await readWorkspaceConfig(root));
  const states = new Map((await targetStatus(root)).map((target) => [target.id, target]));
  await mkdir(path.join(root, "src"), { recursive: true });
  const result = [];
  for (const target of targets) {
    const state = states.get(target.id);
    if (state?.state === "ready") {
      result.push({ id: target.id, path: target.path, action: "preserved" });
      continue;
    }
    if (state?.state && state.state !== "missing") {
      throw new Error(
        `Target ${target.id} 已存在但与 Manifest 不一致（状态：${state.state}，origin：${
          state.origin ?? "无"
        }）。请人工处理，PixCode 不会接管或覆盖。`,
      );
    }
    await mkdir(path.dirname(target.directory), { recursive: true });
    const args = ["clone"];
    if (target.expectedBranch) args.push("--branch", target.expectedBranch);
    args.push(target.repository, target.directory);
    const clone = await runGit(args, { cwd: root, timeoutMs: 10 * 60_000 });
    if (!clone.ok) {
      throw new Error(`拉取 Target ${target.id} 失败：${clone.stderr || clone.stdout}`);
    }
    result.push({ id: target.id, path: target.path, action: "cloned" });
  }
  return result;
}

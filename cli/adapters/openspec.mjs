import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { frameworkRepositoryRoot } from "../lib/runtime.mjs";

const require = createRequire(import.meta.url);

export async function resolveOpenSpec(expectedVersion) {
  let entry;
  try {
    entry = require.resolve("@fission-ai/openspec");
  } catch {
    throw new Error("未安装 PixCode 锁定的 OpenSpec。请执行 npm ci --prefix .pixcode。");
  }

  const packageRoot = path.resolve(path.dirname(entry), "..");
  const dependencyRoot = path.join(frameworkRepositoryRoot, "node_modules");
  const relativeDependency = path.relative(dependencyRoot, packageRoot);
  if (
    !relativeDependency ||
    relativeDependency.startsWith("..") ||
    path.isAbsolute(relativeDependency)
  ) {
    throw new Error(
      `OpenSpec 未从 PixCode 自有依赖目录解析：${packageRoot}。请执行 npm ci --prefix .pixcode。`,
    );
  }
  const packageJsonPath = path.join(packageRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  if (expectedVersion && packageJson.version !== expectedVersion) {
    throw new Error(
      `OpenSpec 版本不匹配：期望 ${expectedVersion}，实际 ${packageJson.version}。请执行 npm ci --prefix .pixcode。`,
    );
  }

  return {
    entry,
    packageRoot,
    packageJsonPath,
    version: packageJson.version,
    bin: path.join(packageRoot, "bin", "openspec.js"),
  };
}

export async function runOpenSpec(args, options = {}) {
  const engine = await resolveOpenSpec(options.expectedVersion);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [engine.bin, ...args], {
      cwd: options.cwd ?? process.cwd(),
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        OPENSPEC_TELEMETRY: "0",
        ...(options.env ?? {}),
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        ok: code === 0,
        code: code ?? 1,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        command: [process.execPath, engine.bin, ...args],
        engine,
      });
    });
  });
}

export function parseOpenSpecJson(result) {
  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || "OpenSpec 命令执行失败。");
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`OpenSpec 未返回有效 JSON：${result.stdout || result.stderr}`);
  }
}

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { frameworkAssetsRoot } from "./runtime.mjs";

export async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function findProjectRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (
      (await exists(path.join(current, "manifest.json"))) ||
      (await exists(path.join(current, "pixcode.json")))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        "未找到 manifest.json；请在 PixCode 工作区内执行，或先创建工作区清单。",
      );
    }
    current = parent;
  }
}

export async function readPixCodeConfig() {
  const filePath = path.join(frameworkAssetsRoot, "pixcode.json");
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function readWorkspaceConfig(root) {
  const filePath = path.join(root, "manifest.json");
  if (!(await exists(filePath))) {
    return {
      schemaVersion: 1,
      workspace: { name: path.basename(root) },
      targets: {},
    };
  }
  const config = JSON.parse(await readFile(filePath, "utf8"));
  if (config.schemaVersion !== 1) {
    throw new Error(`不支持的 manifest.json schemaVersion：${config.schemaVersion}`);
  }
  if (!config.targets || typeof config.targets !== "object" || Array.isArray(config.targets)) {
    config.targets = {};
  }
  return config;
}

export function assertChangeId(changeId) {
  if (!changeId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(changeId)) {
    throw new Error("Change 标识必须是小写 kebab-case，例如 supply-general-approval。");
  }
}

export function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    if (["agent"].includes(key)) {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`--${key} 需要一个值。`);
      }
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { positional, flags };
}

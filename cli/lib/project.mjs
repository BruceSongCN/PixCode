import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { frameworkAssetsRoot } from "./runtime.mjs";
import { validateWorkspaceManifest } from "./manifest.mjs";

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
  let config;
  try {
    config = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`manifest.json 不是有效 JSON：${error.message}`);
  }
  const validation = await validateWorkspaceManifest(config);
  if (!validation.ok) {
    throw new Error(`manifest.json 校验失败：${validation.errors.join("；")}`);
  }
  return config;
}

async function ensureWorkspacePackage(root) {
  const packagePath = path.join(root, "package.json");
  if (await exists(packagePath)) {
    return { path: packagePath, created: false };
  }
  const packageManifest = {
    name: "pixcode-workspace",
    private: true,
    type: "module",
    scripts: {
      pixcode: "node .pixcode/cli/pixcode.mjs",
      "pixcode:init": "npm run --silent pixcode -- init --agent codex",
      "targets:bootstrap": "npm run --silent pixcode -- targets bootstrap",
      "targets:status": "npm run --silent pixcode -- targets status",
    },
  };
  await writeFile(
    packagePath,
    `${JSON.stringify(packageManifest, null, 2)}\n`,
    "utf8",
  );
  return { path: packagePath, created: true };
}

export async function ensureWorkspaceGitignore(root) {
  const gitignorePath = path.join(root, ".gitignore");
  if (await exists(gitignorePath)) {
    const content = await readFile(gitignorePath, "utf8");
    const localConfigRule = "/workspace.local.json";
    if (content.split(/\r?\n/).includes(localConfigRule)) {
      return { path: gitignorePath, created: false, updated: false };
    }
    const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    await writeFile(
      gitignorePath,
      `${content}${separator}
# PixCode 个人执行与调试配置，不进入共享仓库。
${localConfigRule}
`,
      "utf8",
    );
    return { path: gitignorePath, created: false, updated: true };
  }
  const content = `# PixCode Target 是普通独立仓库，不进入工作区仓库。
/src/*/

# PixCode 依赖由 .pixcode 子模块持有。
/node_modules/

# PixCode 个人执行与调试配置，不进入共享仓库。
/workspace.local.json

# Agent 宿主适配是可刷新副本。
/.codex/skills/pixcode-*/
/.claude/skills/pixcode-*/
/.opencode/skills/pixcode-*/
/.codex/skills/.pixcode-adapter.json
/.claude/skills/.pixcode-adapter.json
/.opencode/skills/.pixcode-adapter.json

# 运行产物。
**/__pycache__/
*.py[cod]
*.log
.DS_Store
Thumbs.db
`;
  await writeFile(gitignorePath, content, "utf8");
  return { path: gitignorePath, created: true, updated: false };
}

export async function initializeWorkspace(root, name) {
  const filePath = path.join(root, "manifest.json");
  if (await exists(filePath)) {
    const manifest = await readWorkspaceConfig(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    return {
      created: false,
      path: filePath,
      manifest,
      package: await ensureWorkspacePackage(root),
      gitignore: await ensureWorkspaceGitignore(root),
    };
  }
  const workspaceName = name?.trim();
  if (!workspaceName) {
    throw new Error("初始化工作区必须通过 --name 指定稳定名称。");
  }
  const manifest = {
    $schema: "./.pixcode/schemas/workspace-manifest.schema.json",
    schemaVersion: 1,
    workspace: { name: workspaceName },
    targets: {},
  };
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await mkdir(path.join(root, "src"), { recursive: true });
  return {
    created: true,
    path: filePath,
    manifest,
    package: await ensureWorkspacePackage(root),
    gitignore: await ensureWorkspaceGitignore(root),
  };
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
    if (["agent", "name", "mode"].includes(key)) {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`--${key} 需要一个值。`);
      }
      flags[key] = next;
      index += 1;
    } else if (["json", "all"].includes(key)) {
      flags[key] = true;
    } else {
      throw new Error(`未知参数：--${key}`);
    }
  }
  return { positional, flags };
}

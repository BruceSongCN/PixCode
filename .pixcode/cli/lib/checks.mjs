import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { exists } from "./project.mjs";
import { resolveOpenSpec, runOpenSpec } from "../adapters/openspec.mjs";
import { listHostAdapters } from "../adapters/agents.mjs";
import { scaffoldMatchesRuntime } from "./scaffold.mjs";
import { frameworkAssetsRoot } from "./runtime.mjs";

function nodeVersionAtLeast(current, minimum) {
  const left = current.replace(/^v/, "").split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) > (right[index] ?? 0)) return true;
    if ((left[index] ?? 0) < (right[index] ?? 0)) return false;
  }
  return true;
}

export async function validateSkills(root) {
  const skillsRoot = path.join(frameworkAssetsRoot, "skills");
  const findings = [];
  if (!(await exists(skillsRoot))) {
    return [{ ok: false, item: "skills", detail: `缺少 ${skillsRoot}` }];
  }
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const skillFile = path.join(skillsRoot, entry.name, "SKILL.md");
    if (!(await exists(skillFile))) {
      findings.push({ ok: false, item: entry.name, detail: "缺少 SKILL.md" });
      continue;
    }
    const content = await readFile(skillFile, "utf8");
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const name = frontmatter?.[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = frontmatter?.[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
    const extraKeys = (frontmatter?.[1].match(/^[a-zA-Z][\w-]*:/gm) ?? [])
      .map((value) => value.slice(0, -1))
      .filter((value) => !["name", "description"].includes(value));
    findings.push({
      ok: Boolean(frontmatter && name === entry.name && description && extraKeys.length === 0),
      item: entry.name,
      detail:
        name !== entry.name
          ? `name 应为 ${entry.name}`
          : !description
            ? "缺少 description"
            : extraKeys.length
              ? `frontmatter 包含多余字段：${extraKeys.join(", ")}`
              : "有效",
    });
  }
  return findings;
}

export async function doctor(root, config) {
  const checks = [];
  checks.push({
    ok: nodeVersionAtLeast(process.version, "20.20.0"),
    item: "Node.js",
    detail: `${process.version}（最低 20.20.0）`,
  });

  try {
    const engine = await resolveOpenSpec(config.engine.version);
    checks.push({
      ok: true,
      item: "OpenSpec 本地依赖",
      detail: `${engine.version} @ ${engine.packageRoot}`,
    });
    const version = await runOpenSpec(["--version"], {
      cwd: root,
      expectedVersion: config.engine.version,
    });
    checks.push({
      ok: version.ok && version.stdout.includes(config.engine.version),
      item: "OpenSpec 本地执行",
      detail: version.ok ? version.stdout : version.stderr,
    });
  } catch (error) {
    checks.push({ ok: false, item: "OpenSpec 本地依赖", detail: error.message });
  }

  for (const [item, absolute, detail] of [
    ["PixCode 配置", path.join(frameworkAssetsRoot, "pixcode.json"), "PixCode runtime"],
    [
      "OpenSpec 初始化脚手架",
      path.join(frameworkAssetsRoot, "scaffolds", "openspec", "config.yaml"),
      "PixCode runtime",
    ],
    [
      "工作区配置",
      path.join(root, ".pixcode", "workspace.yaml"),
      ".pixcode/workspace.yaml",
    ],
    ["OpenSpec 配置", path.join(root, "openspec", "config.yaml"), "openspec/config.yaml"],
    [
      "默认 Schema",
      path.join(root, "openspec", "schemas", config.defaultSchema, "schema.yaml"),
      `openspec/schemas/${config.defaultSchema}/schema.yaml`,
    ],
    [
      "当前态归档模板",
      path.join(
        frameworkAssetsRoot,
        "templates",
        config.publication?.template ?? "capability-baseline",
        "template.json",
      ),
      "PixCode runtime",
    ],
    ["Target 根目录", path.join(root, "src"), "src"],
  ]) {
    checks.push({ ok: await exists(absolute), item, detail });
  }
  checks.push({
    ok: await scaffoldMatchesRuntime(root, config),
    item: "OpenSpec Schema 同步",
    detail: `openspec/schemas/${config.defaultSchema} 与 PixCode 脚手架一致`,
  });

  checks.push(...(await validateSkills(root)).map((check) => ({ ...check, item: `Skill ${check.item}` })));
  const adapters = await listHostAdapters(root);
  checks.push({
    ok: true,
    item: "Agent 适配",
    detail:
      adapters
        .filter((adapter) => adapter.managed.length)
        .map((adapter) => `${adapter.host}:${adapter.managed.length}`)
        .join("，") || "尚未安装（可选）",
  });

  return { ok: checks.every((check) => check.ok), checks, adapters };
}

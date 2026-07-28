import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { exists } from "./project.mjs";
import { frameworkAssetsRoot } from "./runtime.mjs";

export async function installOpenSpecScaffold(root, config) {
  const source = path.join(frameworkAssetsRoot, "scaffolds", "openspec");
  const sourceConfig = path.join(source, "config.yaml");
  const sourceSchema = path.join(
    source,
    "schemas",
    config.defaultSchema,
  );
  if (!(await exists(sourceConfig)) || !(await exists(path.join(sourceSchema, "schema.yaml")))) {
    throw new Error(`PixCode OpenSpec 初始化脚手架不完整：${source}`);
  }

  const target = path.join(root, "openspec");
  const targetConfig = path.join(target, "config.yaml");
  const targetSchema = path.join(target, "schemas", config.defaultSchema);
  await mkdir(target, { recursive: true });

  const created = [];
  const refreshed = [];
  if (!(await exists(targetConfig))) {
    await cp(sourceConfig, targetConfig);
    created.push(path.relative(root, targetConfig));
  }

  const existingMarker = path.join(targetSchema, ".pixcode-managed.json");
  let schemaRefreshed = false;
  if (await exists(targetSchema)) {
    if (!(await exists(existingMarker))) {
      throw new Error(
        `默认 Schema 已存在但不受 PixCode 管理，拒绝覆盖：${targetSchema}。请先人工迁移或移走该目录。`,
      );
    }
    const marker = JSON.parse(await readFile(existingMarker, "utf8"));
    if (marker.managedBy !== "PixCode") {
      throw new Error(`拒绝刷新不受 PixCode 管理的 Schema：${targetSchema}`);
    }
    if (!(await scaffoldMatchesRuntime(root, config))) {
      await rm(targetSchema, { recursive: true });
      schemaRefreshed = true;
    }
  } else {
    schemaRefreshed = true;
  }

  const markerPath = path.join(targetSchema, ".pixcode-managed.json");
  if (schemaRefreshed) {
    await mkdir(path.dirname(targetSchema), { recursive: true });
    await cp(sourceSchema, targetSchema, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
    await writeFile(
      markerPath,
      `${JSON.stringify(
        {
          managedBy: "PixCode",
          frameworkVersion: config.frameworkVersion,
          source: `PixCode:${path.relative(frameworkAssetsRoot, sourceSchema)
            .split(path.sep)
            .join("/")}`,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    refreshed.push(path.relative(root, targetSchema));
  }

  return {
    source,
    target,
    config: {
      path: targetConfig,
      created: created.includes(path.relative(root, targetConfig)),
      preserved: await exists(targetConfig),
    },
    schema: {
      path: targetSchema,
      refreshed: schemaRefreshed,
      marker: markerPath,
    },
    created,
    refreshed,
  };
}

export async function scaffoldMatchesRuntime(root, config) {
  const sourceSchema = path.join(
    frameworkAssetsRoot,
    "scaffolds",
    "openspec",
    "schemas",
    config.defaultSchema,
  );
  const targetSchema = path.join(
    root,
    "openspec",
    "schemas",
    config.defaultSchema,
  );
  if (!(await exists(sourceSchema)) || !(await exists(targetSchema))) return false;
  const markerPath = path.join(targetSchema, ".pixcode-managed.json");
  if (!(await exists(markerPath))) return false;
  try {
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    if (
      marker.managedBy !== "PixCode" ||
      marker.frameworkVersion !== config.frameworkVersion
    ) {
      return false;
    }
  } catch {
    return false;
  }
  async function compare(source, target, rootLevel = false) {
    const sourceEntries = await readdir(source, { withFileTypes: true });
    const targetEntries = (await readdir(target, { withFileTypes: true })).filter(
      (entry) => !(rootLevel && entry.name === ".pixcode-managed.json"),
    );
    const sourceNames = sourceEntries
      .map((entry) => `${entry.isDirectory() ? "d" : "f"}:${entry.name}`)
      .sort();
    const targetNames = targetEntries
      .map((entry) => `${entry.isDirectory() ? "d" : "f"}:${entry.name}`)
      .sort();
    if (JSON.stringify(sourceNames) !== JSON.stringify(targetNames)) return false;
    for (const entry of sourceEntries) {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);
      if (entry.isDirectory()) {
        if (!(await compare(sourcePath, targetPath, false))) return false;
      } else if ((await readFile(sourcePath, "utf8")) !== (await readFile(targetPath, "utf8"))) {
        return false;
      }
    }
    return true;
  }
  return compare(sourceSchema, targetSchema, true);
}

import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { exists } from "./project.mjs";

export async function installOpenSpecScaffold(root, config) {
  const source = path.join(root, ".pixcode", "scaffolds", "openspec");
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
  if (await exists(existingMarker)) {
    const marker = JSON.parse(await readFile(existingMarker, "utf8"));
    if (marker.managedBy !== "PixCode") {
      throw new Error(`拒绝刷新不受 PixCode 管理的 Schema：${targetSchema}`);
    }
    await rm(targetSchema, { recursive: true });
  }
  await mkdir(path.dirname(targetSchema), { recursive: true });
  await cp(sourceSchema, targetSchema, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
  refreshed.push(path.relative(root, targetSchema));

  const markerPath = path.join(targetSchema, ".pixcode-managed.json");
  await writeFile(
    markerPath,
    `${JSON.stringify(
      {
        managedBy: "PixCode",
        frameworkVersion: config.frameworkVersion,
        source: path.relative(root, sourceSchema).split(path.sep).join("/"),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

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
      refreshed: true,
      marker: markerPath,
    },
    created,
    refreshed,
  };
}

export async function scaffoldMatchesRuntime(root, config) {
  const sourceSchema = path.join(
    root,
    ".pixcode",
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
  async function compare(source, target) {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);
      if (!(await exists(targetPath))) return false;
      if (entry.isDirectory()) {
        if (!(await compare(sourcePath, targetPath))) return false;
      } else if ((await readFile(sourcePath, "utf8")) !== (await readFile(targetPath, "utf8"))) {
        return false;
      }
    }
    return true;
  }
  return compare(sourceSchema, targetSchema);
}

import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { assertChangeId, exists } from "./project.mjs";

const SAFE_SEGMENT = /^[^<>:"/\\|?*\u0000-\u001f]+$/u;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const TODO_MARKER = "PIXCODE:TODO";

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function assertInside(root, target, label) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} 必须位于 ${root} 内部且不能等于其根目录。`);
  }
}

function publicationRoot(root, config) {
  const configured = config.publication?.root ?? "pix-specs";
  if (path.isAbsolute(configured)) {
    throw new Error("publication.root 必须使用项目内相对路径。");
  }
  const resolved = path.resolve(root, configured);
  assertInside(root, resolved, "当前态功能资产目录");
  return resolved;
}

function templateRoot(root, config) {
  const template = config.publication?.template ?? "capability-baseline";
  return path.join(root, ".pixcode", "templates", template);
}

function assertSegment(segment) {
  if (
    typeof segment !== "string" ||
    segment !== segment.trim() ||
    !segment ||
    segment === "." ||
    segment === ".." ||
    segment.endsWith(".") ||
    segment.endsWith(" ") ||
    !SAFE_SEGMENT.test(segment) ||
    RESERVED_WINDOWS_NAME.test(segment)
  ) {
    throw new Error(`不安全的功能资产目录名：${JSON.stringify(segment)}`);
  }
}

function replaceTokens(content, values) {
  return content.replace(/\{\{([a-z0-9_]+)\}\}/giu, (match, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}

async function readTemplateManifest(root, config) {
  const directory = templateRoot(root, config);
  const manifestPath = path.join(directory, "template.json");
  if (!(await exists(manifestPath))) {
    throw new Error(`找不到当前态归档模板：${manifestPath}`);
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    config.publication?.templateVersion &&
    manifest.version !== config.publication.templateVersion
  ) {
    throw new Error(
      `归档模板版本不匹配：期望 ${config.publication.templateVersion}，实际 ${manifest.version}。`,
    );
  }
  return { directory, manifest };
}

export async function validateCapabilityPublicationMap(root, config, changeDirectory) {
  const { manifest } = await readTemplateManifest(root, config);
  const mapping = await readPublicationMap(
    changeDirectory,
    new Set(Object.keys(manifest.assets)),
  );
  const current = await loadCapabilities(root, config);
  const byId = new Map(current.map((item) => [item.metadata.capability.id, item]));
  const desiredPaths = new Map();
  for (const item of mapping.value.capabilities) {
    const existing = byId.get(item.id);
    if (item.action === "create" && existing) {
      throw new Error(`Capability ${item.id} 已存在，不能再次使用 create。`);
    }
    if (item.action === "update" && !existing) {
      throw new Error(`Capability ${item.id} 尚不存在，不能使用 update。`);
    }
    const desired = path.resolve(publicationRoot(root, config), ...item.publication_path);
    const normalized = desired.toLocaleLowerCase("zh-CN");
    if (desiredPaths.has(normalized)) {
      throw new Error(
        `多个 Capability 不能发布到同一目录：${item.publication_path.join("/")}`,
      );
    }
    desiredPaths.set(normalized, item.id);
    const collision = current.find(
      (entry) =>
        entry.metadata.capability.id !== item.id &&
        path.resolve(entry.directory).toLocaleLowerCase("zh-CN") === normalized,
    );
    if (collision) {
      throw new Error(
        `发布目录已属于 Capability ${collision.metadata.capability.id}：${desired}`,
      );
    }
  }
  return {
    ok: true,
    mapping: mapping.filePath,
    capabilities: mapping.value.capabilities.map((item) => ({
      id: item.id,
      name: item.name,
      action: item.action,
      publication_path: item.publication_path,
      assets: item.assets,
    })),
  };
}

export async function readPublicationMap(changeDirectory, validAssets) {
  const filePath = path.join(changeDirectory, "pixcode.yaml");
  if (!(await exists(filePath))) {
    throw new Error(`缺少 PixCode 归档映射：${filePath}`);
  }
  const value = parse(await readFile(filePath, "utf8"));
  if (value?.schema_version !== 1 || !Array.isArray(value.capabilities)) {
    throw new Error("pixcode.yaml 必须包含 schema_version: 1 和 capabilities 列表。");
  }
  if (value.capabilities.length === 0) {
    throw new Error("pixcode.yaml 至少声明一个 Capability。");
  }
  const ids = new Set();
  for (const item of value.capabilities) {
    assertChangeId(item?.id);
    if (ids.has(item.id)) throw new Error(`pixcode.yaml 中 Capability 重复：${item.id}`);
    ids.add(item.id);
    if (typeof item.name !== "string" || !item.name.trim()) {
      throw new Error(`Capability ${item.id} 缺少中文名称。`);
    }
    if (!["create", "update"].includes(item.action)) {
      throw new Error(`Capability ${item.id} 的 action 必须是 create 或 update。`);
    }
    if (!Array.isArray(item.publication_path) || item.publication_path.length === 0) {
      throw new Error(`Capability ${item.id} 必须声明 publication_path。`);
    }
    item.publication_path.forEach(assertSegment);
    if (!Array.isArray(item.assets) || item.assets.length === 0) {
      throw new Error(`Capability ${item.id} 必须声明本轮受影响 assets。`);
    }
    const unknown = item.assets.filter((asset) => !validAssets.has(asset));
    if (unknown.length) {
      throw new Error(`Capability ${item.id} 包含未知 assets：${unknown.join("、")}`);
    }
    if (new Set(item.assets).size !== item.assets.length) {
      throw new Error(`Capability ${item.id} 的 assets 不得重复。`);
    }
    if (item.action === "create" && item.assets.length !== validAssets.size) {
      throw new Error(`新建 Capability ${item.id} 时必须生成全部当前态资产。`);
    }
  }
  return { filePath, value };
}

async function findCapabilityFiles(directory) {
  if (!(await exists(directory))) return [];
  const result = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name === "capability.yaml") result.push(target);
    }
  }
  await visit(directory);
  return result;
}

async function loadCapabilities(root, config) {
  const rootDirectory = publicationRoot(root, config);
  const result = [];
  const ids = new Set();
  for (const filePath of await findCapabilityFiles(rootDirectory)) {
    const metadata = parse(await readFile(filePath, "utf8"));
    const id = metadata?.capability?.id;
    assertChangeId(id);
    if (ids.has(id)) throw new Error(`pix-specs 中存在重复 Capability ID：${id}`);
    ids.add(id);
    result.push({ filePath, directory: path.dirname(filePath), metadata });
  }
  return result;
}

function archiveDirectory(root, archiveName) {
  assertChangeId(archiveName.replace(/^\d{4}-\d{2}-\d{2}-/, ""));
  return path.join(root, "openspec", "changes", "archive", archiveName);
}

async function resolveArchive(root, archiveName) {
  const directory = archiveDirectory(root, archiveName);
  const info = await stat(directory).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`找不到 OpenSpec 归档：${archiveName}`);
  return directory;
}

export async function prepareCapabilityPublication(root, config, archiveName) {
  const archive = await resolveArchive(root, archiveName);
  const { directory: templates, manifest } = await readTemplateManifest(root, config);
  const validAssets = new Set(Object.keys(manifest.assets));
  const mapping = await readPublicationMap(archive, validAssets);
  const outputRoot = publicationRoot(root, config);
  await mkdir(outputRoot, { recursive: true });
  const current = await loadCapabilities(root, config);
  const byId = new Map(current.map((item) => [item.metadata.capability.id, item]));
  const changeId = archiveName.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const plans = [];

  for (const item of mapping.value.capabilities) {
    const desiredDirectory = path.join(outputRoot, ...item.publication_path);
    assertInside(outputRoot, desiredDirectory, `Capability ${item.id} 发布目录`);
    const existing = byId.get(item.id);
    if (item.action === "create" && existing) {
      throw new Error(`Capability ${item.id} 已存在，不能再次使用 create。`);
    }
    if (item.action === "update" && !existing) {
      throw new Error(`Capability ${item.id} 尚不存在，不能使用 update。`);
    }
    if (existing && path.resolve(existing.directory) !== path.resolve(desiredDirectory)) {
      if (await exists(desiredDirectory)) {
        throw new Error(`Capability ${item.id} 的新目录已存在：${desiredDirectory}`);
      }
      await mkdir(path.dirname(desiredDirectory), { recursive: true });
      await rename(existing.directory, desiredDirectory);
    }
    await mkdir(desiredDirectory, { recursive: true });
    const revision = (existing?.metadata?.publication?.revision ?? 0) + 1;
    const values = {
      capability_id: item.id,
      capability_name: item.name,
      change_id: changeId,
      archive_name: archiveName,
      revision,
      openspec_spec_link: toPosix(
        path.relative(desiredDirectory, path.join(root, "openspec", "specs", item.id, "spec.md")),
      ),
      archive_link: toPosix(path.relative(desiredDirectory, archive)),
    };
    const created = [];
    const retained = [];
    for (const fileName of ["README.md", ...Object.values(manifest.assets)]) {
      const target = path.join(desiredDirectory, fileName);
      if (await exists(target)) {
        retained.push(fileName);
        continue;
      }
      const source = path.join(templates, fileName);
      const asset = Object.entries(manifest.assets).find(([, name]) => name === fileName)?.[0];
      const initialSource = asset ? manifest.initialSources?.[asset] : null;
      let content;
      if (item.action === "create" && initialSource) {
        const sourcePath =
          initialSource === "openspec-spec"
            ? path.join(root, "openspec", "specs", item.id, "spec.md")
            : path.join(archive, initialSource);
        if (await exists(sourcePath)) {
          content = `<!-- ${TODO_MARKER} 将下方过程资产整理为当前完整结论，移除增量和“本轮”表述。 -->\n\n${await readFile(sourcePath, "utf8")}`;
        }
      }
      content ??= replaceTokens(await readFile(source, "utf8"), values);
      await writeFile(target, content, "utf8");
      created.push(fileName);
    }
    plans.push({
      id: item.id,
      name: item.name,
      action: item.action,
      assets: item.assets,
      directory: desiredDirectory,
      created,
      retained,
      sources: {
        requirement: path.join(root, "openspec", "specs", item.id, "spec.md"),
        archive,
      },
    });
  }
  return { archive: archiveName, mapping: mapping.filePath, plans };
}

function traceabilityDocument(metadata) {
  const rows = metadata.source_changes
    .map(
      (item) =>
        `| ${item.archived_at} | \`${item.change}\` | [查看归档](${item.archive_link}) | ${item.assets.join("、")} |`,
    )
    .join("\n");
  return `# ${metadata.capability.name}｜变更追溯

> Capability：\`${metadata.capability.id}\`  
> 当前结论修订：\`r${metadata.publication.revision}\`

## OpenSpec 映射

- 当前需求事实：[\`${metadata.openspec.spec_path}\`](${metadata.openspec.spec_link})
- 最近归档 Change：\`${metadata.openspec.latest_change}\`

## 变更历史

| 归档日期 | Change | 历史资产 | 影响的当前态资产 |
| --- | --- | --- | --- |
${rows}

> 本文件由 PixCode 根据 \`capability.yaml\` 重建。归档历史不可原地改写；撤销已生效需求必须创建新的 Change。
`;
}

function renderCapabilityYaml(metadata) {
  return stringify(metadata, { lineWidth: 0 });
}

function parseArchiveDate(archiveName) {
  const value = archiveName.match(/^(\d{4}-\d{2}-\d{2})-/)?.[1];
  if (!value) throw new Error(`归档目录缺少日期前缀：${archiveName}`);
  return value;
}

async function validatePublishedDocuments(directory, item, manifest, changeId) {
  const required = ["README.md", ...Object.values(manifest.assets)];
  for (const fileName of required) {
    const filePath = path.join(directory, fileName);
    if (!(await exists(filePath))) throw new Error(`当前态资产缺失：${filePath}`);
    const content = await readFile(filePath, "utf8");
    if (content.includes(TODO_MARKER)) {
      throw new Error(`当前态资产仍含未完成标记：${filePath}`);
    }
  }
  const affectedFiles = [
    "README.md",
    ...item.assets.map((asset) => manifest.assets[asset]),
  ];
  for (const fileName of affectedFiles) {
    const content = await readFile(path.join(directory, fileName), "utf8");
    if (!content.includes(changeId)) {
      throw new Error(`受影响资产没有标记最近 Change ${changeId}：${fileName}`);
    }
  }
}

export async function finalizeCapabilityPublication(root, config, archiveName) {
  const archive = await resolveArchive(root, archiveName);
  const { manifest } = await readTemplateManifest(root, config);
  const mapping = await readPublicationMap(archive, new Set(Object.keys(manifest.assets)));
  const outputRoot = publicationRoot(root, config);
  const current = await loadCapabilities(root, config);
  const byId = new Map(current.map((item) => [item.metadata.capability.id, item]));
  const changeId = archiveName.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const archivedAt = parseArchiveDate(archiveName);
  const finalized = [];

  for (const item of mapping.value.capabilities) {
    const directory = path.join(outputRoot, ...item.publication_path);
    assertInside(outputRoot, directory, `Capability ${item.id} 发布目录`);
    await validatePublishedDocuments(directory, item, manifest, changeId);
    const existing = byId.get(item.id)?.metadata;
    const relativeArchive = toPosix(path.relative(directory, archive));
    const specPath = path.join(root, "openspec", "specs", item.id, "spec.md");
    if (!(await exists(specPath))) {
      throw new Error(`OpenSpec 当前 Spec 不存在，无法完成映射：${specPath}`);
    }
    const previousChanges = existing?.source_changes ?? [];
    const isReplay = previousChanges.some((entry) => entry.change === changeId);
    const sourceChanges = previousChanges
      .filter((entry) => entry.change !== changeId)
      .map((entry) => ({
        ...entry,
        archive_link: toPosix(path.relative(directory, path.join(root, entry.archive))),
      }));
    sourceChanges.push({
      change: changeId,
      archived_at: archivedAt,
      archive: toPosix(path.relative(root, archive)),
      archive_link: relativeArchive,
      assets: item.assets,
    });
    const metadata = {
      schema_version: 1,
      capability: {
        id: item.id,
        name: item.name,
        status: "active",
      },
      classification: {
        path: item.publication_path,
      },
      openspec: {
        spec_id: item.id,
        spec_path: toPosix(path.relative(root, specPath)),
        spec_link: toPosix(path.relative(directory, specPath)),
        latest_change: changeId,
        latest_archive: toPosix(path.relative(root, archive)),
      },
      publication: {
        template: config.publication?.template ?? "capability-baseline",
        template_version: manifest.version,
        revision: isReplay
          ? existing.publication.revision
          : (existing?.publication?.revision ?? 0) + 1,
        published_at: archivedAt,
      },
      source_changes: sourceChanges,
    };
    await writeFile(path.join(directory, "capability.yaml"), renderCapabilityYaml(metadata), "utf8");
    await writeFile(path.join(directory, manifest.generated.traceability), traceabilityDocument(metadata), "utf8");
    finalized.push({ id: item.id, directory, revision: metadata.publication.revision });
  }
  const indexes = await rebuildCapabilityIndexes(root, config);
  return { archive: archiveName, finalized, indexes };
}

function capabilityIndexDocument(baseDirectory, entries, title) {
  const rows = entries
    .sort((left, right) =>
      left.metadata.classification.path.join("/").localeCompare(
        right.metadata.classification.path.join("/"),
        "zh-CN",
      ),
    )
    .map((entry) => {
      const relativeDirectory = toPosix(path.relative(baseDirectory, entry.directory)) || ".";
      const displayPath = entry.metadata.classification.path.join(" / ");
      return `| [${entry.metadata.capability.name}](${relativeDirectory}/README.md) | \`${entry.metadata.capability.id}\` | ${displayPath} | r${entry.metadata.publication.revision} | \`${entry.metadata.openspec.latest_change}\` |`;
    })
    .join("\n");
  return `# ${title}

> 本索引由 PixCode 根据各功能目录中的 \`capability.yaml\` 自动重建。

| 功能 | Capability | 分类路径 | 修订 | 最近 Change |
| --- | --- | --- | --- | --- |
${rows || "| 暂无 | - | - | - | - |"}
`;
}

export async function rebuildCapabilityIndexes(root, config) {
  const outputRoot = publicationRoot(root, config);
  await mkdir(outputRoot, { recursive: true });
  const capabilities = await loadCapabilities(root, config);
  const indexDirectories = new Set([outputRoot]);
  for (const capability of capabilities) {
    let current = path.dirname(capability.directory);
    while (current.startsWith(outputRoot) && current !== outputRoot) {
      indexDirectories.add(current);
      current = path.dirname(current);
    }
  }
  const written = [];
  for (const directory of indexDirectories) {
    const relevant = capabilities.filter(
      (item) =>
        item.directory === directory ||
        item.directory.startsWith(`${directory}${path.sep}`),
    );
    const title =
      directory === outputRoot
        ? "PixCode 功能规格"
        : `${path.basename(directory)}｜功能资产索引`;
    const filePath = path.join(directory, "README.md");
    await writeFile(filePath, capabilityIndexDocument(directory, relevant, title), "utf8");
    written.push(filePath);
  }
  return written;
}

export async function validateCapabilities(root, config) {
  const { manifest } = await readTemplateManifest(root, config);
  const capabilities = await loadCapabilities(root, config);
  const errors = [];
  if (await exists(publicationRoot(root, config))) {
    async function findUnfinished(current) {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const target = path.join(current, entry.name);
        if (entry.isDirectory()) await findUnfinished(target);
        else if (entry.isFile() && entry.name.endsWith(".md")) {
          if ((await readFile(target, "utf8")).includes(TODO_MARKER)) {
            errors.push(`存在尚未合并完成的当前态资产：${target}`);
          }
        }
      }
    }
    await findUnfinished(publicationRoot(root, config));
  }
  for (const item of capabilities) {
    const expectedPath = item.metadata?.classification?.path;
    const actualPath = path
      .relative(publicationRoot(root, config), item.directory)
      .split(path.sep);
    if (JSON.stringify(expectedPath) !== JSON.stringify(actualPath)) {
      errors.push(`${item.metadata.capability.id} 的 classification.path 与实际目录不一致`);
    }
    for (const fileName of [
      "README.md",
      ...Object.values(manifest.assets),
      manifest.generated.traceability,
    ]) {
      if (!(await exists(path.join(item.directory, fileName)))) {
        errors.push(`${item.metadata.capability.id} 缺少 ${fileName}`);
      }
    }
    const specPath = item.metadata?.openspec?.spec_path;
    if (!specPath || !(await exists(path.join(root, specPath)))) {
      errors.push(`${item.metadata.capability.id} 映射的 OpenSpec Spec 不存在`);
    }
    for (const source of item.metadata?.source_changes ?? []) {
      if (!source.archive || !(await exists(path.join(root, source.archive)))) {
        errors.push(`${item.metadata.capability.id} 映射的归档 Change 不存在：${source.change}`);
      }
    }
  }
  return {
    ok: errors.length === 0,
    root: publicationRoot(root, config),
    count: capabilities.length,
    errors,
  };
}

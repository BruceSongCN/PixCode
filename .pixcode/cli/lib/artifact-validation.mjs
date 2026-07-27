import { readFile } from "node:fs/promises";
import { parseOpenSpecJson, runOpenSpec } from "../adapters/openspec.mjs";

const FIELD_HEADER = [
  "字段",
  "类型",
  "空值",
  "默认长度",
  "中文含义/XML 字段说明",
  "来源/规则",
];

function splitRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function stripCode(value) {
  return value.replace(/^`|`$/g, "").trim();
}

function section(content, heading) {
  const startPattern = new RegExp(`^## ${heading}\\s*$`, "m");
  const match = startPattern.exec(content);
  if (!match) return "";
  const start = match.index + match[0].length;
  const rest = content.slice(start);
  const next = rest.search(/^##\s+/m);
  return next >= 0 ? rest.slice(0, next) : rest;
}

function declaredEntities(content) {
  const modelChanges = section(content, "模型变化");
  const names = [];
  for (const line of modelChanges.split(/\r?\n/)) {
    const cells = splitRow(line);
    if (cells.length < 2) continue;
    const type = stripCode(cells[0]);
    const name = stripCode(cells[1]);
    if (!/^(实体|聚合根)$/.test(type)) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) names.push(name);
  }
  return [...new Set(names)];
}

function entitySection(fieldsSection, entityName) {
  const escaped = entityName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^###\\s+(?:\\*\\*)?\`${escaped}\`(?:\\*\\*)?.*$`, "m");
  const match = pattern.exec(fieldsSection);
  if (!match) return "";
  const start = match.index + match[0].length;
  const rest = fieldsSection.slice(start);
  const next = rest.search(/^###\s+/m);
  return next >= 0 ? rest.slice(0, next) : rest;
}

function validateEntityFields(entityName, content) {
  const errors = [];
  if (/本轮无字段变化/.test(content)) return errors;

  const lines = content.split(/\r?\n/);
  const headerIndex = lines.findIndex(
    (line) => JSON.stringify(splitRow(line)) === JSON.stringify(FIELD_HEADER),
  );
  if (headerIndex < 0) {
    return [`实体 ${entityName} 缺少标准字段表头`];
  }

  const rows = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const cells = splitRow(lines[index]);
    if (!cells.length) {
      if (rows.length) break;
      continue;
    }
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    rows.push(cells);
  }
  if (!rows.length) return [`实体 ${entityName} 没有字段定义`];

  for (const cells of rows) {
    if (cells.length !== FIELD_HEADER.length) {
      errors.push(`实体 ${entityName} 存在列数不是 ${FIELD_HEADER.length} 的字段行`);
      continue;
    }
    const field = cells[0];
    if (!/^`[A-Za-z_][A-Za-z0-9_]*`$/.test(field)) {
      errors.push(`实体 ${entityName} 的字段 ${field || "<空>"} 必须一行一个代码标识`);
    }
    if (!/^`[^`]+`$/.test(cells[1])) {
      errors.push(`实体 ${entityName} 字段 ${field} 缺少明确代码类型`);
    }
    if (!/^(是|否|条件)$/.test(cells[2])) {
      errors.push(`实体 ${entityName} 字段 ${field} 的空值必须是“是”“否”或“条件”`);
    }
    for (let index = 3; index < cells.length; index += 1) {
      if (!cells[index] || /<[^>]+>|待补充/.test(cells[index])) {
        errors.push(`实体 ${entityName} 字段 ${field} 的“${FIELD_HEADER[index]}”未完成`);
      }
    }
  }
  return errors;
}

export function validateModelDocument(content, label = "model") {
  const applicability = section(content, "模型适用性") || section(content, "适用性");
  if (/不适用/.test(applicability)) return { ok: true, label, errors: [] };

  const entities = declaredEntities(content);
  if (!entities.length) return { ok: true, label, errors: [] };

  const fieldsSection = section(content, "实体字段定义");
  const errors = [];
  if (!fieldsSection) {
    errors.push("缺少“实体字段定义”章节");
  } else {
    for (const entity of entities) {
      const entityContent = entitySection(fieldsSection, entity);
      if (!entityContent) {
        errors.push(`模型变化中的实体 ${entity} 缺少独立字段章节`);
        continue;
      }
      errors.push(...validateEntityFields(entity, entityContent));
    }
  }
  return { ok: errors.length === 0, label, errors };
}

export function validateReviewDocument(content, label = "review") {
  const status =
    content.match(/^\|\s*评审状态\s*\|\s*([^|]+)\|/m)?.[1]?.trim() ??
    content.match(/## 最终结论[\s\S]{0,120}?(有条件通过|通过|不通过|待评审)/)?.[1];
  const errors = [];
  if (!["通过", "有条件通过"].includes(status)) {
    errors.push(`设计评审尚未通过（当前：${status || "未填写"}）`);
  }
  if (
    /^\|[^|\r\n]*\|\s*阻断\s*\|[^|\r\n]*\|[^|\r\n]*\|[^|\r\n]*\|\s*待处理\s*\|/m.test(
      content,
    )
  ) {
    errors.push("设计评审仍有未关闭的阻断问题");
  }
  return { ok: errors.length === 0, label, status, errors };
}

export async function validateModelArtifacts(root, config, target) {
  let changes;
  if (target) {
    changes = [target];
  } else {
    const listed = parseOpenSpecJson(
      await runOpenSpec(["list", "--json"], {
        cwd: root,
        expectedVersion: config.engine.version,
      }),
    );
    changes = (listed.changes ?? []).map((change) => change.name);
  }

  const checks = [];
  for (const change of changes) {
    const status = parseOpenSpecJson(
      await runOpenSpec(["status", "--change", change, "--json"], {
        cwd: root,
        expectedVersion: config.engine.version,
      }),
    );
    for (const designPath of status.artifactPaths?.design?.existingOutputPaths ?? []) {
      const content = await readFile(designPath, "utf8");
      checks.push({
        change,
        path: designPath,
        ...validateModelDocument(content, `${change}:design-model`),
      });
    }
  }
  return checks;
}

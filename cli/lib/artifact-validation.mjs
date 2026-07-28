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

function meaningfulSection(content, heading) {
  const value = section(content, heading)
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  return Boolean(value && !/^无[。.]?$/.test(value) && !/<[^>]+>/.test(value));
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
  for (const line of content.split(/\r?\n/)) {
    const cells = splitRow(line);
    if (cells.some((cell) => /^(待评审|不通过)$/.test(cell))) {
      errors.push(`设计评审仍有未完成或不通过的明细：${line.trim()}`);
    }
    if (
      cells.some((cell) => /(?:^|\s\/\s)阻断(?:\s\/\s|$)/.test(cell)) &&
      cells.some((cell) => /^(待处理|未关闭)$/.test(cell))
    ) {
      errors.push("设计评审仍有未关闭的阻断问题");
    }
  }
  if (status === "有条件通过" && !meaningfulSection(content, "条件与遗留项")) {
    errors.push("有条件通过必须在“条件与遗留项”中记录条件、责任人和关闭方式。");
  }
  return { ok: errors.length === 0, label, status, errors: [...new Set(errors)] };
}

export function validateVerificationDocument(content, label = "verification") {
  const validationStatus =
    content.match(/^\|\s*验证状态\s*\|\s*([^|]+)\|/m)?.[1]?.trim() ?? null;
  const deliveryDecision =
    content.match(/^\|\s*交付决定\s*\|\s*([^|]+)\|/m)?.[1]?.trim() ?? null;
  const accepted = new Set(["通过", "有条件通过"]);
  const errors = [];

  if (!accepted.has(validationStatus)) {
    errors.push(`验证尚未通过（当前：${validationStatus || "未填写"}）`);
  }
  if (!accepted.has(deliveryDecision)) {
    errors.push(`交付决定尚未通过（当前：${deliveryDecision || "未填写"}）`);
  }

  if (accepted.has(validationStatus) || accepted.has(deliveryDecision)) {
    const environment = section(content, "执行环境声明");
    const requiredEnvironmentFields = [
      "执行模式 / 配置来源",
      "主机 / 工作区 / Runtime",
      "实际服务入口",
      "部署标识 / 版本",
      "契约 / 构建指纹",
    ];
    if (!environment) {
      errors.push("正向交付结论必须包含“执行环境声明”。");
    } else {
      for (const field of requiredEnvironmentFields) {
        const row = environment
          .split(/\r?\n/)
          .map(splitRow)
          .find((cells) => cells[0] === field);
        const value = row?.[1]?.trim() ?? "";
        if (!value || /<[^>]+>/.test(value) || /local\s*\/\s*remote/.test(value)) {
          errors.push(`执行环境声明缺少有效的“${field}”`);
        }
      }
    }
  }

  for (const line of content.split(/\r?\n/)) {
    const cells = splitRow(line);
    if (
      cells.some(
        (cell) =>
          /^(失败|不通过|未执行|未验收)$/.test(cell) ||
          /^(失败|不通过|未执行|未验收)(?:[\s（(:：/]|$)/.test(cell) ||
          /(?:^|\s\/\s)(失败|不通过|未执行|未验收)(?:\s\/\s|$)/.test(cell),
      )
    ) {
      errors.push(`验证结果仍含失败、未执行或未验收项：${line.trim()}`);
    }
  }

  if (
    [validationStatus, deliveryDecision].includes("有条件通过") &&
    !meaningfulSection(content, "失败、未执行与遗留风险")
  ) {
    errors.push("有条件通过必须在“失败、未执行与遗留风险”中记录条件和处置。");
  }

  return {
    ok: errors.length === 0,
    label,
    validationStatus,
    deliveryDecision,
    errors: [...new Set(errors)],
  };
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

export async function validateVerificationArtifacts(root, config, target) {
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
    const verificationPath =
      status.artifactPaths?.verification?.existingOutputPaths?.[0];
    if (!verificationPath) continue;
    checks.push(
      validateVerificationDocument(
        await readFile(verificationPath, "utf8"),
        `${change}:verification`,
      ),
    );
  }
  return checks;
}

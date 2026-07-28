import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { ensureWorkspaceGitignore, exists } from "./project.mjs";
import { frameworkAssetsRoot } from "./runtime.mjs";

const LOCAL_CONFIG_NAME = "workspace.local.json";
const VALID_MODES = new Set(["local", "remote"]);
let validator;

function formatError(error) {
  const location = error.instancePath || "/";
  if (error.keyword === "additionalProperties") {
    return `${location} 不允许字段 ${error.params.additionalProperty}`;
  }
  if (error.keyword === "required") {
    return `${location} 缺少字段 ${error.params.missingProperty}`;
  }
  return `${location} ${error.message ?? "格式无效"}`;
}

async function localConfigValidator() {
  if (validator) return validator;
  const schemaPath = path.join(
    frameworkAssetsRoot,
    "schemas",
    "workspace-local.schema.json",
  );
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  validator = ajv.compile(schema);
  return validator;
}

function assertMode(mode, source) {
  if (!VALID_MODES.has(mode)) {
    throw new Error(`${source} 只能是 local 或 remote，当前值为 ${mode || "空"}。`);
  }
}

export async function validateWorkspaceLocalConfig(value) {
  const validate = await localConfigValidator();
  const ok = validate(value);
  return {
    ok: Boolean(ok),
    errors: ok ? [] : (validate.errors ?? []).map(formatError),
  };
}

export async function readWorkspaceLocalConfig(root) {
  const filePath = path.join(root, LOCAL_CONFIG_NAME);
  if (!(await exists(filePath))) {
    return { path: filePath, exists: false, config: undefined };
  }
  let config;
  try {
    config = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${LOCAL_CONFIG_NAME} 不是有效 JSON：${error.message}`);
  }
  const validation = await validateWorkspaceLocalConfig(config);
  if (!validation.ok) {
    throw new Error(`${LOCAL_CONFIG_NAME} 校验失败：${validation.errors.join("；")}`);
  }
  return { path: filePath, exists: true, config };
}

export async function resolveDebugConfig(root, options = {}) {
  const local = await readWorkspaceLocalConfig(root);
  const cliMode = options.cliMode;
  const environmentMode = options.env?.PIXCODE_DEBUG_MODE;
  if (cliMode !== undefined) assertMode(cliMode, "--mode");
  if (environmentMode !== undefined) {
    assertMode(environmentMode, "PIXCODE_DEBUG_MODE");
  }

  const mode =
    cliMode ??
    environmentMode ??
    local.config?.debug.mode ??
    "local";
  const source =
    cliMode !== undefined
      ? "cli"
      : environmentMode !== undefined
        ? "environment"
        : local.exists
          ? "workspace.local.json"
          : "default";
  const remote = local.config?.debug.remote;

  return {
    mode,
    source,
    fallback: "disabled",
    localConfig: {
      path: local.path,
      exists: local.exists,
    },
    remote,
    ready: mode === "local" || Boolean(remote),
    error:
      mode === "remote" && !remote
        ? "已选择 remote，但 workspace.local.json 未提供 debug.remote 配置"
        : undefined,
  };
}

export async function setDebugMode(root, mode) {
  assertMode(mode, "调试模式");
  const local = await readWorkspaceLocalConfig(root);
  if (mode === "remote" && !local.config?.debug.remote) {
    throw new Error(
      "启用 remote 前，请先在 workspace.local.json 中配置 debug.remote；可参考远程调试手册。",
    );
  }
  const config = local.config ?? {
    $schema: "./.pixcode/schemas/workspace-local.schema.json",
    schemaVersion: 1,
    debug: {
      mode: "local",
      fallback: "disabled",
    },
  };
  config.debug.mode = mode;
  config.debug.fallback = "disabled";
  await ensureWorkspaceGitignore(root);
  await writeFile(local.path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return resolveDebugConfig(root);
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value) => {
      stdout += value;
    });
    child.stderr.on("data", (value) => {
      stderr += value;
    });
    child.once("error", (error) => {
      resolve({ ok: false, code: -1, stdout, stderr: error.message });
    });
    child.once("close", (code) => {
      resolve({
        ok: code === 0,
        code: code ?? -1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

function quotePosix(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export async function diagnoseDebugEnvironment(root, options = {}) {
  const resolved = await resolveDebugConfig(root, options);
  const checks = [
    {
      ok: resolved.ready,
      item: "调试配置",
      detail: resolved.error ?? `${resolved.mode}（来源：${resolved.source}）`,
    },
    {
      ok: resolved.fallback === "disabled",
      item: "失败回退",
      detail: "disabled（远程不可用时不静默改为本地执行）",
    },
  ];

  if (resolved.mode === "local" || !resolved.remote) {
    return { ok: checks.every((check) => check.ok), config: resolved, checks };
  }

  const remote = resolved.remote;
  const runtimeChecks =
    remote.runtime === "docker-compose"
      ? [
          "command -v docker >/dev/null",
          "docker version --format '{{.Server.Version}}' >/dev/null",
          "docker compose version >/dev/null",
        ]
      : [
          "command -v kubectl >/dev/null",
          "kubectl version --client >/dev/null",
        ];
  const script = [
    "set -eu",
    `test -d ${quotePosix(remote.workspace)}`,
    ...runtimeChecks,
    "printf PIXCODE_REMOTE_READY",
  ].join(" && ");
  const connection = await run(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      `ConnectTimeout=${remote.connectTimeoutSeconds}`,
      "--",
      remote.host,
      `sh -lc ${quotePosix(script)}`,
    ],
    options,
  );
  checks.push({
    ok: connection.ok && connection.stdout.includes("PIXCODE_REMOTE_READY"),
    item: "远程调试环境",
    detail: connection.ok
      ? `${remote.host}:${remote.workspace}（${remote.runtime}）`
      : connection.stderr || connection.stdout || `SSH 退出码 ${connection.code}`,
  });
  return { ok: checks.every((check) => check.ok), config: resolved, checks };
}

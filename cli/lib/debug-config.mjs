import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {
  ensureWorkspaceGitignore,
  exists,
  readWorkspaceConfig,
} from "./project.mjs";
import { frameworkAssetsRoot } from "./runtime.mjs";

const LOCAL_CONFIG_NAME = "workspace.local.json";
const VALID_MODES = new Set(["local", "remote"]);
const VALID_GATE_PHASES = new Set(["apply", "verify"]);
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
  const manifest = await readWorkspaceConfig(root);
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
  const modeDefaultProfile = manifest.verification?.defaultProfiles?.[mode];
  if (modeDefaultProfile) {
    config.verification ??= {};
    config.verification.profile = modeDefaultProfile;
  } else if (config.verification?.profile) {
    const selectedProfile =
      manifest.verification?.profiles?.[config.verification.profile];
    if (selectedProfile && selectedProfile.debugMode !== mode) {
      delete config.verification.profile;
      if (Object.keys(config.verification).length === 0) {
        delete config.verification;
      }
    }
  }
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
  const manifest = await readWorkspaceConfig(root);
  const local = await readWorkspaceLocalConfig(root);
  const explicitProfileName = local.config?.verification?.profile;
  const explicitProfile = explicitProfileName
    ? manifest.verification?.profiles?.[explicitProfileName]
    : undefined;
  const modeDefaultProfileName =
    manifest.verification?.defaultProfiles?.[resolved.mode];
  const profileOverridden =
    (resolved.source === "cli" || resolved.source === "environment") &&
    explicitProfile &&
    explicitProfile.debugMode !== resolved.mode;
  const profileName = profileOverridden
    ? modeDefaultProfileName
    : explicitProfileName ??
      modeDefaultProfileName ??
      manifest.verification?.defaultProfile;
  const profile = profileName
    ? manifest.verification?.profiles?.[profileName]
    : undefined;
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
  if (profileOverridden) {
    checks.push({
      ok: true,
      item: "验证 Profile 覆盖",
      detail: `${explicitProfileName} 要求 ${explicitProfile.debugMode}；本轮显式选择 ${resolved.mode}，改用${modeDefaultProfileName ? ` ${modeDefaultProfileName}` : "无 Profile 的安全模式"}`,
    });
  }
  if (profileName) {
    checks.push({
      ok: Boolean(profile),
      item: "验证 Profile",
      detail: profile
        ? `${profileName}（${profile.databaseIsolation}）`
        : `${profileName} 未在 manifest.json 中声明`,
    });
    if (profile) {
      checks.push({
        ok: profile.debugMode === resolved.mode,
        item: "Profile 执行模式",
        detail:
          profile.debugMode === resolved.mode
            ? profile.debugMode
            : `Profile 要求 ${profile.debugMode}，当前为 ${resolved.mode}`,
      });
      checks.push({
        ok: !profile.databaseWrites || profile.databaseIsolation !== "none",
        item: "数据库写入隔离",
        detail: profile.databaseWrites
          ? profile.databaseIsolation
          : "只读或不访问数据库",
      });
      if (profile.databaseIsolation === "dedicated-container") {
        checks.push({
          ok: Number.isInteger(local.config?.verification?.databasePort),
          item: "隔离数据库端口",
          detail: Number.isInteger(local.config?.verification?.databasePort)
            ? `remote-loopback:${local.config.verification.databasePort}`
            : "workspace.local.json 未配置 verification.databasePort",
        });
      }
    }
  }
  resolved.verification = profile
    ? {
        name: profileName,
        ...profile,
        databasePort: local.config?.verification?.databasePort,
      }
    : undefined;

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

export async function gateExecutionEnvironment(root, phase, options = {}) {
  if (!VALID_GATE_PHASES.has(phase)) {
    throw new Error(
      `执行门禁阶段只能是 apply 或 verify，当前值为 ${phase || "空"}。`,
    );
  }
  const diagnosis = await diagnoseDebugEnvironment(root, options);
  const remote = diagnosis.config.mode === "remote";
  const requirements = remote
    ? phase === "apply"
      ? [
          "运行态调试、迁移和集成检查必须在已配置的远端环境执行；本地结果只能作为辅助检查。",
          "部署或重启属于远端写操作，必须使用项目声明的入口并确认已获用户授权；缺少入口或授权时暂停。",
          "不得因远端不可用而切换到本地并声称完成远端调试。",
        ]
      : [
          "交付验证必须命中已配置的远端环境及其真实服务；本地服务结果不能替代远端证据。",
          "先完成 Code Inspection、Unit 和 Focused Integration；仅在 test-plan 声明运行态或跨服务风险时进入 Remote Smoke，且实现产物自上次部署后变化才重新 Deploy。",
          "数据库 reset、Fixture、用例或文档变化不得触发应用重新部署；迁移需要重启时只处理受影响服务。",
          "失败修复后先用 case/tag/from-case 定向重跑，全部定向问题关闭后只执行一次完整回归。",
          "verification.md 必须记录执行模式、远端主机/工作区、实际服务地址、部署标识或版本以及可复核的契约或构建指纹。",
          "无法确认远端已部署当前实现时，相关场景必须标记为未执行或失败，不得判定通过。",
        ]
    : phase === "apply"
      ? [
          "当前明确选择 local；实现、运行态检查和证据应在本机完成，不部署到远端。",
          "开始修改前先锁定本轮 Target、范围、非目标和外部写操作；不得从已确认设计推导额外权限、部署或联调工作。",
          "优先使用验证 Profile 或 Target 规则中的 quick/focused 等价入口完成最快反馈和最小可回滚业务闭环，再扩展实现范围。",
        ]
      : [
          "当前明确选择 local；交付验证应命中本机实际入口，不部署到远端。",
          "按 Code Inspection → Unit → Focused Integration → Local Smoke → Full Regression 的风险顺序执行；不适用层级说明依据。",
          "失败修复后先定向重跑；测试稳定后再一次性整理 verification.md 和最终完整回归。",
        ];
  if (!diagnosis.config.verification) {
    requirements.push(
      "本轮未绑定匹配的验证 Profile；只可执行可从 Target 规则确定的本地检查。数据库写入必须已有用户明确授权，并使用可恢复 fixture 验证零残留。",
    );
  }
  return {
    ok: diagnosis.ok,
    phase,
    mode: diagnosis.config.mode,
    source: diagnosis.config.source,
    target:
      remote && diagnosis.config.remote
        ? {
            host: diagnosis.config.remote.host,
            workspace: diagnosis.config.remote.workspace,
            runtime: diagnosis.config.remote.runtime,
          }
        : { host: "local" },
    checks: diagnosis.checks,
    verification: diagnosis.config.verification,
    requirements,
  };
}

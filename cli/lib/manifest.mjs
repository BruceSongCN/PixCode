import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { frameworkAssetsRoot } from "./runtime.mjs";

let validator;

async function workspaceManifestValidator() {
  if (validator) return validator;
  const schemaPath = path.join(
    frameworkAssetsRoot,
    "schemas",
    "workspace-manifest.schema.json",
  );
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  validator = ajv.compile(schema);
  return validator;
}

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

export async function validateWorkspaceManifest(value) {
  const validate = await workspaceManifestValidator();
  const ok = validate(value);
  return {
    ok: Boolean(ok),
    errors: ok ? [] : (validate.errors ?? []).map(formatError),
  };
}


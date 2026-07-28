import path from "node:path";
import { fileURLToPath } from "node:url";

// 本文件位于 <PixCode仓库>/cli/lib/，因此向上两级得到框架仓库根目录。
export const frameworkRepositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

// 业务项目将整个 PixCode 仓库挂载为 <工作区>/.pixcode submodule。
export const frameworkAssetsRoot = frameworkRepositoryRoot;


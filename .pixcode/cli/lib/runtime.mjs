import path from "node:path";
import { fileURLToPath } from "node:url";

// 本文件位于 <PixCode仓库>/.pixcode/cli/lib/，因此向上三级得到框架仓库根目录。
export const frameworkRepositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

// PixCode 当前仍以 .pixcode 作为框架能力源目录；作为 submodule 安装时，
// 仓库根目录通常是 <工作区>/.pixcode/runtime。
export const frameworkAssetsRoot = path.join(frameworkRepositoryRoot, ".pixcode");


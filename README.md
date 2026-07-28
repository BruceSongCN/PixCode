# PixCode

PixCode（`Pi × Code`）是一套轻量、Agent 中立的 AI 编程工程驱动框架。它对外提供统一的规格与交付工作流，内部集成项目本地 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 引擎，不要求用户全局安装或直接操作 OpenSpec。

业务项目把本仓库直接固定为 `.pixcode` Git Submodule，并在业务仓库根目录用 `manifest.json` 维护 Target 仓库清单。Target 仍是普通独立克隆，由 `pixcode targets bootstrap|status` 管理，不作为 submodule 嵌套。

PixCode 重点补充 OpenSpec 未覆盖的工程语境：

- 中文交付模板与可审计的模型、流程、契约、测试方案；
- 将归档变更合并为支持中文多级目录的 `pix-specs` 当前态功能规格；
- 多 Target、独立仓库与跨端协作规则；
- 基于需求场景的真实验证和测试交接；
- Git 忽略的个人本地/远程调试选择与环境诊断；
- Codex、Claude Code、OpenCode 等 Agent 宿主的可刷新 Skill 适配。

## 目录

```text
PixCode/
├─ cli/                           # 项目本地 CLI
├─ rules/                         # 通用 AI 行为规则
├─ skills/                        # 工具中立 Skill
├─ scaffolds/openspec/            # init 时生成 OpenSpec 运行目录
├─ templates/                     # 当前态功能规格归档模板
├─ schemas/                       # 工作区 Manifest 等机器契约
└─ pixcode.json                   # 框架与引擎版本
```

安装到业务项目后，上述目录整体位于 `.pixcode/`。`skills/` 是 Skill 的唯一事实来源，宿主适配目录中的副本不应手工维护。

PixCode 框架仓库只提供 `scaffolds/openspec/` 中的初始化源，不携带具体项目的 `openspec/`、`pix-specs/` 或 `src/`。这些内容均由使用框架的业务仓库管理。

## 快速开始

在空业务仓库中接入 PixCode、安装锁定依赖并创建工作区：

```powershell
git submodule add https://github.com/BruceSongCN/PixCode.git .pixcode
npm ci --prefix .pixcode
node .pixcode/cli/pixcode.mjs workspace init --name <workspace-name>
npm run --silent pixcode -- init --agent codex
npm run --silent pixcode -- doctor
npm run --silent pixcode -- validate --all
```

`workspace init` 只创建缺失的 `manifest.json`、`src/`、安全的 `.gitignore` 和最小 `package.json` 入口；已有文件会被保留并校验。OpenSpec、YAML 和 JSON Schema 校验器均由 `.pixcode/package-lock.json` 锁定，宿主根目录不重复声明这些运行依赖。

如果初始化时使用了 `--agent none`，可以随后为当前 Agent 宿主安装 PixCode Skill：

```powershell
npm run --silent pixcode -- adapters install codex
# 或：claude / opencode
```

常用确定性命令：

```powershell
npm run --silent pixcode -- status
npm run --silent pixcode -- change create warehouse-offline-inventory
npm run --silent pixcode -- validate warehouse-offline-inventory
npm run --silent pixcode -- archive warehouse-offline-inventory
npm run --silent pixcode -- capabilities finalize <归档目录名>
npm run --silent pixcode -- capabilities validate
npm run --silent pixcode -- debug status
npm run --silent pixcode -- debug doctor
npm run --silent pixcode -- debug gate apply
npm run --silent pixcode -- debug gate verify
```

规格内容和当前态语义合并仍由 Agent 按 Skill、规则、Schema 和模板理解后生成；CLI 只承担初始化、状态、校验、归档、映射、索引和宿主适配等确定性工作，不用硬编码代替 Agent 的业务判断。

## Agent 工作流

```text
$pixcode-workflow explore
$pixcode-workflow propose <description>
$pixcode-workflow update <change>
$pixcode-workflow review <change>
$pixcode-workflow apply <change>
$pixcode-verify-delivery <change>
$pixcode-workflow sync <change>
$pixcode-workflow archive <change>
```

普通解释、调查、缺陷修复和不改变共享业务语义的局部工程任务默认直接处理，不强制创建 SPEC。

进一步阅读：

- [功能交付示例：设备巡检任务](docs/功能交付示例-设备巡检任务.md)
- [PixCode 中文使用手册](docs/PixCode中文使用手册.md)

# PixCode

PixCode（`Pi × Code`）是一套轻量、Agent 中立的 AI 编程工程驱动框架。它对外提供统一的规格与交付工作流，内部集成项目本地 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 引擎，不要求用户全局安装或直接操作 OpenSpec。

业务项目建议把本仓库固定为 `.pixcode/runtime` Git Submodule，并在业务仓库自己的 `.pixcode/workspace.yaml` 中维护 Target 仓库清单。Target 仍是普通独立克隆，由 `pixcode targets bootstrap|status` 管理，不作为 submodule 嵌套。

PixCode 重点补充 OpenSpec 未覆盖的工程语境：

- 中文交付模板与可审计的模型、流程、契约、测试方案；
- 将归档变更合并为支持中文多级目录的 `pix-specs` 当前态功能规格；
- 多 Target、独立仓库与跨端协作规则；
- 基于需求场景的真实验证和测试交接；
- Codex、Claude Code、OpenCode 等 Agent 宿主的可刷新 Skill 适配。

## 目录

```text
.
├─ .pixcode/                      # PixCode 唯一能力源
│  ├─ cli/                        # 项目本地 CLI
│  ├─ rules/                      # 通用 AI 行为规则
│  ├─ skills/                     # 工具中立 Skill
│  ├─ scaffolds/openspec/         # init 时生成 OpenSpec 运行目录
│  ├─ templates/                  # 当前态功能规格归档模板
│  └─ pixcode.json                # 框架与引擎版本
├─ openspec/                      # pixcode init 后生成；不属于纯框架源码
│  ├─ config.yaml                 # 当前项目的规格配置
│  ├─ schemas/pixcode-delivery/   # PixCode Schema 运行副本
│  ├─ specs/                      # 已生效的当前需求事实
│  └─ changes/                    # 当前项目的活动变更与归档
├─ pix-specs/                     # 归档后生成的当前完整功能规格
├─ src/                           # 独立 Target 代码仓库
├─ package.json                   # 本地 OpenSpec 依赖与 PixCode 入口
└─ package-lock.json              # 可重复安装的依赖锁
```

`.pixcode/skills/` 是 Skill 的唯一事实来源。`.codex/`、`.claude/`、`.opencode/` 下的 PixCode Skill 由 CLI 生成，带管理标记，可安全刷新，不应手工维护。

`src/README.md` 随框架版本管理，`src/*/` 下接入的业务 Target 则保持为独立仓库。

PixCode 框架仓库只提供 `.pixcode/scaffolds/openspec/` 中的初始化源，不直接携带根目录 `openspec/`。执行 `pixcode init` 后生成的配置、Schema 运行副本、Change、Spec、归档、`pix-specs/` 和验证证据都属于具体项目，应由项目仓库版本管理，不回流到纯框架发行仓库。`history/` 仅用于本机备份，始终排除。

## 快速开始

克隆后安装锁定依赖并检查环境：

```powershell
npm ci
npm run --silent pixcode -- init --agent codex
npm run --silent pixcode -- doctor
npm run --silent pixcode -- validate --all
```

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

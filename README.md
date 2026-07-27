# PixCode

PixCode（`Pi × Code`）是一套轻量、Agent 中立的 AI 编程工程驱动框架。它对外提供统一的规格与交付工作流，内部集成项目本地 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 引擎，不要求用户全局安装或直接操作 OpenSpec。

PixCode 重点补充 OpenSpec 未覆盖的工程语境：

- 中文交付模板与可审计的模型、流程、契约、测试方案；
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
│  └─ pixcode.json                # 框架与引擎版本
├─ openspec/
│  ├─ config.yaml                 # 当前项目的规格配置
│  ├─ schemas/pixcode-delivery/   # 中文交付 Schema 与模板
│  ├─ specs/                      # 已生效的当前事实
│  └─ changes/                    # 活动变更与归档
├─ src/                           # 独立 Target 代码仓库
├─ package.json                   # 本地 OpenSpec 依赖与 PixCode 入口
└─ package-lock.json              # 可重复安装的依赖锁
```

`.pixcode/skills/` 是 Skill 的唯一事实来源。`.codex/`、`.claude/`、`.opencode/` 下的 PixCode Skill 由 CLI 生成，带管理标记，可安全刷新，不应手工维护。

`src/README.md` 随框架版本管理，`src/*/` 下接入的业务 Target 则保持为独立仓库。

PixCode 框架仓库只提供 `openspec/config.yaml` 和 `openspec/schemas/`。使用框架后生成的 `openspec/changes/`、`openspec/specs/` 和验证证据属于具体项目，应由项目仓库版本管理，不回流到 PixCode 框架仓库。`history/` 仅用于本机备份，始终排除。

## 快速开始

克隆后安装锁定依赖并检查环境：

```powershell
npm ci
npm run --silent pixcode -- doctor
npm run --silent pixcode -- validate --all
```

为当前 Agent 宿主安装 PixCode Skill：

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
```

规格内容仍由 Agent 按 Skill、规则、Schema 和模板理解后生成；CLI 只承担初始化、状态、校验、归档和宿主适配等确定性工作，不用硬编码代替 Agent 的业务判断。

## Agent 工作流

```text
$pixcode-workflow explore
$pixcode-workflow propose <description>
$pixcode-workflow update <change>
$pixcode-workflow apply <change>
$pixcode-verify-delivery <change>
$pixcode-workflow sync <change>
$pixcode-workflow archive <change>
```

普通解释、调查、缺陷修复和不改变共享业务语义的局部工程任务默认直接处理，不强制创建 SPEC。

进一步阅读：

- [功能交付示例：设备巡检任务](docs/功能交付示例-设备巡检任务.md)
- [PixCode 中文使用手册](docs/PixCode中文使用手册.md)

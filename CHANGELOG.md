# PixCode 变更日志

本项目采用语义化版本。`0.x` 阶段允许根据真实项目验证继续调整命令和资产约定，但每个版本仍应保持锁文件、文档、测试和 Git 标签一致。

## 0.7.1｜2026-07-28

- 已同步的 Schema 不再重复写入，避免 Windows 工作区在幂等初始化后出现无内容变更。

## 0.7.0｜2026-07-28

- 增加 `workspace init`，可从空业务仓库生成 `manifest.json`、`src/`、安全的 `.gitignore` 和最小 npm 命令入口。
- 用 JSON Schema 严格校验工作区 Manifest，未知字段和错误结构不再静默接受。
- 统一依赖所有权：OpenSpec、YAML 和 Ajv 只由 PixCode 子模块锁定和加载。
- Schema 初始化只刷新带 PixCode 管理标记的目录，拒绝覆盖同名用户资产。
- 归档要求任务完成、设计评审通过、交付验证和交付决定明确通过，不再提供绕过门禁的参数。
- Capability 改名或移动延迟到 `finalize`，`prepare` 阶段保留当前正式目录。
- 重建功能索引时清理已无对应 Capability 的 PixCode 生成索引和空分类目录。
- Target bootstrap 拒绝接管普通目录、损坏仓库和远端不匹配的仓库，并为 Git 调用增加错误和超时处理。
- Agent 宿主适配增加宿主清单、内容完整性和版本新鲜度检查，可发现被删除、篡改或升级后过期的 Skill。
- 新增以上行为的回归测试，并统一安装、升级和故障排查文档。

## 0.6.0｜2026-07-27

- 确立 `.pixcode` Submodule、根目录 `manifest.json` 和普通独立 Target 仓库的工作区结构。
- 提供 OpenSpec 初始化脚手架、PixCode 交付 Schema、中文评审资产和 `pix-specs` 当前态功能规格。
- 提供 PixCode 工作流、真实交付验证 Skill 以及 Codex、Claude Code、OpenCode 宿主适配。

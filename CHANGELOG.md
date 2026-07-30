# PixCode 变更日志

本项目采用语义化版本。`0.x` 阶段允许根据真实项目验证继续调整命令和资产约定，但每个版本仍应保持锁文件、文档、测试和 Git 标签一致。

## 0.8.3｜2026-07-30

- 将验证阶梯明确为 `Unit → Component Integration → Runtime Smoke`：组件层使用真实 DI、UnitOfWork、ORM 和隔离数据库但不启动 HTTP，API Smoke 只承担装配确认。
- 增加风险下沉门禁；Runtime 暴露的业务、ORM、事务、Seed 或并发缺陷必须先补入最低可复现测试层。
- 增加稳定产物单次构建、单次服务会话、数据库增量 Migration 和完整历史迁移每产物最多一次的执行预算。
- Manifest Profile 新增可选 `component` 命令，测试方案模板增加风险映射、构建复用、数据库策略和服务会话策略。

## 0.7.3｜2026-07-28

- 明确 `remote` 是部署后运行态调试与真实服务验证边界，不再把本地进程连接远端数据库视为远端调试。
- 增加 `debug gate apply|verify`，在实现和验证入口强制解析个人执行模式、诊断目标环境并输出不可回退的阶段约束。
- `pixcode-workflow apply` 与 `pixcode-verify-delivery` 强制执行环境门禁；远端部署入口或授权缺失时必须暂停。
- 验证模板增加执行模式、真实服务入口、部署标识/版本和契约/构建指纹；`validate` 对正向结论执行确定性校验，防止本地证据冒充远端交付。

## 0.7.2｜2026-07-28

- 增加 Git 忽略的 `workspace.local.json` 个人执行配置，严格区分团队共享 Manifest 与个人调试选择。
- 增加 `debug status`、`debug use` 和 `debug doctor`，支持 CLI、环境变量、个人配置、默认值四级解析。
- 远程调试仅通过非交互 SSH 做只读诊断；连接失败时禁止静默回退到本地。
- 增加个人调试配置 JSON Schema、初始化忽略规则和回归测试。

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

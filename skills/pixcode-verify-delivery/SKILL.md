---
name: pixcode-verify-delivery
description: 依据 PixCode change 的需求、测试方案和 Target 边界执行真实验证，整理 verification.md、验收结论与证据索引。用于实现完成后的 API、前端、契约、集成或端到端测试，以及正式测试交接；不用于编写需求、猜测测试数据或把未执行项目标记为通过。
---

# 验证 PixCode 交付

## 1. 锁定变更

先从用户最新指令确定执行模式。用户明确指定 local/remote 时把 `--mode` 传入：

```powershell
npm run --silent pixcode -- debug gate verify --json
npm run --silent pixcode -- debug gate verify --mode local --json
```

把返回的执行模式和目标环境作为本轮验证边界。显式模式与个人 Profile 冲突时，门禁优先改用该模式的项目默认 Profile；项目未声明时才进入无 Profile 的安全模式，此时只使用 Target 可确定的检查，数据库写入还必须有用户明确授权和可恢复 fixture。门禁失败时停止；`remote` 模式不得改用本地服务形成通过证据。
若门禁返回验证 Profile，必须使用其中声明的数据库隔离和通用环境命令。业务测试目录、服务清单和用例选择仍以当前 test-plan 为准。会写数据库但 Profile 未声明隔离生命周期时停止。

使用用户指定的 change；未指定时运行以下命令，只在唯一活动 change 可确定时继续：

```powershell
npm run --silent pixcode -- status --json
npm run --silent pixcode -- status "<change>" --json
```

确认 `tasks` 已完成或用户明确要求阶段性验证。读取 proposal、delta specs、solution、model、process、contracts、interaction、test-plan 和 tasks。

## 2. 解析验证范围

- 从 proposal 获取 Target，不使用框架预设名称。
- 从 Requirement 和 Scenario 推导用例，不按历史目录机械查找测试资产。
- 从 test-plan 获取环境、资源角色、数据特征、功能测试资产路径、最小服务拓扑和通过标准；Profile 不提供具体业务套件。
- 读取每个 Target 仓库最接近的规则、测试入口和现有自动化资产。
- 将通用资源角色绑定到当前环境 Provider；缺少环境、数据或凭证时暂停对应测试并如实记录。

## 3. 执行验证

按风险选择 `Code Inspection → Unit → Focused Integration → Runtime Smoke → Full Regression`，性能测试仅在方案声明阈值或用户明确要求时追加。后一层不得替代前一层：

- Code Inspection 检查本轮差异、目标规则、公开契约、注释文档、生成物一致性、静态分析和明显安全问题，阻断项未关闭时停止；
- Unit 覆盖业务规则和边界，不依赖服务或数据库；
- Focused Integration 优先运行 Profile 的 `focused`，用最小可回滚闭环覆盖仓储、事务、迁移、软删除、唯一约束和清理结果；
- Runtime Smoke 只启动验证当前风险所需的最少服务；remote 仅在测试方案要求时进入，并且只有实现产物自上次成功部署后变化才重新 Deploy；
- API 变更在 Runtime Smoke 核对实际公开契约；动态 OpenAPI 必须检查字段说明和枚举信息；
- 失败修复后只按 `case`、`tag` 或 `from-case` 重跑目标用例；
- 目标用例全部通过后只做一次 Full Regression。

数据库 reset、Fixture 变化和测试脚本修复不代表应用产物变化，不得据此重建全部服务。迁移变化确实需要应用启动时，使用项目显式的重启入口，并只重启受影响服务。

不适用层级写明依据，不为满足模板部署或启动 Scope 外系统。不得操作生产或未经授权的共享环境。写数据库前执行 Profile 的 `provision` 或 `reset`；用户授权 shared-instance 时使用唯一标识和可逆 fixture，结束后验证零残留。凭证不得写入证据。

完整日志写入 evidence 或临时文件；对话中只读取退出码、摘要、失败断言和最内层异常。优先使用增量构建、`--no-build`、quiet 模式及测试筛选。

`remote` 模式下：

- 先确认当前实现已通过获授权的项目入口部署到目标环境；无法确认时，把依赖该部署的验证标记为未执行或失败；
- API、页面、契约和集成验证必须命中远端真实服务，本地启动仅可作为辅助诊断；
- 保存实际服务地址、远端主机与工作区、部署标识或版本，以及 OpenAPI/构建产物的可复核指纹；
- 不得把“本地新代码连接远端数据库”记录为远端服务验证。

把可复用测试代码放在对应 Target 或独立测试扩展；把本轮大型运行产物放在：

```text
openspec/changes/<change>/evidence/<target>/<run-id>/
```

保留执行命令、环境标识、时间、退出码和关键输出。不要保存秘密。

## 4. 形成结论

读取 `openspec/config.yaml`、当前 Schema 的 `schema.yaml` 和 `templates/070-verification.md`，按模板生成 change 根目录的 `verification.md`：

- 只把真实执行且满足断言的项目标记为通过；
- 逐项关联 Requirement / Scenario、Target 和证据；
- 显式列出失败、未执行、阻断原因、影响和后续动作；
- 在“执行环境声明”中记录 gate 输出、实际服务入口、部署标识/版本和契约或构建指纹；不适用项写明依据；
- 记录每一验证层的命令、耗时和结果，区分定向重跑与最终完整回归；
- Code Inspection 未执行或存在未关闭阻断项时，结论不得为“通过”；
- 结论只使用“通过”“有条件通过”或“不通过”。

测试稳定后再一次性生成或更新 verification.md，最后运行：

```powershell
npm run --silent pixcode -- validate "<change>"
```

验证通过不等于自动授权归档；由用户通过 PixCode `archive` 动作完成归档。

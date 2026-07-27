---
name: pixcode-verify-delivery
description: 依据 PixCode change 的需求、测试方案和 Target 边界执行真实验证，整理 verification.md 与证据索引。用于实现完成后的 API、前端、契约、集成或端到端测试，以及正式测试交接；不用于编写需求、猜测测试数据或把未执行项目标记为通过。
---

# 验证 PixCode 交付

## 1. 锁定变更

使用用户指定的 change；未指定时运行以下命令，只在唯一活动 change 可确定时继续：

```powershell
npm run --silent pixcode -- status --json
npm run --silent pixcode -- status "<change>" --json
```

确认 `tasks` 已完成或用户明确要求阶段性验证。读取 proposal、delta specs、model、process、contracts、test-plan 和 tasks。

## 2. 解析验证范围

- 从 proposal 获取 Target，不使用框架预设名称。
- 从 Requirement 和 Scenario 推导用例，不按历史目录机械查找测试资产。
- 从 test-plan 获取环境、资源角色、数据特征和通过标准。
- 读取每个 Target 仓库最接近的规则、测试入口和现有自动化资产。
- 将通用资源角色绑定到当前环境 Provider；缺少环境、数据或凭证时暂停对应测试并如实记录。

## 3. 执行验证

先执行单 Target 最小验证，再执行适用的契约、集成和端到端场景。不得操作生产或未经授权的共享环境。

把可复用测试代码放在对应 Target 或独立测试扩展；把本轮大型运行产物放在：

```text
openspec/changes/<change>/evidence/<target>/<run-id>/
```

保留执行命令、环境标识、时间、退出码和关键输出。不要保存秘密。

## 4. 形成结论

读取 `openspec/config.yaml`、当前 Schema 的 `schema.yaml` 和 `templates/verification.md`，按模板生成 change 的 `verification.md`：

- 只把真实执行且满足断言的项目标记为通过；
- 逐项关联 Requirement / Scenario、Target 和证据；
- 显式列出失败、未执行、阻断原因、影响和后续动作；
- 结论只使用“通过”“有条件通过”或“不通过”。

最后运行：

```powershell
npm run --silent pixcode -- validate "<change>"
```

验证通过不等于自动授权归档；由用户通过 PixCode `archive` 动作完成归档。

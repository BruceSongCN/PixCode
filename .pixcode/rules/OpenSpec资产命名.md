# OpenSpec 资产命名

## 目标

OpenSpec 目录名服务于 CLI 稳定识别，中文标题和元数据服务于人工检索。每份资产必须同时具备机器标识和中文业务名称。

## 机器标识

- `module-id`、`feature-id`、Change 和 Capability 均使用小写英文 `kebab-case`。
- Capability 固定使用 `<module-id>-<feature-id>`，不得省略模块。
- 一个功能首次进入活动变更时，Change 默认使用 `<module-id>-<feature-id>`。
- 同一功能存在后续活动变更时，使用 `<module-id>-<feature-id>-<change-topic>`，其中 `change-topic` 必须表达具体变化。
- 不使用 `establish`、`add`、`update`、`modify` 等单独看不出变化内容的通用动作前缀。
- OpenSpec 原生 Change 目录不使用中文、空格、下划线或大写字母。

## 中文资产身份

proposal、delta spec、模型、流程、契约、测试方案、任务和验证报告必须在顶部包含：

| 属性 | 要求 |
| --- | --- |
| 标题 | `<模块中文名>｜<功能中文名>｜<资产类型>` |
| 模块 | 中文名和 `module-id` |
| 功能 | 中文名和 `feature-id` |
| Change | 完整 Change 标识 |
| Capability | 完整 Capability 标识 |
| Target | 本轮涉及的 Target；契约应区分提供方和消费者 |

同一 Change 内各资产的上述字段必须一致，不得只在 proposal 中出现中文名称。

## 导航

- Change 根目录 `README.md` 使用“模块中文名｜功能中文名”作为标题。
- README 简述本轮目标，并链接 proposal、spec、模型、流程、契约、测试方案、任务和验证报告。
- 尚未生成的条件资产应在索引中标明状态，不创建虚假的执行结果。
- `openspec/specs/` 中归档后的 Capability 继续使用相同的模块化机器标识和中文标题。

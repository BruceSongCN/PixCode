# <模块中文名>｜<功能中文名>｜测试方案

| 属性 | 内容 |
| --- | --- |
| Change | `<change-id>` |
| Capability | `<module-id>-<feature-id>` |
| Target | `<target-id>` |

## 测试范围与追溯

| Requirement / Scenario | 测试层级 | Target | 自动化 |
| --- | --- | --- | --- |
| `<引用>` | 单元 / API / 契约 / 集成 / E2E | `<target-id>` | 是 / 否 |

## 环境与拓扑

<!-- 服务、依赖和连接关系；不得包含真实凭证。 -->

| 验证 Profile | 数据库隔离 | 生命周期入口 | 数据残留标准 |
| --- | --- | --- | --- |
| `<profile>` | none / dedicated-container / shared-instance | provision / reset / status / destroy | 零残留 / <例外> |

## 验证阶梯与时间预算

| 阶段 | 项目命令 | 进入条件 | 目标时长 | 失败后的动作 |
| --- | --- | --- | --- | --- |
| Unit | `<command>` | 实现完成 | `<分钟>` | 修复并重跑失败测试 |
| Integration | `<command>` | Unit 通过、隔离库就绪 | `<分钟>` | 按 case/tag 定向重跑 |
| Deploy | `<command>` | Integration 通过 | `<分钟>` | 修复部署问题后重做 Smoke |
| Remote Smoke | `<command>` | 当前实现已部署 | `<分钟>` | 定向诊断，不启动完整回归 |
| Full Regression | `<command>` | 定向失败全部关闭 | `<分钟>` | 记录失败并停止交付 |
| Performance（可选） | `<command 或不适用>` | 已声明阈值 | `<分钟>` | 对照阈值给出结论 |

## 身份与数据

| 资源角色 | 所需特征 | 准备方式 | 清理方式 |
| --- | --- | --- | --- |
| `<role>` | <权限或数据特征> | <fixture / seed / 人工> | <回收方式> |

## Target 验证

### `<target-id>`

<!-- 验证入口、重点场景和预期证据。 -->

## 跨 Target 验证

<!-- 契约、集成和端到端场景；不适用时说明依据。 -->

## 自动化与人工边界

<!-- 哪些必须自动化，哪些允许人工验证，以及原因。 -->

<!-- 明确测试运行器的 case/tag/from-case 选择方式和最终完整回归入口。 -->

## 通过标准与阻断条件

<!-- 失败、未执行、证据缺失和允许遗留项的处理规则。 -->

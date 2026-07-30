# <模块中文名>｜<功能中文名>｜测试方案

| 属性 | 内容 |
| --- | --- |
| Change | `<change-id>` |
| Capability | `<module-id>-<feature-id>` |
| Target | `<target-id>` |

## 测试范围与追溯

| Requirement / Scenario | 测试层级 | Target | 自动化 |
| --- | --- | --- | --- |
| `<引用>` | 代码检查 / 单元 / 组件集成 / API Smoke / 契约 / E2E | `<target-id>` | 是 / 否 |

## 风险下沉设计

| 风险 | 最低覆盖层 | 真实依赖 | Runtime 仅确认 |
| --- | --- | --- | --- |
| `<业务分支、错误码、回退或映射>` | Unit | 无 | 不重复业务组合 |
| `<仓储、事务、并发、Seed、迁移或约束>` | Component Integration | 真实 DI / UnitOfWork / ORM / 隔离数据库 | HTTP 装配 |
| `<路由、鉴权、序列化、进程配置或 OpenAPI>` | Runtime Smoke | 最少服务拓扑 | 对应装配风险 |

## 环境与拓扑

<!-- 服务、依赖和连接关系；不得包含真实凭证。 -->

| 验证 Profile | 数据库隔离 | 生命周期入口 | 数据残留标准 |
| --- | --- | --- | --- |
| `<profile>` | none / dedicated-container / shared-instance | provision / reset / status / destroy | 零残留 / <例外> |

<!-- Profile 只描述通用环境。具体测试资产与服务拓扑必须由本轮 Change 显式声明。 -->

| 测试资产路径 | 最小服务拓扑 | 执行环境 | 进入条件 |
| --- | --- | --- | --- |
| `<Target 内明确路径>` | `<仅列必需服务>` | local / remote | `<何时才需要远端或运行态验证>` |

## 实现反馈环

| 项目 | 内容 |
| --- | --- |
| 范围 / 非目标 | `<Target 和本轮实现>` / `<不做的授权、部署、联调或重构>` |
| Quick 入口 | `<最快增量构建、静态检查或快速测试命令>` |
| Component 入口 | `<不启动 HTTP，使用真实 DI / UnitOfWork / ORM 的定向命令>` |
| Focused 场景 | `<最小业务闭环：准备 → 操作 → 状态变化 → 撤销/清理 → 零残留>` |
| 最少运行拓扑 | `<只列该场景必须启动的服务和替身>` |
| 反馈预算 | `<首次结果分钟数；超过后的诊断动作>` |
| 构建复用 | `<首次构建命令、产物指纹、后续 no-build/no-restore 入口>` |
| 数据库策略 | `<日常增量 Migration；何时允许一次完整历史重建>` |
| 服务会话策略 | `<单次启动批量 Smoke；允许重启的条件>` |
| 远端触发条件 | `<默认不进入；仅列兼容性、跨服务或最终交付需要>` |
| 重新部署条件 | `<仅实现产物或运行配置变化；数据、用例和文档变化不部署>` |

## 验证阶梯与时间预算

| 阶段 | 项目命令 | 进入条件 | 目标时长 | 失败后的动作 |
| --- | --- | --- | --- | --- |
| Code Inspection | `<command>` | 实现完成 | `<分钟>` | 修复全部阻断项 |
| Unit | `<command>` | Code Inspection 通过 | `<分钟>` | 修复并重跑失败测试 |
| Component Integration | `<component；兼容 focused>` | Unit 通过、fixture 就绪 | `<分钟>` | 补最低层回归并定向重跑 |
| Runtime Smoke | `<command 或不适用>` | Component 通过；存在装配风险；remote 已部署 | `<分钟>` | 保持单次服务会话，只重做必要 Smoke |
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

<!-- 明确 quick/focused、case/tag/from-case 和最终完整回归入口；local 不默认要求 Deploy。 -->

## 通过标准与阻断条件

<!-- 失败、未执行、证据缺失和允许遗留项的处理规则。 -->

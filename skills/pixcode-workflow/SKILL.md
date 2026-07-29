---
name: pixcode-workflow
description: 统一驱动 PixCode 规格工作的探索、提案、设计评审、修订、实现、同步和归档。用于用户明确要求进入规格流程、创建或维护 change、组织正式评审、按确认后的规格实现，或同步及归档交付资产；不用于普通解释、调查、局部修复，也不替代真实交付验证。
---

# 驱动 PixCode 工作流

## 1. 识别动作

根据用户意图选择且只执行一个动作：

| PixCode 动作 | OpenSpec 底层能力 | 边界 |
| --- | --- | --- |
| `explore` / 探索 | explore | 只调查和讨论，不实现代码，不自动创建 change |
| `propose` / 提案 | propose | 创建 change，生成达到正式评审条件的需求、设计和测试方案 |
| `update` / 修订 | update | 只修订已有规划资产并保持一致，不实现代码 |
| `review` / 评审 | PixCode 扩展 | 正式评审需求、综合设计和测试方案，记录问题、决定与准入结论 |
| `apply` / 实现 | apply | 依据当前 change 和任务修改对应 Target |
| `sync` / 同步 | sync | 将 delta spec 智能合并到主 specs，不归档 |
| `archive` / 归档 | archive | 归档过程资产，并把有效结论合并发布到 `pix-specs/` |

动作不明确时先澄清。用户只是讨论想法时使用 `explore`；不得因为任务复杂而自动升级为 `propose`。

真实测试与证据整理不属于本 Skill。需要验证时读取相邻的 `../pixcode-verify-delivery/SKILL.md`。

## 2. 使用 PixCode 项目命令

所有确定性操作通过项目本地入口执行，不调用全局 `openspec`：

```powershell
npm run --silent pixcode -- doctor
npm run --silent pixcode -- status [change] --json
npm run --silent pixcode -- change create <change>
npm run --silent pixcode -- validate [change]
npm run --silent pixcode -- archive <change>
npm run --silent pixcode -- capabilities finalize <archive>
npm run --silent pixcode -- capabilities validate
```

命令不可用时先提示业务项目执行 `npm ci --prefix .pixcode`（框架仓库自身开发执行 `npm ci`），不要调用全局 OpenSpec，也不要临时复制上游 Skill。

## 3. 执行动作

### explore

调查代码和现状，澄清范围、风险、Target 与是否值得进入 SPEC。不得创建资产或实现代码。

### propose

1. 读取 `.pixcode/rules/`、`openspec/config.yaml` 和默认 Schema 的 `schema.yaml`。
2. 执行 `change create` 建立 change。
3. 按 Schema 中 `requires` 的拓扑顺序生成 proposal、pixcode 映射、delta specs、design 和 test-plan，形成 review-ready 资产。
4. 每份资产同时遵守 Schema 的 instruction、项目 config 规则和中文资产命名规则。
5. 生成初始 `review.md` 时状态必须保持“待评审”，不得自行批准。
6. 执行 `validate <change>`；修复资产一致性问题，但不得伪造需求或评审决定。

### update

读取该 change 的全部现有资产和 Schema 依赖图，把用户的新决定同步到所有受影响资产。只修改规划资产，不实现代码。完成后严格校验。

### review

1. 读取 proposal、delta specs、design、test-plan 和 `pixcode.yaml`。
2. 逐项评审需求范围、功能方案、流程状态、模型字段、API 契约、交互、多 Target 边界和测试可执行性。
3. 将问题分为阻断或建议，记录决定、责任角色和状态；设计决定必须同步回对应资产。
4. 只有真实评审后才能把 `review.md` 标记为“通过”“有条件通过”或“不通过”。
5. 有条件通过必须明确条件和关闭方式；存在未关闭阻断问题时不得生成 tasks 或进入 apply。
6. 评审允许实施后生成 `tasks.md`，并重新严格校验。

### apply

1. 从用户最新指令确定本轮执行模式；用户明确指定 local/remote 时把 `--mode` 传给 `debug gate apply`，否则使用个人选择或项目的 local 默认 Profile。读取目标环境和 Profile 命令；门禁失败时停止，不得静默切换。
2. 确认 `review.md` 已真实通过且没有未关闭阻断问题，再读取 proposal、specs、design、test-plan 和 tasks。
3. 开始修改前在工作更新中锁定 Target、范围、非目标、数据库授权和外部写操作。设计未要求的权限、部署、远程环境或联调不得自行加入。
4. 从 test-plan 选择最小垂直切片和可恢复 focused 场景。默认在 local 使用 Profile 的 `quick` 或 Target 最短入口；实现该切片后立即运行可在当前环境完成的 focused。
5. 自动化测试与对应实现任务相邻完成。不得先完成全部代码、迁移和交付资料，再首次运行正向业务流程。
6. 修复失败时只定向重跑。相同失败连续两次后停止盲目重建，读取最内层异常、失败 SQL 或断言并确认根因；完整回归和 verification 留到实现稳定后。
7. 远端不是逐次实现反馈环。只有 test-plan 声明远端兼容性、跨服务或最终交付风险，且本地检查和定向测试已稳定时，才部署当前实现；测试数据、用例或文档调整不得触发重新部署。
8. 部署时只启动当前场景明确需要的服务；同一产物已成功部署时直接定向重跑。数据库 reset 默认不重建应用容器，只有迁移或启动配置变化时显式重启。
9. 部署、重启、远端迁移或共享数据库写入必须同时满足用户授权和项目安全入口。缺少任一条件时暂停相关步骤。
10. 若实现需要改变已确认业务语义或共享契约，停止并转入 update 和 review。

### sync

将 delta spec 的 ADDED、MODIFIED、REMOVED、RENAMED 语义合并到 `openspec/specs/` 当前事实；不移动 change，不复制无关设计文档。完成后校验主 spec 和活动 change。

### archive

1. 先使用 `pixcode-verify-delivery` 完成真实验证。
2. 检查 change 根目录 `pixcode.yaml`：Capability ID、中文路径、create/update 和受影响 assets 必须准确。
3. 执行 `archive <change>`。命令完成 OpenSpec 原生归档并为每个 Capability 准备 `pix-specs/` 合并计划。
4. 读取命令返回的 archive、当前 `openspec/specs/<capability>/spec.md`、归档设计资料和既有 `pix-specs`。
5. 按 `.pixcode/templates/capability-baseline/` 将增量语义合并为当前完整结论：
   - 需求基线以同步后的 OpenSpec Spec 为准；
   - 只修改 `pixcode.yaml` 中列出的 assets；
   - create 生成完整 `010`—`080`，update 保留未受影响资产；
   - 不把最后一轮过程文档机械覆盖当前结论；
   - 删除 ADDED/MODIFIED、“本轮”和“待实现”等过程表达；
   - 无法判断合并关系时停止并请求决定。
6. 执行 `capabilities finalize <archive>`，让 CLI 先校验全部资产，再按新的 `publication_path` 执行必要的目录搬迁，写入 `capability.yaml`、生成 `090-变更追溯.md` 并重建多级索引。`prepare` 阶段不得人工提前移动既有目录。
7. 执行 `capabilities validate` 和全局 `validate --all`。

不得绕过未完成任务、未通过的设计评审、缺失或未通过的交付验证以及严格校验失败。OpenSpec 已归档但语义合并中断时，使用 `capabilities prepare <archive>` 恢复，不重复归档。

## 4. 保持 PixCode 边界

- 对用户使用 PixCode 的动作名称和交付语义；必要时再说明底层由 OpenSpec 执行。
- `.pixcode/skills/` 是唯一 Skill 源；不得把宿主适配副本反向合并为源码。
- 不创建第二套 change 状态、编号、Schema 或归档协议。
- 读取 `.pixcode/rules/` 中与任务有关的规则，并读取目标代码仓库最接近的规则。
- 使用 OpenSpec 返回的 Target 和资产路径，不预设 `backend`、`frontend-web` 等项目名称。
- `apply` 只实现已经确认的内容；发现业务规则、模型或共享契约需要改变时，暂停实现并转入 `update`。
- `archive` 前确认真实验证结论；需求不可原地回退，如需撤销已生效需求，创建新的 change。
- `pix-specs/` 是当前完整结论，不是归档 Change 的副本；不得直接改写其业务语义。

## 5. 汇报结果

完成后简要说明：

- 执行的 PixCode 动作和 change；
- 创建、修改、实现、同步或归档的内容；
- 当前验证结果与剩余阻断；
- 推荐的下一个 PixCode 动作。

不要把 `/opsx:*` 作为默认下一步展示给用户；只有排查底层集成时才暴露 OpenSpec 原生命令。

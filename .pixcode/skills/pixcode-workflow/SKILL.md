---
name: pixcode-workflow
description: 统一驱动 PixCode 规格工作的探索、提案、修订、实现、同步和归档。用于用户明确要求进入规格流程、创建或维护 change、按确认后的规格实现，或同步及归档交付资产；不用于普通解释、调查、局部修复，也不替代真实交付验证。
---

# 驱动 PixCode 工作流

## 1. 识别动作

根据用户意图选择且只执行一个动作：

| PixCode 动作 | OpenSpec 底层能力 | 边界 |
| --- | --- | --- |
| `explore` / 探索 | explore | 只调查和讨论，不实现代码，不自动创建 change |
| `propose` / 提案 | propose | 创建 change，并按当前 Schema 生成达到 apply-ready 所需的全部资产 |
| `update` / 修订 | update | 只修订已有规划资产并保持一致，不实现代码 |
| `apply` / 实现 | apply | 依据当前 change 和任务修改对应 Target |
| `sync` / 同步 | sync | 将 delta spec 智能合并到主 specs，不归档 |
| `archive` / 归档 | archive | 检查资产、任务、验证和同步状态后归档 |

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
```

命令不可用时先提示执行 `npm ci`，不要调用全局 OpenSpec，也不要临时复制上游 Skill。

## 3. 执行动作

### explore

调查代码和现状，澄清范围、风险、Target 与是否值得进入 SPEC。不得创建资产或实现代码。

### propose

1. 读取 `.pixcode/rules/`、`openspec/config.yaml` 和默认 Schema 的 `schema.yaml`。
2. 执行 `change create` 建立 change。
3. 按 Schema 中 `requires` 的拓扑顺序读取相应 `templates/`，生成达到 apply-ready 所需的资产。
4. 每份资产同时遵守 Schema 的 instruction、项目 config 规则和中文资产命名规则。
5. 执行 `validate <change>`；修复资产一致性问题，但不得伪造需求决定。

### update

读取该 change 的全部现有资产和 Schema 依赖图，把用户的新决定同步到所有受影响资产。只修改规划资产，不实现代码。完成后严格校验。

### apply

读取 status、proposal、specs、设计、测试方案和 tasks，按依赖及 Target 分仓实现并勾选任务。若实现需要改变已确认业务语义或共享契约，停止并转入 update。

### sync

将 delta spec 的 ADDED、MODIFIED、REMOVED、RENAMED 语义合并到 `openspec/specs/` 当前事实；不移动 change，不复制无关设计文档。完成后校验主 spec 和活动 change。

### archive

先使用 `pixcode-verify-delivery` 完成真实验证，再执行 `archive <change>`。默认不得绕过未完成任务、缺失验证或严格校验失败；只有用户明确接受例外时才传 `--yes`。

## 4. 保持 PixCode 边界

- 对用户使用 PixCode 的动作名称和交付语义；必要时再说明底层由 OpenSpec 执行。
- `.pixcode/skills/` 是唯一 Skill 源；不得把宿主适配副本反向合并为源码。
- 不创建第二套 change 状态、编号、Schema 或归档协议。
- 读取 `.pixcode/rules/` 中与任务有关的规则，并读取目标代码仓库最接近的规则。
- 使用 OpenSpec 返回的 Target 和资产路径，不预设 `backend`、`frontend-web` 等项目名称。
- `apply` 只实现已经确认的内容；发现业务规则、模型或共享契约需要改变时，暂停实现并转入 `update`。
- `archive` 前确认真实验证结论；需求不可原地回退，如需撤销已生效需求，创建新的 change。

## 5. 汇报结果

完成后简要说明：

- 执行的 PixCode 动作和 change；
- 创建、修改、实现、同步或归档的内容；
- 当前验证结果与剩余阻断；
- 推荐的下一个 PixCode 动作。

不要把 `/opsx:*` 作为默认下一步展示给用户；只有排查底层集成时才暴露 OpenSpec 原生命令。

# AGENTS.md

PixCode（`Pi × Code`）是一套集成 OpenSpec 的轻量 AI 编程工程框架。PixCode 对外提供统一工作流；OpenSpec 在内部负责变更生命周期、delta spec、任务跟踪和归档，PixCode 补充中文交付模板、多 Target 协作规则和验证交接能力。

## 任务分流

- 默认直接处理解释、调查、缺陷修复、局部重构、构建配置和不改变业务语义或共享契约的实现调整。
- 只有用户明确使用 PixCode `propose`、明确要求创建或维护 SPEC，或明确指定某个 change 时，才创建或修改 `openspec/` 交付资产。
- 探索后若发现必须改变业务规则、持久化模型、权限、状态流程或跨 Target 共享契约，先说明原因并请求确认，不自动升级为 SPEC。
- 用户明确要求不做 SPEC 时，不创建或修改 OpenSpec 资产。

## PixCode 工作流

| 意图 | 入口 |
| --- | --- |
| 讨论和澄清想法 | `$pixcode-workflow explore` |
| 创建评审所需变更资产 | `$pixcode-workflow propose <description>` |
| 修订已有变更资产 | `$pixcode-workflow update <change>` |
| 正式设计评审 | `$pixcode-workflow review <change>` |
| 按已确认变更实现 | `$pixcode-workflow apply <change>` |
| 执行并汇总交付验证 | `$pixcode-verify-delivery <change>` |
| 不归档而同步当前事实 | `$pixcode-workflow sync <change>` |
| 验证完成后归档 | `$pixcode-workflow archive <change>` |

未安装命令别名时，直接读取 `skills/` 下对应 `SKILL.md`。默认 Schema 为 `pixcode-delivery`。不得另建平行的 Feature/Change 状态机、编号系统、门禁清单或基线合并协议。

所有确定性 PixCode 操作使用项目本地入口 `npm run --silent pixcode -- <command>`。作为 `.pixcode` Submodule 使用时，缺少依赖应提示执行 `npm ci --prefix .pixcode`；在 PixCode 框架仓库自身开发时执行 `npm ci`。不得依赖全局 `openspec` 命令。`skills/` 是唯一 Skill 源，宿主适配副本通过 `pixcode adapters install|refresh` 生成。

## 按需读取

- AI 能力目录边界：`docs/框架结构.md`
- 统一规格工作流：`skills/pixcode-workflow/SKILL.md`
- 真实验证与证据：`skills/pixcode-verify-delivery/SKILL.md`
- 任务分流与资产原则：`rules/直接任务与SPEC.md`
- Change、Capability 与中文资产标题：`rules/OpenSpec资产命名.md`
- 归档后的当前态功能规格：`rules/当前态功能规格.md`
- 多仓库、多 Target 协作：`rules/多目标交付.md`
- 测试计划、执行和证据：`rules/测试与证据.md`
- 具体代码风格、构建和测试命令：目标 `src/<target>/` 仓库内最接近的规则文件

## 不可绕过的边界

- `src/` 下项目是独立仓库，分别检查状态、修改、验证和提交。
- 保留用户已有改动，不清理或覆盖无关文件。
- 共享需求和契约只能在对应 OpenSpec change 中修改；实现任务不得用猜测改写已确认设计。
- `pix-specs/` 是归档后生成的当前完整结论；不得绕过 Change 直接修改其中的业务语义。
- 不提交凭证、生产数据和大型运行产物，不操作生产环境或未经授权的共享数据库。

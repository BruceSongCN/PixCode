# `.pixcode` PixCode 能力层

`.pixcode` 只保存 PixCode 自维护、可跨项目和 Agent 工具迁移的 AI 行为能力。它不重新实现 OpenSpec 生命周期，也不保存业务代码、项目技术栈或运行结果。

## 目录

```text
.pixcode/
├─ README.md
├─ pixcode.json                   # 框架、引擎和默认 Schema 版本
├─ cli/                           # 不发布 npm 包阶段的项目本地 CLI
│  ├─ pixcode.mjs
│  ├─ adapters/
│  ├─ lib/
│  └─ tests/
├─ rules/                         # Agent 必须遵守的通用行为边界
│  ├─ 直接任务与SPEC.md
│  ├─ OpenSpec资产命名.md
│  ├─ 多目标交付.md
│  └─ 测试与证据.md
└─ skills/                        # PixCode 公开工作流
   ├─ pixcode-workflow/           # 统一规格流程门面
   │  ├─ SKILL.md
   │  └─ agents/openai.yaml
   └─ pixcode-verify-delivery/    # 真实测试与交付证据
      ├─ SKILL.md
      └─ agents/openai.yaml
```

## 与其他目录的边界

| 目录 | 所有者 | 内容 |
| --- | --- | --- |
| `.pixcode/` | PixCode | 工具中立的通用 AI rules 和自定义 skills |
| `.codex/` / `.claude/` / `.opencode/` | 宿主适配 | PixCode CLI 生成的可刷新 Skill 副本 |
| `openspec/` | PixCode / OpenSpec | PixCode 管理、OpenSpec 执行的规格资产 |
| `src/` | 业务项目 | 各 Target 的代码、技术规则和测试实现 |

`.pixcode` 是 PixCode 能力的唯一事实来源，不采用任何单一 Agent 宿主的发现目录作为核心目录。Codex、Claude Code 或其他宿主需要自动发现这些能力时，应通过各自的安装器或适配层进行映射；不得在仓库中复制一份长期并行维护的 rules 或 skills。

Skill 继续采用通用的 `SKILL.md` 目录结构。Skill 内的 `agents/openai.yaml` 仅提供支持该元数据格式的宿主界面信息，不决定 PixCode 的目录位置，也不是执行 Skill 的前提。

PixCode 是 OpenSpec 的集成型扩展：`pixcode-workflow` 是公开门面，项目本地 OpenSpec 依赖负责底层生命周期。用户不需要全局安装或直接操作 OpenSpec。

宿主适配通过以下命令生成：

```powershell
npm run --silent pixcode -- adapters install codex
npm run --silent pixcode -- adapters install claude
npm run --silent pixcode -- adapters install opencode
```

生成目录包含 `.pixcode-managed.json`。CLI 只刷新带该标记的目录，不覆盖用户自有 Skill。

## 纳入规则

只有同时满足以下条件的内容才放入 `.pixcode`：

- 直接约束或扩展 AI Agent 的行为；
- 不依赖当前项目的业务名称和技术栈；
- 能被多个项目复用；
- 不与 OpenSpec 原生生命周期重复。

项目专属构建命令、服务地址、账号、Target 清单和技术 Adapter 应留在对应项目安装层或代码仓库。模板和 SPEC 资产属于 `openspec/`，测试日志和截图属于 change 的证据目录。

## 扩展约定

- Rule 使用中文文件名，单文件表达一个稳定关注点。
- OpenSpec 机器标识使用小写英文 kebab-case，人工导航通过中文标题、元数据和 README 索引完成。
- Skill 目录名和 frontmatter `name` 使用 lowercase-hyphen。
- Skill 保持精简，仅按需增加 `agents/`、`references/`、`scripts/` 或 `assets/`。
- 新增或修改 Skill 后执行 Skill 校验和 `npm test`。
- 修改 `.pixcode/skills/` 后运行 `npm run --silent pixcode -- adapters refresh`。

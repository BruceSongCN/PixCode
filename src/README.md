# Target 工作区

`src/` 用于放置当前工作区接入的业务 Target。每个一级子目录通常是一个独立 Git 仓库，例如：

```text
src/
├─ backend/
├─ frontend-web/
├─ caregiver-mobile/
└─ monitoring-screen/
```

PixCode 根仓库只跟踪本说明文件，不跟踪 `src/*/` 下的业务仓库。使用者按当前项目需要单独克隆 Target：

```powershell
git clone <target-repository-url> src/<target-id>
```

每个 Target 分别维护分支、提交、构建和测试。Target 的真实名称和技术约束以对应仓库规则及当前 change 为准，PixCode 不预设技术栈。

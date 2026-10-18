# session-hud

[![version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fjasoncai0%2Fclaude-session-hud%2Fmain%2F.claude-plugin%2Fplugin.json&query=%24.version&label=version)](.claude-plugin/plugin.json)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-%E2%89%A5%202.1.29x-d97757)](https://claude.com/claude-code)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> A Claude Code mod that keeps one HUD above the prompt — rate-limit usage, the Codeup MRs of the branches you are on, the Feishu docs the session touched and the Yunxiao (AppStack) releases it triggered — in the Claude Desktop Code tab and the terminal.

Claude Code 的一个 mod：在**输入框上方**常驻一块 HUD，把当前会话相关的四类信息放在一处：

| 模块 | 显示什么 |
| --- | --- |
| **用量** `usage` | 5h / 7d 限额进度条与重置倒计时 |
| **Codeup MR** `mr` | 会话涉及仓库当前分支的合并请求，可展开合入、落后、源分支删除、冲突、评审等检查 |
| **飞书文档** `docs` | 本会话创建或提到的飞书 / Lark 文档，点标题直达 |
| **云效发布** `deploy` | 本会话触发（或跟踪）的 AppStack 发布，显示阶段链接和运行到哪一步 |

**Claude Desktop 的 Code 标签页**和**终端**都能显示（基于 statusLine 的 HUD 在 Desktop 里不显示）。它合并并取代了 [`usage-hud`](https://github.com/jasoncai0/claude-usage-hud) 与 [`codeup-mr`](https://github.com/jasoncai0/claude-codeup-mr)。

## 目录

- [预览](#预览)
- [快速开始](#快速开始)
- [特性](#特性)
- [模块](#模块)
- [交互](#交互) · [命令](#命令) · [配置](#配置)
- [依赖](#依赖) · [网络与隐私](#网络与隐私) · [排错](#排错) · [已知限制](#已知限制)
- [开发](#开发) · [更新记录](#更新记录)

## 预览

> 示例数据均为虚构。

展开：

```
▾ 5h ███░░░ 55% ↻1h41m   7d █░░░░░ 21% ↻2d11h
  ⑂ !128   待合并  backend/demo-api    feature/user…-permission → release/online   +422 -10  ✓ 检查 ⌄  ×
  ⑂ !129   评审中  backend/demo-api    feature/user…-permission → release/prod     +422 -10  ○ 检查 ⌄  ×
  ▤ 文档   创建    用户资料权限设计方案                                                   ×
  ◈ 知识库 提及    Q4 迭代计划                                                           ×
  ⌄ 展开另 2 篇文档
  ⇪ prod   运行中  demo-api            release/online             ◐ 灰度人工卡点 (5/9)  ◐ 检查 ⌄  ×
```

点 MR 的 `检查 ⌄`，原地展开检查项（同时从 Codeup 重新拉取）：

```
  ⑂ !128   待合并  backend/demo-api    feature/user…-permission → release/online   +422 -10  ○ 检查 ⌃  ×
             ○ 待合入 3 个提交
             ○ 落后 release/online 9 个提交
             ✓ 源分支存在
             ✓ 合并冲突检查
             ○ 评审 1/2
```

点左上角 `▾` 折叠成一行摘要：

```
▸ 5h 55% 7d 21% · ⑂!128 ○ ⑂!129 ○ · ▤ 文档 4 (创建 1) · ⇪demo-api·prod ◐
```

## 快速开始

1. 在**终端**的 Claude Code 会话里安装（Desktop 的 Code 标签页不支持 `/plugin`），提示添加 marketplace 时输入 `y`，范围选 **user**：

   ```
   /plugin install session-hud --marketplace jasoncai0/claude-session-hud
   ```

2. 如果装过 `usage-hud` / `codeup-mr`，先卸载，否则会显示两遍（云效 token 读取方式不变，无需重新配置）：

   ```bash
   claude plugin uninstall usage-hud@claude-usage-hud
   ```

   ```bash
   claude plugin uninstall codeup-mr@claude-codeup-mr
   ```

3. **新开一个会话**（终端或 Desktop 均可），输入 `/hud` 查看各模块状态。

也可以不进 Claude Code，直接在 shell 里安装：

```bash
claude plugin marketplace add jasoncai0/claude-session-hud
```

```bash
claude plugin install session-hud@claude-session-hud --scope user
```

**更新**（只对之后新开的会话生效）：

```bash
claude plugin marketplace update claude-session-hud
```

```bash
claude plugin update session-hud@claude-session-hud
```

## 特性

- **一行一条、列宽固定**：每行固定一行高；仓库、分支、文档标题超长时以 `…` 截断（分支名从中间截，保留首尾），**鼠标悬停显示全文**。MR、文档、发布三类行共用同一套列，上下对齐。
- **窄屏自适应**：区域比配置的列宽窄时，名称列按比例收缩（先收掉仓库列），右侧的「检查」「×」始终可见。
- **超出行数原地展开**：超过最多行数时，最后一行是 `⌄ 展开另 N …` 按钮，点开就地显示全部，`⌃ 收起` 复原。
- **模块独立启停**：`/hud mr off` 即可关掉某个模块；关掉的模块不注册任何工作，不轮询，也不调接口。
- **细粒度配置**：20 个配置项，涵盖显隐、列宽、最多行数、轮询间隔等，Desktop 里用 `/hud set` 修改。
- **可折叠**：一键折叠成一行摘要；默认是否折叠也可配置。
- **与其他插件共存**：HUD 叠在其他插件的输入框上方内容之上，不替换它们；出现问卷时自动让位。

## 模块

### `usage` 用量

- 每个限额窗口一组：`5h` / `7d`（经网关时还有 `额度`），6 格进度条，< 70% 绿、70–90% 黄、≥ 90% 红
- `↻1h41m` 为距离重置的倒计时；重置时间已过（会话空闲后读数过期）的窗口自动隐藏
- 数据随 Claude Code 的 `session.measure` 推送，**不轮询、不额外消耗 token**

### `mr` Codeup 合并请求

**涉及哪些仓库**：当前工作目录所在仓库，加上会话中编辑过文件、或通过 `cd <dir>` / `git -C <dir>` 操作过的仓库（绝对路径或 `~/`），最多 5 个。只识别 `origin` 指向 `codeup.aliyun.com` 的仓库（ssh / https 均可）。

**显示哪些 MR**：

- 以上述仓库**当前分支**为源分支的 MR。有未关闭的就显示未关闭的（同一分支合往多个目标分支时各一行，最多 3 条）；全部已关闭时显示最近一条已合并 / 已关闭的。
- **本会话创建的 MR**，无论在哪个目录、哪个分支创建：识别到创建 MR 的调用（`codeup-create-change-request`、对 `changeRequests` 接口的 POST、`git push -o merge_request.create`）后，按「作者 = 当前令牌所属用户、创建时间不早于这次调用」查出新建的 MR 并固定显示。不依赖调用的输出格式。
- **提到的 MR**：消息、Claude 的回答或命令输出里出现的 Codeup MR 链接（`https://codeup.aliyun.com/…/change/<编号>`）。

| 列 | 说明 |
| --- | --- |
| `⑂` | MR 图标，颜色随状态；终端里也可点击跳转 |
| `!128` | MR 编号，**点击打开 MR** |
| 状态 | 草稿 / 评审中 / 待合并 / 已合并 / 已关闭 |
| 仓库 | `group/repo`，可用 `mrRepo` 关闭 |
| 源 → 目标 | 分支名，超长时中间截断，悬停看全 |
| `+422 -10` | MR 的增删行数（同 `git diff --shortstat target...source`），分支有新提交时才重新计算 |
| `检查 ⌄` | 展开 / 收起检查项，按钮上的符号取最差一项：`✕` > `○` > `✓` |
| `×` | 在本会话中隐藏这条 MR |

**检查项**（点「检查」时会立即从 Codeup 重新拉取）：

| 检查 | 未关闭的 MR | 已合并的 MR | 已关闭的 MR |
| --- | --- | --- | --- |
| 合入 | ○ 待合入 N 个提交 | ✓ 已合入 目标分支 | ✕ 未合入（MR 已关闭） |
| 同步 | ○ 落后 目标分支 N 个提交 / ✓ 已同步 | — | — |
| 源分支 | ✓ 源分支存在 / ✕ 源分支已删除 | ○ 源分支未删除 / ✓ 源分支已删除 | ○ 源分支未删除 / ✓ 源分支已删除 |
| 合并规则 | Codeup 的合并要求，如「合并冲突检查」 | 同左 | 同左 |
| 冲突 | ✕ 存在冲突 | — | — |
| 评审 | `评审 1/2`：全部通过为 ✓，有人拒绝为 ✕，否则 ○ | 同左 | 同左 |
| 评论 | ○ 未解决评论 N | 同左 | 同左 |

**刷新时机**：会话开始、每轮对话结束、每 `mrPollSeconds` 秒，以及点「检查」或执行 `/mr` 时。

### `docs` 飞书文档

**创建**的文档（绿色「创建」）来自：

- Bash 里的 `lark-cli … +create` / `+import` / `+copy` / `+duplicate`（可带全局参数，如 `lark-cli --as user docs +create`）。取输出里新出现的文档链接，失败的调用不计。
- 名称含 `lark` / `feishu` 且含 `create` / `import` / `copy` 的 MCP 工具。

**提及**的文档（灰色「提及」）来自：

- 你发送的消息
- Claude 每轮的最终回答
- lark-cli / Lark MCP 调用参数里的文档链接（搜索类命令输出里的大量链接不计入）

**识别的链接**：`*.feishu.cn`、`*.larksuite.com`、`*.larkoffice.com`、`*.feishu.net` 下的 `docx` / `doc(s)` / `wiki` / `sheets` / `base` / `bitable` / `mindnote(s)` / `slides` / `file`。`/wiki/settings/…` 这类非文档页面不会误识别。

**每行**：类型图标 · 类型（文档 / 知识库 / 表格 / 多维表 / 脑图 / 幻灯片 / 文件）· 创建 / 提及 · **标题（点击打开，悬停看全）** · `×`。类型和「创建 / 提及」分别对齐 MR 行的编号列与状态列。

**标题从哪来**：每轮结束后在后台调用 `lark-cli drive +inspect` 查询，wiki 节点会解析到实际文档。查到标题或确认无权限后不再查；超时等临时失败会在之后的轮次重试，最多 3 次（`/docs` 也会触发重试）。查到之前先显示链接文字（如 `[设计方案](https://…)` 中的「设计方案」），否则显示「类型 + token 前缀」。

每个会话保留全部「创建」的文档和最近 30 篇「提及」的文档；`docsMentioned` 设为 `off` 后只显示创建的。

### `deploy` 云效发布

**记录哪些发布**：本会话里在 Bash 中成功触发的 AppStack 研发阶段。

- **发布脚本**：命令中含 `deploy.sh <服务> <环境> [分支]`，且输出中有 AppStack 阶段链接或 `Flow run:` 运行链接（任一即可）。一条命令里可以有多次调用（逐条写或用循环），第 N 次调用对应输出中第 N 个链接；输出被 `grep` 过滤到只剩 `Flow run:` 行也能识别。命令带 `--dry-run` 时一律不计（dry-run 仍会打印已有运行的链接）。单次调用时，输出中的以下行会被读取，用来填环境、阶段名、分支和发布说明；多次调用时取命令里写明的服务、环境、分支（变量不取）：

  ```
   Env     : prod  (stage: 生产 / workflow: 标准发布流程)
   Branch  : release/online
   Feature : 本次发布说明
  Triggered. View: https://devops.aliyun.com/appstack/app/<应用>/workflow/<流程 SN>/stage/<阶段 SN>/current
  Flow run:      https://flow.aliyun.com/pipelines/<流水线 ID>/builds/<运行号>
  ```

- **直接调用 CLI**：`aliyun devops app-stack-execute-change-request-release-stage --app-name … --release-workflow-sn … --release-stage-sn …`，未失败且不是 `--cli-dry-run` 时计入。

**跟踪已有发布**（不会发布任何东西）：在消息里贴 AppStack 阶段链接，或执行 `/deploys <阶段链接>`，即跟踪该阶段**最新一次执行**。适合查看在网页上或别的会话里触发的发布。环境由阶段名推出（生产阶段 → prod），分支取自这次运行。

再次触发或跟踪同一个阶段时，这一行会重新开始。每个会话保留最近 10 次发布。

| 列 | 说明 |
| --- | --- |
| `⇪` | 颜色随运行状态 |
| 环境 | `prod` / `pre` / `test`，对齐 MR 的编号列 |
| 状态 | 查询中 / 运行中 / 待确认 / 成功 / 失败 / 已取消，对齐 MR 的状态列 |
| 应用 | AppStack 应用名，**点击打开该阶段的 AppStack 页面**（只有 Flow 运行链接时打开 Flow 运行页） |
| 分支 | 本次发布的分支，超长时中间截断 |
| 进度 | 停在或正在执行的任务，以及已完成数 / 总任务数，如 `✕ 灰度人工卡点 (5/9)`；全部完成时显示最后一个任务 `✓` |
| `检查 ⌄` | 展开各阶段下每个任务的状态，并**立即重新查询**（已结束的运行也会查） |
| `×` | 在本会话中隐藏这次发布 |

**状态从哪来**：已知 Flow 运行（输出里有 `Flow run:` 链接）时，直接查这次运行（`pipelines/{ID}/runs/{运行号}`）。否则先查该阶段最新一次执行（开始时间不早于触发时间，允许 2 分钟时钟误差），找到后记下执行序号，再查这次执行的流水线运行（`executions/{序号}:getPipelineRun`）。两种方式都能拿到各阶段、各任务的状态。

**刷新时机**：触发后 5 秒查第一次；之后每 `deployPollSeconds` 秒只查**尚未结束**的运行，结束（成功 / 失败 / 已取消）后不再轮询；点「检查」或执行 `/deploys` 时立即查询。

## 交互

| 操作 | 效果 |
| --- | --- |
| 点左上角 `▾` / `▸` | 折叠 / 展开（仅本会话） |
| 悬停被截断的文字 | 显示全文 |
| 点 MR 的编号 | 打开 MR |
| 点文档标题 | 打开文档 |
| 点发布行的应用名 | 打开 AppStack 阶段页 |
| 点「检查」 | 展开 MR 检查项或发布任务，并重新拉取 |
| 点 `⌄ 展开另 N …` / `⌃ 收起` | 超出最多行数的 MR / 文档 / 发布原地展开或收起 |
| 点 `×` | 本会话内隐藏该行 |

## 命令

| 命令 | 作用 |
| --- | --- |
| `/hud` | 查看各模块开关、全部配置与帮助 |
| `/hud usage\|mr\|docs\|deploy on\|off` | 启停模块（写入插件配置，立即生效，新会话沿用） |
| `/hud fold` / `/hud unfold` | 折叠 / 展开本会话的 HUD |
| `/hud set <配置项> <值>` | 修改任一配置，如 `/hud set mrSourceWidth 30`、`/hud set collapsed on` |
| `/mr` | 以 markdown 链接列出本会话所有 MR |
| `/docs` | 以 markdown 链接列出本会话所有文档（顺带重试未取到的标题） |
| `/deploys` | 刷新并列出本会话的所有发布：状态、执行序号、AppStack 链接、当前任务 |
| `/deploys <阶段链接>` | 跟踪该 AppStack 阶段的最新一次执行（不发布） |

## 配置

Desktop 的 Code 标签页没有 `/config`，用 `/hud set` 修改；终端里这些字段也会出现在 `/config` 中。布尔值写 `on` / `off`；数字超出范围时取边界值。

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `usage` / `mr` / `docs` / `deploy` | `on` | 模块开关 |
| `collapsed` | `off` | 新会话默认折叠 |
| `usageReset` | `on` | 显示重置倒计时 |
| `mrMaxRows` | `3` | MR 最多行数，超出时可原地展开（1–10） |
| `mrRepo` | `on` | 显示仓库列 |
| `mrRepoWidth` | `18` | 仓库列宽，单位为字符格（6–60） |
| `mrSourceWidth` | `24` | 源分支列宽（6–80） |
| `mrTargetWidth` | `16` | 目标分支列宽（6–60） |
| `mrStats` | `on` | 显示增删行数 |
| `mrChecks` | `on` | 显示「检查」按钮 |
| `mrPollSeconds` | `60` | MR 轮询间隔，单位为秒（15–3600） |
| `docsMaxRows` | `3` | 文档最多行数，超出时可原地展开（1–10） |
| `docsTitleWidth` | `40` | 文档标题列宽（10–120） |
| `docsMentioned` | `on` | 显示提及的文档；`off` 时只显示创建的 |
| `deployMaxRows` | `3` | 发布最多行数，超出时可原地展开（1–10） |
| `deployPollSeconds` | `30` | 未结束发布的轮询间隔，单位为秒（10–600） |
| `token` | — | 云效个人访问令牌（敏感字段，存于系统安全存储）；只能在 `/plugin configure` 或 `/config` 中设置 |

## 依赖

- **Claude Code ≥ 2.1.29x**（mods API），Desktop Code 标签页或终端均可
- **`mr` / `deploy` 模块**需要云效个人访问令牌（`mr` 需要 Codeup 读权限，`deploy` 需要 AppStack 读权限），按以下顺序查找：
  1. 插件配置 `token`
  2. 环境变量 `ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN`
  3. `~/.zshrc`、`~/.zshenv`、`~/.zprofile`、`~/.bashrc`、`~/.profile` 中的 `export ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN=...`（Desktop 不继承 shell 环境变量，所以会读这些文件）
- **`deploy` 模块**还需要云效组织 ID，按以下顺序查找：环境变量 `ALIBABA_CLOUD_YUNXIAO_ORGANIZATION_ID`，shell 配置文件中的同名 export 行，最后取会话所在 Codeup 仓库 origin 中的组织 ID
- **`docs` 模块**显示链接无需额外依赖；显示标题需要已登录的 [`lark-cli`](https://github.com/larksuite/cli)，会在 `PATH`、`/opt/homebrew/bin`、`/usr/local/bin` 中查找

## 网络与隐私

- **Codeup / AppStack / Flow**：只调用 `openapi-rdc.aliyuncs.com` 上的只读接口。Codeup 部分包括仓库、MR 列表（按仓库，或按作者查本会话新建的）、MR 详情、对比、分支；AppStack 部分包括阶段列表、阶段执行列表、流水线运行；Flow 部分是流水线运行；另外会查一次令牌所属用户的 ID。插件**不会触发、取消或推进**任何发布。token 只放在请求头里。
- **飞书**：插件本身不发网络请求，标题查询通过本机的 `lark-cli` 完成，使用你自己的登录态。
- **不上报任何数据**。状态（MR、文档、发布、折叠展开）只保存在当前会话里。

## 排错

| 现象 | 原因与处理 |
| --- | --- |
| 看不到 HUD | 当前会话启动于安装之前，新开一个会话；再用 `/hud` 确认模块已开启 |
| 每行出现两遍 | 旧的 `usage-hud` / `codeup-mr` 没卸载，见[快速开始](#快速开始)第 2 步 |
| 显示「未找到云效 token」 | 按[依赖](#依赖)配置 token |
| 没有 MR 行 | 仓库 origin 不在 Codeup 上；当前分支没有 MR；或该 MR 不在仓库最新的 100 条之内。在别处创建的 MR，可以在消息里贴它的链接 |
| 文档只显示「文档 xxxxxxxx…」 | 未安装或未登录 `lark-cli`（终端执行 `lark-cli auth login`），或无该文档权限；临时失败会自动重试，也可执行 `/docs` 立即重试 |
| 发布行一直是「等待运行开始」 | 该阶段还没有新的执行（触发被排队或失败），点「检查」重查；或触发时间与执行开始时间相差超过 2 分钟 |
| 发布行显示「查询失败」 | 令牌没有 AppStack 读权限，或组织 ID 不对，见[依赖](#依赖) |
| 用量行不显示 | 还没有新的限额读数，发一条消息后就会出现 |

插件内部出错时会记录一行 `session-hud <模块>: <原因>`，可在 `claude --debug` 的日志里查到。

## 已知限制

- Codeup 的 MR 列表接口不支持按源分支过滤，因此每个仓库只扫描最新的 100 条 MR
- 不显示 Codeup 提交上的流水线（CI）状态：只有流水线把状态回写到提交上时，接口才会提供
- Desktop 中 MR 图标是 Svg，宿主不允许把 Svg 放进链接，所以要点编号跳转
- 发布模块只跟踪 AppStack 研发阶段；不经 AppStack 的纯 Flow 流水线发布暂不显示
- 发布模块只读：人工卡点需要到 AppStack 页面推进
- 旧版 `codeup-mr` 0.2 / 0.3 写进会话标题的 MR 徽标，本插件不再清理

## 开发

```
.claude-plugin/plugin.json   清单、userConfig（全部配置项）
types/index.d.ts             $.state 契约
hooks/register.tsx           入口：唯一调用 $ 的文件（引擎要求），事件分发、数据拉取、绘制组装
hooks/settings.ts            配置解析与默认值
hooks/hud.tsx                折叠条与 /hud 命令解析
hooks/ui.tsx                 共用列宽、定宽截断单元格（悬停显示全文）、原地展开
hooks/text.ts                按显示宽度截断（中文按 2 格计）
hooks/usage/                 用量格式化与绘制
hooks/mr/                    Codeup 解析、检查项、列宽自适应、绘制
hooks/docs/                  链接识别、去重合并、lark-cli 标题查询、绘制
hooks/deploy/                发布触发识别、执行匹配、运行状态映射、绘制
```

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

本地调试用 `claude --plugin-dir <本仓库目录>` 启动，或把目录加入 `CLAUDE_CODE_PLUGIN_DIRS`，保存后自动热重载。测试数据全部为虚构：不要在测试、示例或提交信息里写入真实的组织 ID、仓库、应用、文档链接或 token。

发布流程：
1. 在 `.claude-plugin/plugin.json` 中提升 `version`
2. 推送到 `main`
3. 使用方执行[快速开始](#快速开始)中「更新」的两条命令

## 更新记录

- **0.5.0**：发布识别支持一条命令多次 `deploy.sh`、输出只剩 `Flow run:` 行（直接查 Flow 运行状态），并排除 `--dry-run`；MR 模块显示本会话创建的 MR（按作者与创建时间查找，不依赖目录和分支）和消息、回答、命令输出里出现的 MR 链接
- **0.4.3**：README 重写（目录、快速开始、虚构示例数据），测试数据脱敏
- **0.4.2**：超出最多行数时改为原地「⌄ 展开另 N … / ⌃ 收起」按钮（MR、文档、发布通用）；文档标题查询遇到超时等临时失败会重试
- **0.4.1**：发布模块支持跟踪已有发布：在消息里贴 AppStack 阶段链接或执行 `/deploys <链接>`
- **0.4.0**：新增云效发布模块：AppStack 阶段链接、运行到哪个任务、未结束时自动轮询、「检查」展开全部任务并立即刷新；新增 `/deploys`
- **0.3.0**：「检查」新增合入状态、落后目标分支的提交数、源分支是否已删除；点「检查」时立即重新拉取
- **0.2.0**：去掉行尾的「打开」链接，MR 通过编号跳转、文档通过标题跳转；文档行与 MR 行列对齐
- **0.1.0**：合并 `usage-hud` 与 `codeup-mr`，新增飞书文档模块、定宽单行布局、模块独立启停、细粒度配置与折叠

## 许可证

[MIT](LICENSE)

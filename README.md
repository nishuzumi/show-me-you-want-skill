# smyw · show me you want

> 让 Agent 在写代码之前，先把「要改什么」画给你看，你直接在图上改，再把意见交回给它。

smyw 是一个给编码 Agent（Claude Code、DeepSeek Harness 等支持 `SKILL.md` 的 Agent）用的 skill。做一个会动到页面、交互流程或前后端接口的功能时，Agent 先读代码、写一份结构化的 spec，再生成一个**单文件 HTML 原型**：

- 按真实界面画出一整屏的线框，模块名和代码组件对得上；
- 改动处按编号画框：**黄 = 修改，绿 = 新增，红 = 删除**；
- 点开一处改动，看改动前后、改了哪些字段、相关交互和函数 / 接口；
- 你可以直接在图上拖动组件、把卡片改成弹窗、写批注、写整体风格意见，然后一键复制反馈发回给 Agent。

线框只表达「有哪些模块、放在哪、怎么触发」，**不是视觉稿**，实现时以项目自己的设计规范为准。

![画布总览](docs/screenshots/01-overview.png)

## 工作方式

```
你提需求
  → Agent 读代码，写 .smyw/<日期>-<名称>/spec.json
  → scripts/build.mjs 校验并生成 preview.html（纯前端单文件，离线可开）
  → 你打开 preview.html：看改动、拖动、改结构、批注、回答 Agent 的问题
  → 「反馈」页点「复制反馈」，粘贴回对话
  → Agent 用 scripts/apply-feedback.mjs 生成下一版 spec，重新 build
  → 你点「确认方案」后，Agent 才开始写代码
```

不需要服务端，也没有任何依赖，构建只需要 Node ≥ 18。

## 安装

把 `skills/smyw` 目录放到 Agent 读取 skill 的位置即可：

```bash
git clone https://github.com/nishuzumi/show-me-you-want-skill.git
cd show-me-you-want-skill

# Claude Code（所有项目可用）
ln -s "$PWD/skills/smyw" ~/.claude/skills/smyw
# 通用位置（不少 Agent 会读这里）
ln -s "$PWD/skills/smyw" ~/.agents/skills/smyw
# 也可以只给某个项目用
cp -r skills/smyw <你的项目>/.claude/skills/smyw
```

装好后，提一个会改动界面或接口的需求，或者直接说「先出个原型给我看看」，Agent 就会使用它。

## 先体验一下

仓库里带了两个已经生成好的示例，下载后用浏览器直接打开就能玩：

- [`skills/smyw/examples/helpdesk-ai/preview.html`](skills/smyw/examples/helpdesk-ai/preview.html)：一整屏的例子（客服工作台加 AI 建议回复）
- [`skills/smyw/examples/task-tags/preview.html`](skills/smyw/examples/task-tags/preview.html)：多页面的例子（整页新增 / 整页删除）

改了 spec 之后重新生成：

```bash
node skills/smyw/scripts/build.mjs skills/smyw/examples/helpdesk-ai/spec.json
```

## 功能导览

下面的截图都来自 `helpdesk-ai` 示例，可以用 `node tests/readme-shots.mjs` 重新生成。

### 1. 一整屏线框 + 编号改动

打开后是一张可以拖动、缩放的画布。每一屏按真实布局画出来（这里是「工单队列 + 工单详情 + 客户信息」），没改的模块也画成真实模块，只是不展开。

只有**最外层**改动的模块会画框编号；左侧是改动清单，和画布上的编号一一对应。拖动画布平移，滚轮上下移动，Ctrl / ⌘ + 滚轮缩放，「适应」把整张画布放进视口。

![画布总览](docs/screenshots/01-overview.png)

### 2. 点开一处改动，看前后对比

点编号或清单里的条目，画布会缩放到这一处，右侧打开详情：

- 改动前 / 改动后的局部线框；
- 「修改了什么」逐字段对比（这里是标题「回复」→「回复客户」）；
- Agent 写的说明、对应的代码组件；
- 「‹ 上一处 / 下一处 ›」逐个看过去。

![改动详情](docs/screenshots/02-change-detail.png)

### 3. 整块新增或删除，只框最外层

「AI 建议回复」整块是新的，所以只在最外层画一个绿框，里面的按钮、文字不再逐个标。详情里「改动前」显示「没有这个模块」。

详情底部还会列出**相关交互**（哪个按钮打开哪个弹层、属于哪个流程的第几步）和**涉及的函数 / 接口**。

![整块新增](docs/screenshots/03-whole-module-added.png)

### 4. 移动

「标记已解决」从页头挪到了回复框旁边：原位置是红色的「移出」，新位置是绿色的「移入」，详情里可以点「看另一处」跳过去。

![移动](docs/screenshots/04-moved.png)

### 5. 按钮 → 弹层的连线

弹窗、抽屉、下拉菜单、气泡画在页面右侧，从触发它的按钮画一条弯曲连线过去。一个弹层可以有多个触发按钮（这里「展开编辑」和「AI 润色」打开同一个抽屉），被删除的弹层用红色虚线。

![触发连线](docs/screenshots/05-trigger-links.png)

### 6. 函数、组件、淡化未改动

工具栏可以打开：

- **ƒ 函数**：每个元素背后的行为或接口占位，比如 `onClick → openDraftDrawer()`、`GET /api/tickets/:id/ai-draft`；
- **</> 组件**：每个模块对应的代码组件，比如 `<ReplyBox>`；
- **淡化未改动**：把没改的元素调淡，只突出改动。

![工具栏开关](docs/screenshots/06-toolbar-toggles.png)

### 7. 流程变化

「流程变化」把交互流程画成泳道（用户 / 前端 / 后端 / 数据库 / 外部服务），左右对比改动前后，同样用黄绿红标注。

![流程泳道](docs/screenshots/07-flows.png)

步骤上的「↗ 在界面上定位」会跳回画布，选中这一步发生的那个元素：

![从流程跳回界面](docs/screenshots/08-flow-jump-to-canvas.png)

### 8. 后端变化

模块 → 接口 / 函数 / 字段 / 配置，左右对比。

![后端变化](docs/screenshots/09-backend.png)

### 9. 直接改方案

顶部切到「编辑方案」，底部出现组件库。拖页面底板或空白处是平移，拖组件是挪位置。

![编辑模式](docs/screenshots/10-edit-mode.png)

按住一个组件拖动，鼠标旁边跟着组件名，蓝线标出会放在哪里（前面、后面或放进容器）：

![拖动组件](docs/screenshots/11-drag-component.png)

松手后，原来的位置变成红色「移出」，新位置是绿色「移入」，右侧可以继续改文字、类型、宽度、排列：

![拖动之后](docs/screenshots/12-after-drag.png)

觉得某个内联模块应该点按钮才出现？选中它，点「转为弹窗 / 下拉菜单 / 抽屉 / 气泡」：

![转为弹层](docs/screenshots/13-convert-options.png)

原位置会换成一个触发按钮，内容变成弹层，连线自动画好。按钮还可以再拖到别处：

![转换后](docs/screenshots/14-converted-to-modal.png)

所有修改都可以撤销 / 重做（Ctrl / ⌘ + Z）。

### 10. 批注

点任意元素，在右侧写批注，选分类（位置/布局、交互方式、组件类型、样式/风格、文案、功能缺失……）和级别（必须改 / 建议 / 疑问）。有批注的元素右上角会显示数量。

![批注](docs/screenshots/15-comment.png)

### 11. 整体意见、回答问题、复制反馈

「反馈」页汇总所有内容：

- 整体风格标签和意见（「和现有页面不统一」「信息密度过高」……），以及风格参考；
- Agent 列出的待确认问题，可以直接点选项回答；
- 全部批注，点位置可以跳回原处；
- 你对方案做的每一步修改。

![反馈页](docs/screenshots/16-feedback.png)

点「复制反馈」得到一段 Markdown，末尾附带你改完后的完整方案 JSON，粘贴到对话里发给 Agent 即可。没意见就点「确认方案，可以开始做」。

![复制反馈](docs/screenshots/17-copy-feedback.png)

### 12. 多个页面

一次改动涉及多个页面时，每个页面一块画板。整页新增是绿框，整页删除是红框。

![多页面](docs/screenshots/18-multi-page.png)

### 13. 窄窗口

在窄窗口里（比如 Agent 界面的侧边预览）画布占满宽度，改动清单收进「☰ 改动」按钮，详情浮在画布上。

![窄窗口](docs/screenshots/19-narrow-window.png) ![窄窗口里的详情](docs/screenshots/20-narrow-window-detail.png)

> 在沙箱预览里，浏览器可能不允许保存进度或自动复制。页面会提示；复制失败时会自动选中全部反馈，按 Ctrl / ⌘ + C 即可。

## 反馈回到 Agent 之后

Agent 会把你粘贴的反馈存成 `feedback-v<N>.md`，然后：

```bash
# 取出反馈里的完整方案，旧 spec 备份为 spec-v<N>.json，写入 version + 1
node skills/smyw/scripts/apply-feedback.mjs .smyw/<dir>/feedback-v1.md .smyw/<dir>/spec.json
# 落实批注后重新生成
node skills/smyw/scripts/build.mjs .smyw/<dir>/spec.json
```

「必须改」全部落实，「建议」不采纳要说明理由，「疑问」先回答再动手。

## spec 长什么样

一棵树同时描述改动前后，每个节点用 `change` 标注：

```json
{
  "id": "reply", "type": "form", "label": "回复客户", "component": "<ReplyBox>",
  "change": "modified", "before": { "label": "回复" },
  "children": [
    { "id": "reply-quick", "type": "select", "text": "快捷回复", "change": "removed" },
    { "id": "reply-polish", "type": "button", "label": "AI 润色", "change": "added",
      "fn": "openDraftDrawer({ mode: \"polish\" })" }
  ]
}
```

完整字段见 [`skills/smyw/references/spec-format.md`](skills/smyw/references/spec-format.md)，Agent 的使用说明见 [`skills/smyw/SKILL.md`](skills/smyw/SKILL.md)。`build.mjs` 会检查常见问题，比如 id 重复、modified 没写 before、用「（不变）」占位代替真实模块、弹层没写 trigger。

## 目录

```
skills/smyw/                  skill 本体（复制或链接这个目录即可）
  SKILL.md                    给 Agent 的使用说明
  references/spec-format.md   spec 和反馈格式
  scripts/build.mjs           spec.json → preview.html
  scripts/apply-feedback.mjs  从粘贴回来的反馈生成下一版 spec
  assets/                     运行时、样式、模板
  examples/                   helpdesk-ai（一整屏）、task-tags（多页面）
tests/
  e2e.mjs                     无头 Chrome 端到端测试
  readme-shots.mjs            重新生成 README 截图
docs/screenshots/             README 截图
```

## 开发

需要 Node ≥ 18 和 Google Chrome（其他路径用 `CHROME=/path/to/chrome` 指定）。

```bash
node tests/e2e.mjs            # 端到端测试
node tests/readme-shots.mjs   # 重新生成 docs/screenshots/
```

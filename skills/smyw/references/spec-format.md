# smyw（show me you want）spec 格式

spec 是一个 JSON 对象。只有 `title` 加上 `pages` / `flows` / `backend` 至少其中一项是必需的，其余字段都可选。

~~~jsonc
{
  "title": "任务管理：用标签替代分类",      // 预览标题
  "summary": "一两段话说明这次改动",        // 画布左侧「这次改什么」，可换行
  "stage": "prototype",                     // prototype（未实现）| implementing | done（实现后回顾）
  "version": 1,                             // 每次根据反馈修改后 +1
  "changes": [                              // 变更要点（写进反馈，供 Agent 对照）
    { "area": "frontend", "change": "added", "text": "新增标签管理页" }
  ],                                        // area: frontend | backend | data | api | flow | other；也可以直接写字符串
  "questions": [                            // 需要用户拍板的问题
    { "id": "q-color", "q": "标签要支持颜色吗？", "options": ["需要", "不需要"] }
  ],
  "pages": [ Page ],
  "flows": [ Flow ],
  "backend": [ Module ]
}
~~~

## 改动标注（所有层级通用）

页面、节点、流程、步骤、后端模块和条目都可以带这些字段：

| 字段 | 含义 |
|---|---|
| `change` | `added` / `removed` / `modified`，不写就是不变 |
| `before` | 只在 modified 时使用：被修改字段的**旧值**，例如 `{"label": "添加", "fn": null}`。`null` 表示改动前没有这个字段 |
| `movedTo` | 写在旧位置节点上（`change: "removed"`），指向新位置节点的 id |
| `movedFrom` | 写在新位置节点上（`change: "added"`），指向旧位置节点的 id |
| `note` | 一句话说明为什么改，会显示在元素下方（左侧显示删除的说明，右侧显示新增和修改的说明） |

渲染规则：左侧"改动前"隐藏 added 节点，并对 modified 节点套用 before；右侧"改动后"隐藏 removed 节点。颜色：左侧红色实线 = 删除/移出，红色虚线 = 修改前；右侧绿色实线 = 新增/移入，绿色虚线 = 修改后。

父节点被删除或新增时，子节点**不要**再逐个标注：预览只给最外层改动的模块画框编号（黄 = 修改，绿 = 新增，红 = 删除），里面的内容在点开详情后展示。

预览里的「改动单元」= 整页新增/删除的页面，或祖先都没改动的、最外层的改动节点。每个单元在画布上有一个编号，在左侧清单里有一条。

## Page

~~~jsonc
{
  "id": "inbox", "name": "工单工作台 · 打开一张工单", "route": "/tickets/:id",
  "width": 1440,             // 画布上这一屏的宽度（像素），默认 1280
  "change": "modified", "note": "...",
  "root": Node,              // 一般是 { "id": "...", "type": "page", "children": [...] }
  "overlays": [ Node ]       // 弹窗 / 抽屉 / 下拉菜单 / 气泡，各自用 trigger 指向打开它的元素 id
}
~~~

**一个 page = 用户看到的一整屏**（例如「侧栏 + 主面板」），按真实布局画：`root.layout: "row"`，侧栏 `w: "1/4"`。不同路由或模式才拆成不同的 page。

整页新增：`change: "added"`，左侧显示"改动前不存在"。整页删除：`change: "removed"`，右侧显示"将被删除"。

## Node（线框元素）

| 字段 | 说明 |
|---|---|
| `id` | 稳定、有语义、整个 spec 内唯一 |
| `type` | 见下表 |
| `label` | 显示的文字：按钮文字、标题、字段名、容器标题（用界面上真实的名字） |
| `component` | 代码里对应的组件 / 文件，如 `"<TicketQueue> TicketQueue.vue"`。顶层区域都要写，用户靠它把框和真实模块对上 |
| `text` | 输入框的占位文字或示例值；其他类型显示为灰色说明 |
| `fn` | 函数/行为/接口占位：`onClick → openEditor()`、`GET /api/tags` |
| `children` | 子节点（容器类型） |
| `layout` | `col`（纵向）/ `row`（横向）/ `grid`（配合 `cols`） |
| `w` | 宽度：`"1/4"` `"1/3"` `"1/2"` `"2/3"` `"3/4"` `"full"`，或 flex 权重数字 |
| `variant` | 按钮类：`primary` / `secondary` / `danger` / `ghost` / `icon` |
| `items` | nav / tabs / list / select / radio / menu 的条目。条目可以是字符串，也可以是 `{"label": "...", "change": "added"}` |
| `columns` | table 的列，格式同 items（适合表达"新增一列、删掉一列"） |
| `rows` | table 的占位行数，默认 2 |
| `lines` | text 的灰色占位行数 |
| `trigger` | overlay 节点：打开它的按钮 / 链接 id；多个按钮打开同一个弹层时写成数组，如 `["ai-edit", "reply-polish"]`。画布上会从每个按钮画一条弯曲连线到弹层 |

**type 取值**

- 容器：`page` `section` `row` `col` `grid` `card` `form` `list` `item` `nav` `tabs` `header` `footer` `sidebar` `toolbar` `panel` `group`（`row` `nav` `toolbar` `header` `footer` `item` 默认横向排列）
- 浮层（放在 `overlays` 里）：`modal` `drawer` `menu`（下拉菜单/二级菜单）`popover`
- 控件：`button` `link` `input` `textarea` `select` `checkbox` `radio` `toggle` `upload`
- 展示：`heading` `text` `image` `table` `chart` `stat` `badge` `tag` `icon` `divider`
- `placeholder`：带斜纹的虚线框。只用于「这里将来会有内容」之类的占位；**没改动的模块不要用它**，画成真实模块、不展开 children 即可（显示「内容不变，未展开」）

## Flow

~~~jsonc
{
  "id": "flow-create", "name": "创建任务", "change": "modified",
  "steps": [
    { "id": "c1", "actor": "user", "text": "点击「新建任务」", "node": "btn-new" },
    { "id": "c2", "actor": "frontend", "text": "展开新建卡片", "fn": "openCreate()", "change": "added" },
    { "id": "c4", "actor": "frontend", "text": "提交表单", "fn": "POST /api/tasks {title, tags}",
      "change": "modified", "before": { "fn": "POST /api/tasks {title, categoryId}" } },
    { "id": "c9", "actor": "backend", "kind": "decision", "text": "标签存在吗？不存在则创建" }
  ]
}
~~~

`actor` 决定步骤落在哪条泳道：`user` `frontend` `backend` `db` `external` `system`（写别的值会作为自定义泳道）。`kind`：`decision`（判断/分支）或 `note`（备注）。`node` 写这一步发生在哪个界面元素上（元素 id，或 id 数组）：改动详情会把它列进「相关交互」，流程页可一键定位回画布。`page` 关联整个页面 id（没有具体元素时用）。步骤的顺序就是数组顺序；移动步骤同样用 removed + movedTo / added + movedFrom。

## Module（后端）

~~~jsonc
{
  "id": "m-tag", "name": "TagService", "kind": "service", "change": "added", "note": "...",
  "items": [
    { "id": "tag-ensure", "kind": "function", "name": "ensure(names: string[]): Tag[]", "note": "..." },
    { "id": "api-list", "kind": "api", "name": "GET /api/tasks", "note": "新增 tags 参数",
      "change": "modified", "before": { "note": "categoryId 参数" } }
  ]
}
~~~

模块 `kind`：module service controller api model table store component job config other
条目 `kind`：api function method model field table column job event config state other

## 反馈格式（用户复制回来的 Markdown）

~~~markdown
# 原型反馈：<title>
> 基于方案 v1（原型阶段 · 尚未实现）· 导出于 … · 批注 2 条 · 方案修改 3 处
**✅ 用户已确认方案**                       ← 只在用户点了确认时出现
## 整体意见                                 ← 风格标签 / 意见 / 风格参考
## 对 Agent 问题的回答
## 批注                                     ← 1. **[必须改][交互方式]** 页面「任务列表」› 改动后 › … #btn-new
## 用户直接对方案做的修改（按操作顺序）       ← 每条一句话，说明意图
## 给 Agent 的处理说明
<details><summary>revisedSpec …</summary>
```json
{ …用户改完后的完整 spec，格式与输入相同，另带 basedOnVersion… }
```
</details>
~~~

`scripts/apply-feedback.mjs` 会取出最后的 revisedSpec 代码块，写成下一版 spec。

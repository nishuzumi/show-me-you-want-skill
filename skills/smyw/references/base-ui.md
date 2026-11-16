# Base UI 组件框架

smyw 的 spec 用 **Base UI** 的原语来拼界面。写 spec 时，先把界面拆成 Base UI 组件，再写它们的结构、状态和交互；预览里的线框按这些组件来画，实现时直接照着同一套组件写代码。

- Base UI 版本：**1.9.0**，npm 包名 **`@base-ui/react`**（旧文档里的 `@base-ui-components/react` 是同一套组件，新代码用新包名）。
- 组件文档：<https://base-ui.com/react/components>。
- Base UI 是 **headless** 的：组件只给行为和可访问性，样式由项目自己写。所以 spec 里**不要写颜色、间距、字体**；线框和真实视觉无关。
- 预览是单文件线框，**不打包 React / Base UI**。spec 里的 `type` 是组件的“身份”，预览把它画成对应的线框；真正的 Base UI 代码在实现阶段由 agent 拼。

## 常用组件速查

| spec `type` | Base UI 组件 | import | 组合方式（anatomy） |
|---|---|---|---|
| `button` | Button | `@base-ui/react/button` | `<Button>` |
| `input` | Input | `@base-ui/react/input` | `<Input>` |
| `field` | Field | `@base-ui/react/field` | `Root > Label + Control + Description + Error` |
| `fieldset` | Fieldset | `@base-ui/react/fieldset` | `Root > Legend` |
| `form` | Form + Field | `@base-ui/react/form` + `@base-ui/react/field` | `<Form>` + `Field.Root` |
| `checkbox` | Checkbox | `@base-ui/react/checkbox` | `Root > Indicator` |
| `checkbox-group` | CheckboxGroup + Checkbox | `@base-ui/react/checkbox-group` + `@base-ui/react/checkbox` | `CheckboxGroup > Checkbox.Root` |
| `switch` | Switch | `@base-ui/react/switch` | `Root > Thumb` |
| `radio-group` | RadioGroup + Radio | `@base-ui/react/radio-group` + `@base-ui/react/radio` | `RadioGroup > Radio.Root > Indicator` |
| `select` | Select | `@base-ui/react/select` | `Root > Label + Trigger > Value/Icon + Portal > Positioner > Popup > List > Item` |
| `combobox` | Combobox | `@base-ui/react/combobox` | `Root > InputGroup > Input + Trigger + Portal > Positioner > Popup > List > Item` |
| `autocomplete` | Autocomplete | `@base-ui/react/autocomplete` | `Root > InputGroup > Input + Portal > Positioner > Popup > List > Item` |
| `slider` | Slider | `@base-ui/react/slider` | `Root > Label + Value + Control > Track > Indicator + Thumb` |
| `number-field` | NumberField | `@base-ui/react/number-field` | `Root > Group > Decrement + Input + Increment` |
| `otp-field` | OTPField | `@base-ui/react/otp-field` | `Root > Input + Separator` |
| `toggle` | Toggle | `@base-ui/react/toggle` | `<Toggle>` |
| `toggle-group` | ToggleGroup + Toggle | `@base-ui/react/toggle-group` + `@base-ui/react/toggle` | `ToggleGroup > Toggle` |
| `tabs` | Tabs | `@base-ui/react/tabs` | `Root > List > Tab + Indicator + Panel` |
| `accordion` | Accordion | `@base-ui/react/accordion` | `Root > Item > Header > Trigger + Panel` |
| `collapsible` | Collapsible | `@base-ui/react/collapsible` | `Root > Trigger + Panel` |
| `toolbar` | Toolbar | `@base-ui/react/toolbar` | `Root > Button / Link / Separator / Group / Input` |
| `menubar` | Menubar + Menu | `@base-ui/react/menubar` + `@base-ui/react/menu` | `Menubar > Menu.Root > Menu.Trigger + Menu.Popup > Item` |
| `navigation-menu` | NavigationMenu | `@base-ui/react/navigation-menu` | `Root > List > Item > Trigger + Content > Link` |
| `avatar` | Avatar | `@base-ui/react/avatar` | `Root > Image + Fallback` |
| `separator` | Separator | `@base-ui/react/separator` | `<Separator>` |
| `progress` | Progress | `@base-ui/react/progress` | `Root > Label + Track > Indicator + Value` |
| `meter` | Meter | `@base-ui/react/meter` | `Root > Label + Track > Indicator + Value` |
| `scroll-area` | ScrollArea | `@base-ui/react/scroll-area` | `Root > Viewport > Content + Scrollbar > Thumb` |
| `dialog` | Dialog | `@base-ui/react/dialog` | `Root > Trigger + Portal > Backdrop + Viewport > Popup > Title + Description + Close` |
| `alert-dialog` | AlertDialog | `@base-ui/react/alert-dialog` | 同 Dialog，用于必须响应的确认 |
| `drawer` | Drawer | `@base-ui/react/drawer` | `Provider > Indent > Root > Trigger + Portal > Backdrop + Viewport > Popup > Content` |
| `popover` | Popover | `@base-ui/react/popover` | `Root > Trigger + Portal > Backdrop + Positioner > Popup > Arrow + Viewport` |
| `preview-card` | PreviewCard | `@base-ui/react/preview-card` | `Root > Trigger + Portal > Positioner > Popup > Viewport` |
| `tooltip` | Tooltip | `@base-ui/react/tooltip` | `Provider > Root > Trigger + Portal > Positioner > Popup > Arrow` |
| `menu` | Menu | `@base-ui/react/menu` | `Root > Trigger + Portal > Positioner > Popup > List > Item / Separator / Group / SubmenuRoot` |
| `context-menu` | ContextMenu | `@base-ui/react/context-menu` | 同 Menu，由右键 / 长按触发 |
| `toast` | Toast | `@base-ui/react/toast` | `Provider > Portal > Viewport > Root > Content > Title + Description + Action + Close` |

`smyw` 的旧类型继续可用，它们对应到 Base UI 的组件：

| 旧 `type` | 建议改用的 Base UI `type` |
|---|---|
| `modal` | `dialog`（必须确认时用 `alert-dialog`） |
| `radio` | `radio-group` |
| `divider` | `separator` |
| `select` / `checkbox` / `tabs` / `toolbar` / `button` / `input` / `form` / `drawer` / `popover` / `menu` | 同名（已经按 Base UI 组件画） |

`toggle` 不是旧类型，也不是 `switch` 的别名：它是 Base UI 的 Toggle（可按下的按钮），用于工具栏等按下 / 弹起的按钮；开 / 关设置用 `switch`。旧方案里用 `toggle` 表示开关的，请迁移到 `switch`。

有些组件要同时引入多个子包（如 `Form` + `Field`、`RadioGroup` + `Radio`、`CheckboxGroup` + `Checkbox`、`ToggleGroup` + `Toggle`、`Menubar` + `Menu`）；上表用 `+` 全部列出，预览详情也会逐条显示这些 import。

## 在 spec 里怎么拼

Base UI 的组件是“根 + 若干 part”。在 spec 里，**根**写成一个节点，**part 里的内容**写成它的 children 或 `items`，**交互**用 `on` / `hidden` / `states` 表达。不要手写 HTML，也不要在 spec 里写 Base UI 的 JSX。

```jsonc
{
  "id": "invite", "type": "button", "label": "邀请成员", "component": "<InviteButton>",
  "change": "added",
  "on": [{ "action": "open", "target": "invite-dialog" }]
},
{
  "id": "invite-dialog", "type": "dialog", "label": "邀请成员",
  "trigger": "invite", "change": "added",
  "children": [
    { "id": "invite-email", "type": "field", "label": "邮箱", "change": "added",
      "children": [
        { "id": "invite-email-control", "type": "input", "text": "name@example.com", "change": "added" }
      ] },
    { "id": "invite-send", "type": "button", "label": "发送邀请", "variant": "primary",
      "change": "added", "on": [{ "action": "close" }] }
  ]
}
```

规则：

- **弹层**（`dialog` / `alert-dialog` / `drawer` / `popover` / `preview-card` / `tooltip` / `menu` / `context-menu` / `toast`）放在 `page.overlays`，用 `trigger` 指向打开它的按钮 id；多个按钮打开同一个弹层就写数组。`toast` 可以没有 trigger。
- **展开 / 收起**（`accordion` / `collapsible` / `tabs` / `menu` 的子菜单）：用 `hidden: true` 标出默认不显示的面板，再用触发按钮的 `on: [{ "action": "toggle", "target": "<面板 id>" }]` 指向它。预览会把面板画在旁边的单独面板并连线。
- **状态**（`toggle` / `switch` / `checkbox` / 按钮的选中态）：用 `states` 写几种样子，`on: [{ "action": "state", "target": "<id>", "state": "<状态名>" }]` 切换；演示模式里可以真的点。
- **表单**：`form` 里放 `field`，`field` 里放 `input` / `select` / `combobox` 等；`field` 的 `label` 就是字段名。不要用「输入框（不变）」占位。
- **列表型组件**（`tabs` / `select` / `menu` / `accordion` / `radio-group` / `checkbox-group`）用 `items` 写条目；`items` 也可以是带 `change` 的对象。
- **进度 / 数值**：`progress` / `meter` / `slider` 写 `"value": 0–100`，预览会画成对应的条。
- **组件名**：`component` 写实现时真正要写的 Base UI 组件（如 `"<Dialog> InviteDialog.tsx"`），这样用户能把线框和代码对上。

## 实现时怎么拼（给 agent）

用户确认方案后，按 spec 的 `type` 写 Base UI，而不是按预览里的线框 div 写：

```jsx
import { Dialog } from '@base-ui/react/dialog';
import { Field } from '@base-ui/react/field';
import { Input } from '@base-ui/react/input';
import { Button } from '@base-ui/react/button';

<Dialog.Root>
  <Dialog.Trigger render={<Button />}>邀请成员</Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Backdrop />
    <Dialog.Viewport>
      <Dialog.Popup>
        <Dialog.Title>邀请成员</Dialog.Title>
        <Field.Root>
          <Field.Label>邮箱</Field.Label>
          <Field.Control render={<Input />} placeholder="name@example.com" />
        </Field.Root>
        <Dialog.Close render={<Button />}>发送邀请</Dialog.Close>
      </Dialog.Popup>
    </Dialog.Viewport>
  </Dialog.Portal>
</Dialog.Root>
```

- 从 `@base-ui/react/<component>` 按 part 引入；不要把多个组件的 part 混用。
- 需要换成项目自己的按钮 / 链接 / 图标时，用 Base UI 的 `render` prop，而不是放弃组件的可访问性行为。
- 样式写在项目自己的 CSS / CSS-in-JS 里，挂在 part 的 `className` / `style` 上；不要在 spec 里写视觉样式。
- 组件要可访问：Dialog 有 `Title` / `Description`，表单控件有 `Field.Label`，图标按钮有可读名称。
- 详细的 props 看对应组件的文档页（上表的 import 去掉包名就是文档路径，例如 `base-ui.com/react/components/dialog`）。

## 和预览的关系

预览里的每个 Base UI 节点会显示：

- 类型名（如 `Dialog` / `Switch`）；
- 右下角 `</> 组件` 开关打开后的 `component`；
- 右侧详情里的 **Base UI · Dialog** 区块：import 语句、一句话说明、需要组合的 parts。

预览只画结构（有哪些模块、放在哪、怎么触发），不画 Base UI 的最终视觉。用户如果要看真实组件，等实现后按项目的样式跑起来看。

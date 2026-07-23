---
name: ssticker Operations Console
description: A restrained, explainable workspace for sticker catalog operations.
colors:
  primary-olive: "oklch(0.52 0.11 110)"
  primary-olive-hover: "oklch(0.46 0.11 110)"
  secondary-blue: "oklch(0.44 0.10 245)"
  canvas-white: "oklch(1 0 0)"
  quiet-surface: "oklch(0.97 0.006 110)"
  ink: "oklch(0.22 0.018 110)"
  muted-ink: "oklch(0.46 0.016 110)"
  boundary: "oklch(0.88 0.008 110)"
  danger: "oklch(0.50 0.17 28)"
  success: "oklch(0.47 0.10 150)"
typography:
  headline:
    fontFamily: "Inter, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Inter, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 620
    lineHeight: 1.4
  body:
    fontFamily: "Inter, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Inter, PingFang SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 560
    lineHeight: 1.35
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary-olive}"
    textColor: "{colors.canvas-white}"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-olive-hover}"
    textColor: "{colors.canvas-white}"
  input:
    backgroundColor: "{colors.canvas-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  surface:
    backgroundColor: "{colors.quiet-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px"
---

# Design System: ssticker Operations Console

## Overview

**Creative North Star: "The Quiet Evidence Desk"**

想象运营人员在白天办公室里逐项审核一批会进入真实聊天的表情素材：环境光清楚、注意力集中，界面必须像一张可靠的工作台，而不是表情主题乐园。系统通过稳定的表格、明确的处理状态和可核对的分数建立信任；素材缩略图负责趣味，产品外壳保持安静。

它拒绝娱乐化大屏、通用 SaaS 卡片墙和把模型结果神秘化的表现。响应式变化只重排结构，动效只解释状态变化。

**Key Characteristics:**

- 白色工作画布与低色度橄榄主色
- 表格优先、抽屉补充、状态就地解释
- 素材预览有表现力，控制面板保持节制
- 清晰键盘焦点与完整错误、空、加载状态

## Colors

色彩以纯白画布和低色度橄榄为锚，蓝色只用于链接、焦点和可解释性信息；危险与成功色严格服务语义。

### Primary

- **Archive Olive**：主操作、当前导航和选中状态。饱和填充始终使用白字。

### Secondary

- **Evidence Blue**：链接、焦点环和解释性数据，不与主操作竞争。

### Neutral

- **Canvas White**：页面和主要工作区背景。
- **Quiet Surface**：工具栏、侧栏和只读信息层。
- **Operational Ink**：正文和数据。
- **Muted Operational Ink**：辅助说明，仍须满足正文对比度要求。
- **Boundary**：表格分隔、输入边界和分区，不与大范围阴影并用。

**The Sparse Accent Rule.** 主色只用于可操作或已选中的元素；任何一屏中大面积橄榄色都意味着颜色失去信息价值。

## Typography

**Display Font:** Inter（中文回退 PingFang SC、Microsoft YaHei、system-ui）  
**Body Font:** Inter（同一回退栈）  
**Label/Mono Font:** 标签沿用同一字体；技术 ID 使用系统等宽字体。

**Character:** 单一无衬线体系减少切换成本。数字、状态、中文标签和英文 ID 在高密度表格里保持一致节奏。

### Hierarchy

- **Headline**（650，24px，1.25）：页面标题和关键抽屉标题。
- **Title**（620，16px，1.4）：分区、表格主体名称和表单组。
- **Body**（400，15px，1.55）：正文、表格和说明；连续 prose 最大 72ch。
- **Label**（560，13px，1.35）：字段、筛选和状态，不使用装饰性全大写。

**The Task Scale Rule.** 管理端使用固定 rem 字号；禁止用营销页式流体大标题制造层级。

## Elevation

系统以色调层和边界建立层级，静止表面默认无阴影。抽屉、菜单和悬浮反馈可以使用短而清晰的结构阴影，不能同时叠加宽模糊阴影和装饰边框。

### Shadow Vocabulary

- **Overlay structural** (`0 4px 8px oklch(0.22 0.018 110 / 0.14)`): 仅用于抽屉、菜单和浮层。

**The Flat-by-Default Rule.** 如果普通列表项需要阴影才能被看见，说明间距或分隔设计失败。

## Components

### Buttons

- **Shape:** 小而明确的圆角（6px），不使用药丸形主按钮。
- **Primary:** Archive Olive、白字、10px 16px；只承载页面主要动作。
- **Hover / Focus:** 180ms 颜色变化；焦点使用 2px Evidence Blue 外环，不能只改变颜色。
- **Secondary / Ghost:** 白色或透明背景，以边界和文字强调；危险操作使用文本明确的二次确认。

### Chips

- **Style:** 低色度背景、清晰文字、完整边界；用于标签和筛选，不伪装成按钮。
- **State:** 选中态同时改变图标/勾选和文字，不只改变颜色。

### Cards / Containers

- **Corner Style:** 10px，只用于真正独立的面板。
- **Background:** Canvas White 或 Quiet Surface。
- **Shadow Strategy:** 普通面板无阴影。
- **Border:** 1px Boundary；禁止嵌套卡片。
- **Internal Padding:** 16px 或 24px。

### Inputs / Fields

- **Style:** 白色背景、1px Boundary、6px 圆角，标签始终可见。
- **Focus:** 2px Evidence Blue 外环并保留边界。
- **Error / Disabled:** 错误同时显示图标、说明和 danger 色；禁用态仍保持可读。

### Navigation

桌面为窄侧栏，移动端折叠为顶部导航。活动项使用低色度橄榄背景、文字和图标三重提示；过渡 180ms，并尊重 reduced motion。

### Decision Trace

推荐过程用有序阶段列表展示规则、召回、排序和策略结果。分数附带文字解释，`skip` 与 `send` 都被视为正常决策，不用戏剧化警告样式。

## Do's and Don'ts

### Do:

- **Do** 让表格、筛选和详情抽屉形成主要工作流。
- **Do** 为 loading、empty、error、disabled 和 partial success 写完整状态。
- **Do** 让审核和安全状态同时具备文字、图标和颜色。
- **Do** 在 360px、768px 和宽桌面验证中英文长文本。

### Don't:

- **Don't** 做成“娱乐化大屏、充满装饰卡片的通用 SaaS 模板”。
- **Don't** 使用霓虹渐变、玻璃拟态、嵌套卡片或装饰性网格背景。
- **Don't** 使用宽模糊阴影配 1px 边框的 ghost-card 组合。
- **Don't** 用超过 16px 的面板圆角，或在普通标签上重复微型全大写 eyebrow。
- **Don't** 用颜色单独表达审核、安全、成功或失败。

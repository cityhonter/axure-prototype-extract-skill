---
name: axure-prototype-extract
description: 从 Axure 网页原型（已发布的 start.html 链接、axshare 链接、内网/本地导出的 HTML 目录）中完整提取需求：Sitemap 页面清单、需求标注原文、控件文字、隐藏弹窗/面板明细、交互定义、整页截图与交互弹窗截图，最终产出结构化需求文档并通过机器防遗留校验。凡用户提到 Axure 原型、原型提取、原型需求、提取需求、原型截图、还原原型、分析原型，或给出 start.html / .axshare.com 链接要求分析开发需求——即使用户没有说"提取"两个字——都必须使用本 skill。
---

# Axure 原型需求提取

把 Axure 已发布原型转化为"可直接喂给 AI 派开发任务"的需求包。整个过程基于两个事实：
**原型每页都是普通 HTML**（控件文字在 DOM 里），**每页的数据文件 `files/<页面名>/data.js` 包含
需求标注、控件命名、交互定义**（比截图信息更全）。截图负责视觉，data.js 负责语义，两者缺一不可。

## 输入与产出

需要向用户确认（缺省可推断时不必追问）：

1. 原型地址：`.../start.html` 所在**目录** URL（内网地址需本机可访问）或本地导出 HTML 目录路径
2. 输出目录：默认 `./<项目名>需求-原型/`
3. 排除范围：哪些页面不提取（如"一张图""移动端"分组）——**必须让用户明确确认排除项**，其余全量提取

固定产出结构：

```
<输出目录>/
├── README.md            # 总览：索引、通用规范、全局业务规则、术语、疑点清单
├── NN-端-页面名.md       # 每页一份需求文档
├── 截图/                # 每页一张整页截图
├── 截图-交互/           # 弹窗/滑出面板/Tab 切换态截图
└── 数据/                # 每页原始 JSON + digest/ 摘要（溯源用）
```

## 环境铁律（违反即失败）

1. **全程用 Browser Use**：先加载 `browser-use:control-browser` skill；所有页面操作走
   `mcp__node_repl__js`，主代理自己执行，禁止委托子代理。纯文件处理（digest/校验）用 Bash + node。
2. **每个 js 单元格都是全新内核**：每次调用都要重新执行 browser-client bootstrap，并重新
   `import` 脚本模块；上个单元格里的变量、tab 绑定一律不复用。
3. **绝不用 `fullPage` 截图**：大视口下 IAB 截图通道会输出平铺坏图。用 CSS `zoom` 缩放画布 +
   调整视口高度替代（脚本已内置）。
4. **脚本已封装全部脏活**（混淆 data.js 捕获、对象树双键遍历、visible 判定、safeScreenshot
   重试、zoom-fit、changed-detection），**不要重写这些逻辑**，直接 import 调用：

```
~/.agents/skills/axure-prototype-extract/scripts/
├── extract_pages.mjs       # getSitemap() + processPages()：页面清单 / 数据JSON / 整页截图
├── shoot_interactions.mjs  # shootScenes()：交互弹窗截图（含 show: 强制显示兜底）
├── make_digest.cjs         # JSON → 摘要（Bash 运行）
└── check_coverage.cjs      # 防遗留校验（Bash 运行，退出码 0=通过）
```

## 流程

### 阶段 1 · Sitemap 页面清单

```js
// 单元格内：先 bootstrap browser-use，然后
const { getSitemap } = await import("file:///C:/Users/EDY/.agents/skills/axure-prototype-extract/scripts/extract_pages.mjs");
const leaves = await getSitemap(nodeRepl, agent, "<start.html完整URL，可带默认页参数>");
```

- Sitemap 在**播放器（start.html）上下文**的 `$axure.document.sitemap` 里；直接打开单页 HTML
  拿不到。叶子节点带 `url`（如 `页面名.html`、重名页为 `页面名_1.html`）——**必须用 url 字段**，
  不要自己拼文件名（重名页会拼错）。
- 把清单按端/分组整理成表格给用户过目，标出拟排除项，等用户确认排除范围后继续。

### 阶段 2 · 逐页数据提取 + 整页截图

编号规则：`NN-端-页面名`（NN 按端分组递增）。分批调用（每批 ≤4 页防超时）：

```js
const { processPages } = await import("file:///C:/Users/EDY/.agents/skills/axure-prototype-extract/scripts/extract_pages.mjs");
const results = await processPages(nodeRepl, agent, {
  baseUrl: "<原型目录URL>/",          // start.html 所在目录，尾斜杠
  outDir: "D:/.../输出目录/",          // 尾斜杠
  tasks: [{ file: "活性炭设备管理.html", prefix: "01-监管端-活性炭设备管理" }, ...]
});
```

- 每页产出 `数据/<prefix>.json` + `截图/<prefix>.png`，脚本会 emitImage 截图供你质检
  （重点看：是否平铺坏图、内容是否完整、是否是说明页）。
- `widgetCount=0` 的页面是**说明页**（整页只有需求说明红字+参考图），数据为空是正常的，
  截图本身就是需求，阶段 5 转写即可。
- 文字渲染成 PNG 的原型（widget 有 `images` 无 text）文字抓不到，靠截图视觉阅读补全。

### 阶段 3 · 交互弹窗截图

⚠️ **Axure 导出的 DOM 元素 id（uNNN）是每次页面加载动态分配的，跨加载会漂移**——
绝不要把上一次会话 digest 里的 uid 当点击目标（会把点击点到完全无关的元素上）。
场景定位一律使用以下三种**稳定定位方式**（坐标来自 digest 可见控件文字行的 x,y，是设计稿绝对坐标，跨加载稳定）：

| 规格 | 含义 | 用法 |
|---|---|---|
| `"配置@1698,336"` | **首选**：文字包含"配置"且中心点离坐标 (1698,336) 最近的可见元素 | 行内链接、按钮、Tab（坐标从 digest 该元素所在行取） |
| `"text:新增"` | 次选：文字匹配、取面积最小可见元素 | 坐标不便获取时；注意同名元素要配合前置点击限定上下文 |
| `"showText:* 验收日期"` | 兜底：找含该文字的元素向上取顶层容器，强制显示隐藏面板 | 点击无法打开的面板；**文字必须在目标面板内唯一**（带 `*` 的必填字段名、占位文案通常唯一；避免用同时是列头的词） |

场景来源（两处必须合并，缺一即遗留）：

1. JSON 的 `interactions`：`显示/隐藏` 类 = 弹窗开关；`设置动态面板状态` 类 = Tab 切换；
2. digest 可见控件文字里的按钮：新增/搜索/配置/批量配置/更新日志/确认/反馈/复查/处理反馈/
   详情，以及行内蓝色链接（设备名、编号、日期）和面板内子 Tab（bnt-1/bnt-2…）。

点击序列支持嵌套（先点行链接打开详情面板，再点面板内子 Tab）：

```js
const { shootScenes } = await import("file:///C:/Users/EDY/.agents/skills/axure-prototype-extract/scripts/shoot_interactions.mjs");
const report = await shootScenes(nodeRepl, agent, {
  baseUrl: "<原型目录URL>/", outDir: "D:/.../输出目录/",
  tasks: [{ file: "xxx.html", scenes: [
    { name: "07-新增弹窗", clicks: ["新增@1817,452"] },
    { name: "07-详情面板-更换记录", clicks: ["XXXXXXXXX@363,572", "更换记录@332,166"] }, // 先开详情，再点面板内Tab
    { name: "07-选择设备更换人员弹窗", clicks: ["设备更换人员@303,168", "text:新增"] },
    { name: "05-复查弹窗", clicks: ["showText:请选择日期"] }
  ]}]
});
```

- 脚本内置 **changed-detection**：每个场景强制真加载（同址导航走 about:blank 中转，避免遗留
  弹窗/zoom 污染基线），点击后无新内容显示的场景自动跳过不存图。
- `changed:false` 的场景要判断：是"本来就没有弹窗"（在文档注明原因），还是"定位文字不唯一/
  点击目标不对"（换更精确的文字或坐标重试一次）。
- 全部存入 `截图-交互/`，命名 `NN-弹窗或面板名.png`。重试产生的 `v2` 图，最终保留后重命名
  去掉 v2，废图删除。
- 每张交互截图 emit 回来后**肉眼确认内容是目标弹窗**（定位文字撞车时会开错面板）。

### 阶段 4 · 摘要

```bash
node "C:/Users/EDY/.agents/skills/axure-prototype-extract/scripts/make_digest.cjs" "<输出目录>"
```

### 阶段 5 · 撰写需求文档

先读 `references/doc-template.md`（README 模板 + 页面文档模板 + 撰写规则），然后：

1. 逐页精读 `数据/digest/<prefix>.digest.md` + 对照该页截图，按模板写 `NN-端-页面名.md`；
2. 全部页面完成后写 README（全局规则汇总、疑点清单）；
3. **标注格式硬性要求**：每条标注在"需求标注原文"表里独占一行 `| <fn> | 内容 |`，
   禁止合并多编号到一行——否则阶段 6 机器校验必失败。

### 阶段 6 · 防遗留校验（完成的标准）

```bash
node "C:/Users/EDY/.agents/skills/axure-prototype-extract/scripts/check_coverage.cjs" "<输出目录>"
```

脚本核对：每页文档存在、整页截图存在、**每条标注编号都出现在文档中**、隐藏弹窗文字已写入
文档。有缺失会打印缺哪个标注编号、哪些弹窗文字未覆盖——补齐后重跑，**必须退出码 0**。

机器校验之外，人工再过一遍这份清单（每项都要能回答"有"）：

- [ ] Sitemap 叶子页 100% 有文档+截图（或用户明确排除并记录在 README 范围说明）
- [ ] 每页的 `interactions` 都有对应交互截图，或文档写明"无弹窗/原型未做"的原因
- [ ] 每个隐藏面板（digest"隐藏控件文字"分组）在文档中有"弹窗明细"章节
- [ ] 说明页（widgetCount=0）的红字需求已逐字转写进文档
- [ ] 跨页重复的规则已汇总进 README 全局业务规则，页面文档改为引用
- [ ] 所有矛盾/残留标注进入 README 疑点清单
- [ ] 交互截图无 v2 残留命名，废图已删

## 常见故障与对策

| 症状 | 原因与处理 |
|---|---|
| 截图出现 2x2 平铺 | 截图通道坏图：不要 fullPage；重截一次；保持 zoom-fit + 视口高度=内容高（脚本已内置） |
| `agent is not defined` | js 单元格没跑 bootstrap，或模块里直接用了全局 agent——模块必须显式接收 agent 参数 |
| data.js 捕获 error | data.js 是混淆 IIFE，必须用 `new Function('$axure', text)(stub)` 捕获（脚本已内置）；error 通常是 URL 拼错（页面名需 encodeURIComponent） |
| 某控件怎么点都没反应 / 点开了别的面板 | 元素 id 跨加载漂移，禁止用 uid 定位；改用 `文字@坐标`；showText 撞车时换面板内唯一的文字（带 `*` 必填字段名、占位文案） |
| 点了开关/勾选等无关控件 | 同上，uid 漂移导致的错误命中，改用 `文字@坐标` 定位 |
| 截图底部黑边 | 视口高度 > 缩放后内容高：视口高度取 scrollHeight（脚本已内置） |
| 页面横向溢出导致内容偏小 | scrollWidth 被超宽元素撑倍，脚本已把设计宽钳制在 ≤1920 |
| 标注 ownerText 为空 | objectPaths 映射失败，标注原文仍在，文档里保留原文并人工从截图对照关联控件 |

# Axure 原型需求提取 Skill（axure-prototype-extract）

一个 ZCode skill：从 **Axure 网页原型**（已发布的 start.html 链接、axshare 链接、内网/本地导出的 HTML 目录）中完整提取开发需求，产出可直接喂给 AI 派开发任务的结构化需求包。

## 它做什么

- 解析原型 **Sitemap 页面树**，生成页面清单（支持按用户要求排除部分分组，如"一张图"、"移动端"）
- 逐页提取：
  - **需求标注原文**（Axure 黄标说明，需求的最权威来源）
  - 控件文字、控件命名、位置坐标（含**隐藏弹窗/滑出面板/Tab 内容**）
  - **交互定义**（显示/隐藏、动态面板切换等）
  - **整页截图** + **交互弹窗截图**（真实点击按钮后的弹窗状态）
- 产出结构化需求文档：`README 总览`（索引/通用规范/全局业务规则/术语/疑点清单）+ 每页一份需求文档
- **防遗留机器校验**：每条标注、每个隐藏弹窗的内容、每张截图是否落进文档，校验器全绿才算完成

## 安装

把本仓库克隆到 ZCode 的 skill 目录：

```bash
# 用户级（所有项目可用）
git clone https://github.com/cityhonter/axure-prototype-extract-skill.git "$HOME/.agents/skills/axure-prototype-extract"
```

## 使用

在 ZCode 会话中提到"Axure 原型 / 提取需求 / 原型截图 / 还原原型"，或给出 `start.html` 链接要求分析需求时自动触发；也可以显式调用：

```
/axure-prototype-extract http://your-host/path/原型/start.html 输出到 ./某项目需求-原型/
```

需要确认的输入：原型目录 URL（或本地路径）、输出目录、要排除的页面分组。

## 目录结构

```
├── SKILL.md                      # 触发条件 + 6 阶段流程 + 稳定性铁律 + 故障对策
├── references/doc-template.md    # 需求文档模板（README/页面文档）与撰写规则
└── scripts/
    ├── extract_pages.mjs         # Sitemap 提取 + 逐页数据(JSON) + 整页截图
    ├── shoot_interactions.mjs    # 交互弹窗截图（文字@坐标定位 + 变化检测）
    ├── make_digest.cjs           # JSON → 精简摘要
    └── check_coverage.cjs        # 防遗留校验（退出码 0 = 无遗留项）
```

## 稳定性设计（踩坑沉淀）

- **元素 id 漂移**：Axure 导出的 DOM 元素 id（uNNN）每次页面加载动态分配，跨加载不可靠。
  交互点击一律使用 **"文字 + 设计稿坐标"** 定位（坐标来自数据文件，跨加载稳定），
  点击无响应的隐藏面板用 `showText:` 特征文字强制显示兜底。
- **同址导航空操作**：同一标签页 goto 相同 URL 不会重载，上一场景的弹窗会污染下一场景。
  场景间统一走 `about:blank` 中转真加载。
- **禁用 fullPage 截图**：大视口下截图通道会产生平铺坏图，改用 CSS zoom 缩放画布 +
  视口高度对齐内容。
- **changed-detection**：点击后无新内容显示的场景自动跳过，避免垃圾截图。
- **data.js 混淆 IIFE**：用桩函数在页面上下文捕获 `$axure.loadCurrentPage(...)` 入参，
  拿到完整对象模型（标注/交互/控件命名/objectPaths 映射）。

## 依赖

- ZCode（含 browser-use:control-browser 能力）
- Node.js ≥ 18
- 可访问目标原型的网络（内网原型需本机可达）

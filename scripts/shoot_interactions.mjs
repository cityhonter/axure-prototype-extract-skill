// Axure 原型交互截图：点击按钮/切换Tab/强制显示面板后截图弹窗内容
// 用法（在 Browser Use js 单元格内先完成 browser 引导，再 import）：
//   const { shootScenes } = await import("file:///<skill>/scripts/shoot_interactions.mjs");
//   await shootScenes(nodeRepl, agent, {
//     baseUrl: "http://host/path/to/原型目录/",
//     outDir: "D:/path/输出文件夹/",
//     tasks: [{ file: "页面名.html", scenes: [
//       { name: "0N-新增弹窗", clicks: ["u123"] },              // 按控件uid点击
//       { name: "0N-xxx", clicks: ["text:新增"] },              // 按可见文字匹配(选面积最小的可见元素)
//       { name: "0N-xxx", clicks: ["show:u456"] }               // 强制显示隐藏面板(点击无法触发时的兜底)
//     ]}]
//   });
// 点击序列支持嵌套（如先点行链接打开详情面板，再点面板内Tab）。

export async function shootScenes(nodeRepl, agent, opts) {
  const { baseUrl, outDir, tasks } = opts;
  const browser = await agent.browsers.getForUrl(baseUrl);
  const tabs = await browser.tabs.list();
  const existing = tabs.find(t => t.url && t.url.includes(new URL(baseUrl).host));
  const tab = existing ? await browser.tabs.get(existing.id) : await browser.tabs.new();
  const fs = await import("node:fs");
  fs.mkdirSync(outDir + "截图-交互", { recursive: true });

  const VISIBLE_SET = `(() => {
    const vis = [];
    for (const el of document.querySelectorAll('[id]')) {
      if (!/^u\\d+$/.test(el.id)) continue;
      let n = el, ok = true;
      while (n && n !== document.body) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) { ok = false; break; }
        n = n.parentElement;
      }
      if (ok) vis.push(el.id);
    }
    return vis;
  })()`;

// 点击场景规格（uid 是每次加载动态分配的，跨会话不可靠！）：
//   "配置@1698,336"   首选：按 ownedText 包含"配置"且中心点距设计坐标(1698,336)最近的可见元素
//   "text:新增"        次选：按文字匹配、取面积最小的可见元素
//   "showText:验收日期" 兜底：找到含该文字的元素，向上找到 body 直属顶层容器强制显示（隐藏面板）

function parseSpec(spec) {
  const m = spec.match(/^(.+)@(-?[\d.]+),(-?[\d.]+)$/);
  if (m) return { kind: 'textAt', text: m[1], x: parseFloat(m[2]), y: parseFloat(m[3]) };
  if (spec.startsWith('text:')) return { kind: 'textAt', text: spec.slice(5) };
  if (spec.startsWith('showText:')) return { kind: 'showText', text: spec.slice(9) };
  return { kind: 'uid', uid: spec }; // 仅当场景与当前加载同会话时才可靠
}

function clickSpecCode(spec) {
  const p = parseSpec(spec);
  if (p.kind === 'uid') {
    return `(() => { const el = document.getElementById(${JSON.stringify(p.uid)}); if (!el) return 'notfound'; el.click(); return 'ok'; })()`;
  }
  if (p.kind === 'showText') {
    return `(() => {
      const text = ${JSON.stringify(p.text)};
      let hit = null;
      for (const el of document.querySelectorAll('[id]')) {
        if (!/^u\\d+$/.test(el.id)) continue;
        const t = (el.innerText || '').replace(/\\s+/g, '');
        if (t && t.includes(text)) { hit = el; break; }
      }
      if (!hit) return 'notfound';
      // 向上找到顶层容器：父节点是 body 或 #base（Axure 页面画布根）即停
      let top = hit;
      while (top.parentElement && top.parentElement !== document.body && top.parentElement.id !== 'base') {
        top = top.parentElement;
      }
      let n = top;
      while (n && n !== document.body) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none') n.style.display = 'block';
        if (cs.visibility === 'hidden') n.style.visibility = 'visible';
        if (Number(cs.opacity) === 0) n.style.opacity = '1';
        n = n.parentElement;
      }
      top.style.zIndex = '99999';
      return 'shown:' + top.id;
    })()`;
  }
  // textAt
  return `(() => {
    const text = ${JSON.stringify(p.text)};
    const px = ${JSON.stringify(p.x)}, py = ${JSON.stringify(p.y)};
    const matches = [];
    for (const el of document.querySelectorAll('[id]')) {
      if (!/^u\\d+$/.test(el.id)) continue;
      let n = el, ok = true;
      while (n && n !== document.body) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) { ok = false; break; }
        n = n.parentElement;
      }
      if (!ok) continue;
      let t = '';
      for (const c of el.childNodes) {
        if (c.nodeType === 3) t += c.nodeValue;
        else if (c.nodeType === 1 && !/^u\\d+$/.test(c.id)) t += c.innerText || '';
      }
      t = t.replace(/\\s+/g, '');
      if (t && t.includes(text)) {
        const r = el.getBoundingClientRect();
        matches.push({ el, area: r.width * r.height,
          cx: r.x + window.scrollX + r.width / 2, cy: r.y + window.scrollY + r.height / 2 });
      }
    }
    if (!matches.length) return 'notfound';
    if (px != null) {
      matches.sort((a, b) => (Math.hypot(a.cx - px, a.cy - py)) - (Math.hypot(b.cx - px, b.cy - py)));
    } else {
      matches.sort((a, b) => a.area - b.area);
    }
    matches[0].el.click();
    return 'ok:' + matches[0].el.id;
  })()`;
}

  async function safeScreenshot() {
    for (let i = 0; i < 3; i++) {
      try { return await tab.screenshot(); }
      catch (e) { await tab.playwright.waitForTimeout(2500); }
    }
    return null;
  }

  const report = [];
  for (const task of tasks) {
    const { file, scenes } = task;
    for (const scene of scenes) {
      const { name, clicks } = scene;
      try {
        await tab.setViewportSize({ width: 1440, height: 900 });
        const target = baseUrl + encodeURIComponent(file);
        // 同址 goto 是空操作会遗留状态；而 reload 会让 Axure 事件绑定时序错乱。
        // 跨文档导航（about:blank → 目标页）是被验证可靠的真加载路径。
        if ((await tab.url()) === target) {
          await tab.goto("about:blank");
          await tab.playwright.waitForLoadState({ state: "domcontentloaded" });
          await tab.playwright.waitForTimeout(300);
        }
        await tab.goto(target);
        await tab.playwright.waitForLoadState({ state: "domcontentloaded" });
        await tab.playwright.waitForTimeout(2500);
        // 页面加载验证：无 u-控件元素则再导航一次
        const loadCheck = await tab.playwright.evaluate(`document.querySelectorAll('[id]').length`);
        if (!loadCheck) {
          await tab.goto(target);
          await tab.playwright.waitForLoadState({ state: "domcontentloaded" });
          await tab.playwright.waitForTimeout(2500);
        }

        const baseSet = new Set(await tab.playwright.evaluate(VISIBLE_SET));
        const clickLog = [];
        for (const spec of clicks) {
          const r = await tab.playwright.evaluate(clickSpecCode(spec));
          clickLog.push(spec + '->' + r);
          await tab.playwright.waitForTimeout(1300);
        }
        const nowSet = await tab.playwright.evaluate(VISIBLE_SET);
        const revealed = nowSet.filter(id => !baseSet.has(id));
        if (!revealed.length) {
          report.push({ name, changed: false, clickLog });
          continue;
        }
        // zoom-fit 放在点击检测之后：resize 重排不应干扰交互状态判定
        await tab.playwright.evaluate(`(() => { window.scrollTo(0, 0); return 'ok'; })()`);
        await tab.playwright.waitForTimeout(300);
        const geo = await tab.playwright.evaluate(`(() => {
          const W = Math.min(Math.max(document.documentElement.scrollWidth, 1440), 1920);
          const H = Math.max(document.documentElement.scrollHeight, 700);
          const zoom = Math.min(1, 1440 / W);
          if (zoom < 1) document.documentElement.style.zoom = zoom;
          return { outW: Math.min(1440, Math.round(W * zoom)),
                   outH: Math.max(700, Math.min(Math.round(H * zoom) + 6, 2100)) };
        })()`);
        await tab.setViewportSize({ width: geo.outW, height: geo.outH });
        await tab.playwright.waitForTimeout(900);

        const png = await safeScreenshot();
        if (png) {
          fs.writeFileSync(outDir + "截图-交互/" + name + ".png", png);
          nodeRepl.emitImage(png);
        }
        report.push({ name, changed: true, saved: !!png, revealed: revealed.slice(0, 10), clickLog });
      } catch (e) {
        report.push({ name, error: e.message });
      }
    }
  }
  return report;
}

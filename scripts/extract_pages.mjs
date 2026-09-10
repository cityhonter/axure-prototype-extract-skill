// Axure 原型逐页提取：整页截图 + 数据(JSON)
// 由 Browser Use 的 mcp__node_repl__js 调用。
// 用法（在单元格内先完成 browser 引导，再 import 本模块）：
//   const { processPages } = await import("file:///<skill>/scripts/extract_pages.mjs");
//   await processPages(nodeRepl, agent, {
//     baseUrl: "http://host/path/to/原型目录/",   // start.html 所在目录，含尾斜杠
//     outDir: "D:/path/输出文件夹/",              // 需求输出根目录，含尾斜杠
//     tasks: [{ file: "页面名.html", prefix: "01-端-页面名" }]
//   });

const EXTRACT_FN = `(async () => {
  const dataUrl = "__DATAURL__";
  let model = null;
  try {
    const resp = await fetch(dataUrl);
    const text = await resp.text();
    const captured = [];
    new Function('$axure', text)({ loadCurrentPage: (d) => captured.push(d) });
    model = captured[0];
  } catch (e) { model = { error: e.message }; }
  function decode(s) { return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&nbsp;/g,' '); }
  const htmlToText = (h) => decode(String(h||'').replace(/<\\/p>/g,'\\n').replace(/<br[^>]*>/gi,'\\n').replace(/<[^>]+>/g,'')).replace(/\\n{2,}/g,'\\n').trim();
  const byGuid = {};
  function walkModel(objs) {
    for (const o of (objs||[])) {
      byGuid[o.id] = { label: o.label || '', type: o.type || '', friendlyType: o.friendlyType || '', interactionMap: o.interactionMap || null };
      for (const k of ['objs','objects']) if (Array.isArray(o[k])) walkModel(o[k]);
    }
  }
  if (model && model.page) {
    walkModel(model.page.diagram && model.page.diagram.objects);
    if (model.masters) for (const m of Object.values(model.masters)) if (m && m.diagram) walkModel(m.diagram.objects);
  }
  const paths = (model && model.page && model.page.objectPaths) || {};
  const uidToGuid = {};
  for (const [guid, p] of Object.entries(paths)) {
    const m = String(p).match(/u\\d+$/);
    if (m) uidToGuid[m[0]] = guid;
  }
  const isWidget = (el) => /^u\\d+$/.test(el.id);
  function ownedText(el) {
    let t = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) t += n.nodeValue;
      else if (n.nodeType === 1) { if (isWidget(n)) continue; t += ownedText(n); }
    }
    return t;
  }
  function visibleState(el) {
    let n = el;
    while (n && n !== document.body) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      n = n.parentElement;
    }
    return true;
  }
  const els = Array.from(document.querySelectorAll('[id]')).filter(el => /^u\\d+$/.test(el.id));
  const widgets = [];
  for (const el of els) {
    const text = ownedText(el).replace(/\\s+/g, ' ').trim();
    const guid = uidToGuid[el.id];
    const meta = guid ? byGuid[guid] : null;
    const r = el.getBoundingClientRect();
    const label = (meta && meta.label) || el.getAttribute('data-label') || '';
    if (!text && !label) continue;
    widgets.push({ uid: el.id, label, type: (meta && meta.friendlyType) || '',
      x: Math.round(r.x + window.scrollX), y: Math.round(r.y + window.scrollY),
      w: Math.round(r.width), h: Math.round(r.height),
      vis: visibleState(el), text: text.slice(0, 300) });
  }
  widgets.sort((a,b) => (a.vis === b.vis) ? (a.y - b.y) : (a.vis ? -1 : 1));
  const annotations = [];
  if (model && model.page && Array.isArray(model.page.annotations)) {
    for (const a of model.page.annotations) {
      const guid = a.ownerId;
      const p = String(paths[guid] || '');
      const m = p.match(/u\\d+$/);
      const ownerUid = m ? m[0] : '';
      const meta = byGuid[guid] || {};
      const ownerEl = ownerUid ? document.getElementById(ownerUid) : null;
      const fields = {};
      for (const [k,v] of Object.entries(a)) {
        if (k === 'fn' || k === 'ownerId') continue;
        const t = htmlToText(v);
        if (t) fields[k] = t;
      }
      annotations.push({ fn: a.fn, ownerUid, ownerLabel: meta.label || '', ownerType: meta.friendlyType || '', ownerText: ownerEl ? ownedText(ownerEl).replace(/\\s+/g,' ').trim().slice(0,200) : '', fields });
    }
  }
  const interactions = [];
  function walkI(objs) {
    for (const o of (objs||[])) {
      if (o.interactionMap) {
        const p = String(paths[o.id] || '');
        const m = p.match(/u\\d+$/);
        const events = [];
        for (const [evName, ev] of Object.entries(o.interactionMap)) {
          const cases = (ev.cases || []).map(c => ({
            desc: c.description || '',
            actions: (c.actions || []).map(a => a.displayName || a.description || a.action).filter(Boolean)
          }));
          events.push({ event: ev.description || evName, cases });
        }
        interactions.push({ uid: m ? m[0] : '', label: o.label || '', type: o.friendlyType || '', events });
      }
      for (const k of ['objs','objects']) if (Array.isArray(o[k])) walkI(o[k]);
    }
  }
  if (model && model.page) {
    walkI(model.page.diagram && model.page.diagram.objects);
    if (model.masters) for (const mm of Object.values(model.masters)) if (mm && mm.diagram) walkI(mm.diagram.objects);
  }
  const hiddenTexts = widgets.filter(w => !w.vis && w.text).map(w => w.text);
  return { name: (model && model.page && model.page.name) || document.title, widgetCount: widgets.length, widgets, annotations, interactions, hiddenTexts };
})()`;

export async function processPages(nodeRepl, agent, opts) {
  const { baseUrl, outDir, tasks } = opts;
  const browser = await agent.browsers.getForUrl(baseUrl);
  const tabs = await browser.tabs.list();
  const existing = tabs.find(t => t.url && t.url.includes(new URL(baseUrl).host));
  const tab = existing ? await browser.tabs.get(existing.id) : await browser.tabs.new();
  const fs = await import("node:fs");
  fs.mkdirSync(outDir + "数据", { recursive: true });
  fs.mkdirSync(outDir + "截图", { recursive: true });
  fs.mkdirSync(outDir + "截图-交互", { recursive: true });

  async function safeScreenshot() {
    for (let i = 0; i < 3; i++) {
      try { return await tab.screenshot(); }
      catch (e) { await tab.playwright.waitForTimeout(2500); }
    }
    return null;
  }

  const results = [];
  for (const task of tasks) {
    const { file, prefix } = task;
    try {
      await tab.setViewportSize({ width: 1440, height: 900 });
      await tab.goto(baseUrl + encodeURIComponent(file));
      // 同址 goto 可能是空操作，强制真加载避免遗留状态
      await tab.reload();
      await tab.playwright.waitForLoadState({ state: "domcontentloaded" });
      await tab.playwright.waitForTimeout(2500);
      const loadCheck = await tab.playwright.evaluate(`document.querySelectorAll('[id]').length`);
      if (!loadCheck) {
        await tab.reload();
        await tab.playwright.waitForLoadState({ state: "domcontentloaded" });
        await tab.playwright.waitForTimeout(2500);
      }

      const pageName = file.replace(/\.html$/, "");
      const dataUrl = baseUrl + "files/" + encodeURIComponent(pageName) + "/data.js";
      const result = await tab.playwright.evaluate(EXTRACT_FN.replace("__DATAURL__", dataUrl));
      fs.writeFileSync(outDir + "数据/" + prefix + ".json", JSON.stringify(result, null, 1));

      const fit = await tab.playwright.evaluate(`(() => {
        const W = Math.min(Math.max(document.documentElement.scrollWidth, 1440), 1920);
        const H = Math.max(document.documentElement.scrollHeight, 900);
        const zoom = Math.min(1, 1440 / W);
        if (zoom < 1) { document.documentElement.style.zoom = zoom; }
        return { designW: W, designH: H, zoom,
          outW: Math.min(1440, Math.round(W * zoom)),
          outH: Math.min(2100, Math.round(H * zoom) + 10) };
      })()`);
      await tab.playwright.waitForTimeout(600);
      await tab.setViewportSize({ width: fit.outW, height: fit.outH });
      await tab.playwright.waitForTimeout(2000);

      const png = await safeScreenshot();
      if (png) fs.writeFileSync(outDir + "截图/" + prefix + ".png", png);
      nodeRepl.emitImage(png);
      results.push({
        prefix, name: result.name, shot: !!png, fit,
        widgets: result.widgetCount,
        annotations: result.annotations.length,
        interactions: result.interactions.length,
        hiddenTexts: result.hiddenTexts || [],
        visTexts: [...new Set(result.widgets.filter(w => w.vis && w.text).map(w => w.text))]
      });
    } catch (e) {
      results.push({ prefix, error: e.message });
    }
  }
  return results;
}

// 播放器(start.html)上下文中提取 Sitemap 叶子页清单
export async function getSitemap(nodeRepl, agent, playerUrl) {
  const browser = await agent.browsers.getForUrl(playerUrl);
  const tabs = await browser.tabs.list();
  const existing = tabs.find(t => t.url && t.url.includes(new URL(playerUrl).host));
  const tab = existing ? await browser.tabs.get(existing.id) : await browser.tabs.new();
  await tab.goto(playerUrl);
  await tab.playwright.waitForLoadState({ state: "domcontentloaded" });
  await tab.playwright.waitForTimeout(2000);
  return tab.playwright.evaluate(`(() => {
    function flat(nodes, path, out) {
      for (const n of (nodes||[])) {
        const p = [...path, n.pageName];
        if (!n.children || !n.children.length) out.push({ path: p.join('>'), name: n.pageName, url: n.url });
        else flat(n.children, p, out);
      }
      return out;
    }
    return flat(window.$axure.document.sitemap.rootNodes, [], []);
  })()`);
}

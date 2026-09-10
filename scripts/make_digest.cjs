// 从 数据/*.json 生成紧凑摘要 digest-*.md（供模型精读后撰写需求文档）
// 用法: node make_digest.cjs <输出根目录>
const fs = require('fs');
const path = require('path');
const OUTDIR = process.argv[2];
if (!OUTDIR) { console.error('用法: node make_digest.cjs <输出根目录>'); process.exit(1); }
const DIR = path.join(OUTDIR, '数据');
const OUT = path.join(DIR, 'digest');
fs.mkdirSync(OUT, { recursive: true });

let pages = 0;
for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf-8'));
  const L = [];
  L.push(`# ${f.replace('.json', '')} （页面名: ${j.name}，控件 ${j.widgetCount}）`);
  L.push('');
  L.push(`## 需求标注（${j.annotations.length} 条，编号=截图黄标）`);
  for (const a of j.annotations) {
    const fields = Object.entries(a.fields).map(([k, v]) => `${k}: ${v.replace(/\n/g, ' / ')}`).join(' || ');
    L.push(`- [#${a.fn}] 控件[${a.ownerType}] label="${a.ownerLabel}" 关联文字="${a.ownerText}"`);
    L.push(`  >> ${fields}`);
  }
  L.push('');
  L.push(`## 交互（${j.interactions.length} 处）`);
  for (const it of j.interactions) {
    for (const ev of it.events) {
      const cases = (ev.cases || []).map(c => {
        const acts = (c.actions || []).join(',');
        return `case"${c.desc}"->${acts}`;
      }).join(' ; ');
      L.push(`- [${it.uid}] label="${it.label}" ${ev.event}: ${cases}`);
    }
  }
  L.push('');
  const vis = j.widgets.filter(w => w.vis);
  const hid = j.widgets.filter(w => !w.vis);
  L.push(`## 可见控件文字（${vis.length}，格式: (uid) [label|type] x,y text）`);
  for (const w of vis) {
    if (w.text || w.label) L.push(`(${w.uid}) [${w.label}|${w.type}] ${w.x},${w.y} "${w.text}"`);
  }
  if (hid.length) {
    L.push('');
    L.push(`## 隐藏控件文字（${hid.length}，弹窗/折叠内容——文档"弹窗明细"章节必须覆盖这些内容）`);
    for (const w of hid) {
      if (w.text || w.label) L.push(`(${w.uid}) [${w.label}|${w.type}] ${w.x},${w.y} "${w.text}"`);
    }
  }
  fs.writeFileSync(path.join(OUT, f.replace('.json', '.digest.md')), L.join('\n'), 'utf-8');
  pages++;
  console.log(f, '-> annotations:', j.annotations.length, 'interactions:', j.interactions.length, 'widgets:', j.widgetCount, 'hidden:', hid.length);
}
console.log('digest 完成，共', pages, '页');

// 防遗留校验：核对每页的标注覆盖率、截图存在性、弹窗覆盖提醒
// 用法: node check_coverage.cjs <输出根目录>
// 约定：每页文档的"需求标注原文"表格中，每条标注独占一行，格式 `| <fn> | 内容 |`
//       （禁止把多个 fn 合并进一行，如 `| 2 / 3 / 6 |`，否则无法机器校验）
// 命名：数据 JSON 为 <prefix>.json；文档可为 <prefix>.md 或 <NN>-<prefix>.md；
//       整页截图为 截图/<prefix>.png 或 截图/<docBase>.png；交互截图以文档的 NN- 开头
// 退出码：有缺失=1，全部通过=0
const fs = require('fs');
const path = require('path');
const OUTDIR = process.argv[2];
if (!OUTDIR) { console.error('用法: node check_coverage.cjs <输出根目录>'); process.exit(1); }

const DIR = path.join(OUTDIR, '数据');
const jsons = fs.readdirSync(DIR).filter(x => x.endsWith('.json'));
const rootMd = fs.readdirSync(OUTDIR).filter(x => x.endsWith('.md'));

// 高频框架词识别：同一文字出现在 ≥50% 页面的隐藏控件中 = 平台导航/页签/分页等模板文字，非需求内容
const frameTexts = new Set();
{
  const pageDatas = jsons.map(f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf-8')));
  const freq = new Map();
  for (const j of pageDatas) {
    const seen = new Set();
    for (const w of (j.widgets || [])) {
      if (w.vis) continue;
      const t = w.text.replace(/[\u200b\u2060\ufeff\s*]/g, '');
      if (!t || seen.has(t)) continue;
      seen.add(t);
      freq.set(t, (freq.get(t) || 0) + 1);
    }
  }
  const threshold = Math.max(2, Math.ceil(pageDatas.length * 0.5));
  for (const [t, c] of freq) if (c >= threshold) frameTexts.add(t);
}

let fail = false;
const report = [];

for (const f of jsons) {
  const prefix = f.replace('.json', '');
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf-8'));
  const row = { page: prefix };

  // 1. 文档存在性（<prefix>.md 或 <NN>-<prefix>.md 或文件名含 prefix）
  const docFile = rootMd.find(x => x === prefix + '.md' || x.endsWith('-' + prefix + '.md') || x.includes(prefix));
  row.docExists = !!docFile;
  if (!row.docExists) { fail = true; row.docMissing = true; report.push(row); continue; }
  const doc = fs.readFileSync(path.join(OUTDIR, docFile), 'utf-8');
  const nn = (docFile.match(/^(\d+)-/) || [])[1];

  // 2. 截图存在性
  const shotDir = path.join(OUTDIR, '截图');
  const pngName = fs.existsSync(shotDir) &&
    (fs.readdirSync(shotDir).find(x => x === prefix + '.png' || (nn && x === nn + '-' + prefix + '.png')));
  row.pageShot = !!pngName;

  // 3. 标注覆盖率：每个 fn 必须以 `| <fn> |` 或 `#<fn>` 形式出现在文档中
  const fns = j.annotations.map(a => String(a.fn));
  const missing = fns.filter(fn => {
    const re1 = new RegExp(`\\|\\s*${fn}\\s*\\|`);
    const re2 = new RegExp(`#${fn}\\b`);
    return !(re1.test(doc) || re2.test(doc));
  });
  row.annotations = { total: fns.length, missing: missing, covered: fns.length - missing.length };
  if (missing.length) fail = true;

  // 4. 隐藏控件（弹窗内容）清单——提醒人工核对"弹窗明细"章节
  //    清洗：零宽字符/空白/*号；跳过：黄标编号组、原型示例占位数据、通用上传模板文案、
  //    高频框架词（出现在≥一半页面中的相同文字=平台导航/页签/分页）、页面说明红字前缀（模板要求必须转写）
  const clean = (s) => s.replace(/[\u200b\u2060\ufeff\s*（）()\/、。，；：%]/g, '');
  const isFlagGroup = (s) => /^[\d,，、.]+$/.test(s);
  const isSampleData = (s) =>
    s.includes('XXX') || s.startsWith('选项一') || s.startsWith('变更了') || s.startsWith('请选择') ||
    s.includes('张三') || s.includes('李四') || /20\d{2}-\d{2}-\d{2}/.test(s) || /[:：]\d{11}/.test(s) ||
    /^(张三|李四|王强|冯涛|赵娟|何丽|陈静|刘伟|孙磊)/.test(s) ||
    /^[\d:.\-年月日时分秒天小时个次套页吨千克克只%百分类/.]+$/.test(s) ||
    /^(共|前往)/.test(s);
  const isTemplateText = (s) =>
    s.startsWith('支持上传多个') || s.startsWith('只能上传单个文件') || s === '点击上传' ||
    /^(填报说明|功能说明)/.test(s);
  const hiddenAll = (j.widgets || []).filter(w => !w.vis && clean(w.text) && !isFlagGroup(clean(w.text)));
  const hidden = hiddenAll.filter(w => {
    const t = clean(w.text);
    return t.length >= 4 && !isSampleData(t) && !isTemplateText(t) && !frameTexts.has(t);
  });
  row.hiddenTexts = { count: hidden.length, sample: [...new Set(hidden.map(w => clean(w.text)))].slice(0, 8) };
  if (hidden.length) {
    const docNorm = doc.replace(/[^A-Za-z0-9\u4e00-\u9fa5\u00b3]/g, '');
    const uncovered = hidden.filter(w => {
      const t = clean(w.text);
      if (docNorm.includes(t.slice(0, 12))) return false;
      // 宽松兜底：头4字与尾6字都能命中视为已覆盖（下拉选项串/列名组合）
      return !(t.length >= 8 && docNorm.includes(t.slice(0, 4)) && docNorm.includes(t.slice(-6)));
    });
    row.hiddenCovered = { covered: hidden.length - uncovered.length, total: hidden.length };
    row.hiddenUncovered = [...new Set(uncovered.map(w => clean(w.text)))].slice(0, 12);
    if (uncovered.length) fail = true;
  }

  // 5. 交互与交互截图数量（提醒核对）
  row.interactions = (j.interactions || []).length;
  const shotDirI = path.join(OUTDIR, '截图-交互');
  if (fs.existsSync(shotDirI)) {
    row.interactionShots = nn
      ? fs.readdirSync(shotDirI).filter(x => x.startsWith(nn + '-')).length
      : fs.readdirSync(shotDirI).length;
  }

  report.push(row);
}

// 输出报告
console.log('=== 防遗留校验报告 ===');
for (const r of report) {
  const flags = [];
  if (r.docMissing) flags.push('❌ 缺文档');
  else {
    if (!r.pageShot) { flags.push('❌ 缺整页截图'); }
    if (r.annotations && r.annotations.missing.length) flags.push(`❌ 标注缺失 #${r.annotations.missing.join(' #')}`);
    if (r.hiddenUncovered && r.hiddenUncovered.length) {
      flags.push(`❌ 弹窗内容未写入文档 ${r.hiddenCovered.covered}/${r.hiddenCovered.total}`);
    }
  }
    if (!flags.length) flags.push('✅');
    if (r.hiddenUncovered && r.hiddenUncovered.length) flags.push('   未覆盖弹窗文字: ' + JSON.stringify(r.hiddenUncovered));
    console.log(`\n[${r.page}] ${flags.join(' ')}`);
  console.log(`   文档:${r.docExists ? '有' : '无'} 整页截图:${r.pageShot ? '有' : '无'} 标注:${r.annotations ? r.annotations.covered + '/' + r.annotations.total : '-'} 隐藏控件:${r.hiddenTexts ? r.hiddenTexts.count : 0} 交互:${r.interactions} 交互截图:${r.interactionShots ?? '-'}`);
}
console.log('\n' + (fail ? '❌ 存在遗留项，必须补齐后重新校验' : '✅ 全部通过，无遗留项'));
process.exit(fail ? 1 : 0);

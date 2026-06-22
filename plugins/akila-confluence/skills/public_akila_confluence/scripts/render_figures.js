// Render figures of an HTML file to tight PNGs via headless system Chrome.
// No npm install, no ImageMagick trim: window size is computed from the figure's
// own metrics (SVG viewBox, or monospace char count) and the element is centred,
// so the capture is clean. Chrome runs with a throwaway --user-data-dir so it
// never attaches to a running Chrome.
//
// Usage:  node render_figures.js <config.json>
//
// config.json:
// {
//   "src":   "docs/posts/03-encoding-akila-boundary.html",
//   "out":   "docs/posts/img",            // PNGs written here as <name>.png
//   "chrome":"C:/Program Files/Google/Chrome/Application/chrome.exe",  // optional
//   "scale": 2,                           // device scale (2 = retina)
//   "groups": [
//     { "class": "svgbox", "type": "svg",  "names": ["overview","caseA-fig"] },
//     { "class": "enc",    "type": "mono", "names": ["caseA-array"] }
//   ]
// }
// Each group collects every <div class="CLASS"> in document order and pairs it
// with names[i]; counts must match.  type "svg": element holds <svg viewBox=...>.
// type "mono": white-space:pre monospace text.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const cfgPath = process.argv[2];
if (!cfgPath) { console.error('usage: node render_figures.js <config.json>'); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const CHROME = cfg.chrome || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = cfg.out || 'img';
const SCALE = cfg.scale || 2;
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const src = fs.readFileSync(cfg.src, 'utf8');
const css = (src.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];

function pageHTML(inner, extra, winW, winH) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}
html,body{margin:0;padding:0;background:#fff}
body{width:${winW}px;height:${winH}px;display:flex;align-items:center;justify-content:center}
${extra}</style></head><body>${inner}</body></html>`;
}

const jobs = [];
for (const g of cfg.groups) {
  const re = new RegExp(`<div class="${g.class}"[\\s\\S]*?<\\/div>`, 'g');
  const blocks = src.match(re) || [];
  if (blocks.length !== g.names.length)
    console.warn(`WARN class=${g.class}: found ${blocks.length} blocks but ${g.names.length} names`);
  blocks.forEach((block, i) => {
    const name = g.names[i]; if (!name) return;
    let winW, winH, extra;
    if (g.type === 'svg') {
      const m = block.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
      const vbW = Math.round(+m[1]), vbH = Math.round(+m[2]);
      winW = vbW + 110; winH = vbH + 110;
      extra = `.${g.class}{width:${vbW}px}.${g.class} svg{width:100%;height:auto;display:block}`;
    } else { // mono
      const text = block.replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      const lines = text.split('\n').filter(l => l.trim().length);
      const maxLen = Math.max(...lines.map(l => l.length));
      const contentW = Math.ceil(maxLen * 7.85) + 40;   // 13px monospace ~7.85px/char
      const contentH = Math.ceil(lines.length * 22.1) + 36;
      winW = contentW + 70; winH = contentH + 60;
      extra = `.${g.class}{margin:0}`;
    }
    const htmlFile = path.join(OUT, `_r_${g.class}_${i}.html`);
    fs.writeFileSync(htmlFile, pageHTML(block, extra, winW, winH));
    jobs.push({ html: htmlFile, png: path.join(OUT, `${name}.png`), w: winW, h: winH });
  });
}

const udd = path.resolve(OUT, '_chrome_profile');
for (const j of jobs) {
  const url = 'file:///' + path.resolve(j.html).replace(/\\/g, '/');
  const out = path.resolve(j.png);
  const cmd = `"${CHROME}" --headless=new --no-sandbox --disable-gpu --hide-scrollbars ` +
    `--user-data-dir="${udd}" --force-device-scale-factor=${SCALE} --default-background-color=ffffffff ` +
    `--screenshot="${out}" --window-size=${j.w},${j.h} "${url}"`;
  try {
    execSync(cmd, { stdio: 'ignore', timeout: 60000 });
    const ok = fs.existsSync(out) ? (fs.statSync(out).size + 'B') : 'MISSING';
    console.log(`rendered ${path.basename(j.png)} (${j.w}x${j.h}) -> ${ok}`);
  } catch (e) { console.log('FAIL ' + j.png + ': ' + e.message); }
}

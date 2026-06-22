// Upload files as attachments to a Confluence page over REST — the piece the
// Atlassian MCP has no tool for. Re-uploading an existing filename creates a new
// version (safe to re-run). Node 20+ built-ins only (fetch, FormData, openAsBlob).
//
// Usage:  node upload_attachments.js <config.json>
//
// config.json:
// {
//   "pageId": "2079391757",
//   "files":  ["docs/posts/img/enc-*.png"]   // literal paths or simple * globs
// }
// Optional overrides: "base" (…/wiki/rest/api), "secrets" (email\ntoken file).
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const SECRETS = cfg.secrets || process.env.CONFLUENCE_SECRETS || 'F:/WORKSPACE/UsdStack/.secrets/confluence.txt';
const BASE = cfg.base || process.env.CONFLUENCE_BASE || 'https://akila3d-portal.atlassian.net/wiki/rest/api';
const [email, token] = fs.readFileSync(SECRETS, 'utf8').split(/\r?\n/);
const AUTH = 'Basic ' + Buffer.from(email.trim() + ':' + token.trim()).toString('base64');

// expand simple *-globs against the directory of each pattern
function expand(patterns) {
  const out = [];
  for (const p of patterns) {
    if (!p.includes('*')) { out.push(p); continue; }
    const dir = path.dirname(p), star = new RegExp('^' + path.basename(p).replace(/[.+]/g, '\\$&').replace(/\*/g, '.*') + '$');
    for (const f of fs.readdirSync(dir)) if (star.test(f)) out.push(path.join(dir, f));
  }
  return out;
}

(async () => {
  const files = expand(cfg.files);
  if (!files.length) { console.error('no files matched'); process.exit(1); }
  const url = `${BASE}/content/${cfg.pageId}/child/attachment`;
  for (const file of files) {
    const fd = new FormData();
    fd.append('file', await fs.openAsBlob(file), path.basename(file));
    fd.append('minorEdit', 'true');
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: AUTH, 'X-Atlassian-Token': 'no-check' },
      body: fd,
    });
    const out = await res.json().catch(() => ({}));
    const id = out.results && out.results[0] && out.results[0].id;
    console.log(`POST ${res.status}  ${path.basename(file)}  -> ${id || JSON.stringify(out.message || out)}`);
    if (!res.ok) process.exitCode = 1;
  }
})();

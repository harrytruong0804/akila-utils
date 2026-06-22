// Create or update a Confluence page body over REST in storage format, so
// <ac:image>/<ri:attachment> macros survive (the MCP html path can strip them).
// Update GETs the current version and PUTs version+1.
//
// Usage:  node push_page.js <config.json>
//
// Update an existing page:
// { "pageId": "2079391757",
//   "title":  "Encoding the Boundary — akila:boundary by example",
//   "bodyFile": "docs/posts/_body.html" }
//
// Create a new page (then attach to the printed id, then update with the image body):
// { "action": "create",
//   "spaceKey": "AKILA", "parentId": "2038693890",
//   "title": "My new page", "bodyFile": "docs/posts/_body.html" }
//
// Optional overrides: "base" (…/wiki/rest/api), "secrets" (email\ntoken file).
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const SECRETS = cfg.secrets || process.env.CONFLUENCE_SECRETS || 'F:/WORKSPACE/UsdStack/.secrets/confluence.txt';
const BASE = cfg.base || process.env.CONFLUENCE_BASE || 'https://akila3d-portal.atlassian.net/wiki/rest/api';
const [email, token] = fs.readFileSync(SECRETS, 'utf8').split(/\r?\n/);
const AUTH = 'Basic ' + Buffer.from(email.trim() + ':' + token.trim()).toString('base64');
const body = fs.readFileSync(cfg.bodyFile, 'utf8');
const H = { Authorization: AUTH, 'Content-Type': 'application/json' };

(async () => {
  if (cfg.action === 'create') {
    const payload = {
      type: 'page', title: cfg.title,
      space: { key: cfg.spaceKey },
      body: { storage: { value: body, representation: 'storage' } },
      ...(cfg.parentId ? { ancestors: [{ id: String(cfg.parentId) }] } : {}),
    };
    const res = await fetch(`${BASE}/content`, { method: 'POST', headers: H, body: JSON.stringify(payload) });
    const out = await res.json();
    console.log(`CREATE ${res.status}  id=${out.id || JSON.stringify(out.message || out)}  title=${JSON.stringify(out.title)}`);
    return;
  }
  // update
  const u = `${BASE}/content/${cfg.pageId}`;
  const cur = await (await fetch(`${u}?expand=version`, { headers: { Authorization: AUTH } })).json();
  const next = cur.version.number + 1;
  const res = await fetch(u, {
    method: 'PUT', headers: H,
    body: JSON.stringify({ type: 'page', title: cfg.title || cur.title,
      version: { number: next }, body: { storage: { value: body, representation: 'storage' } } }),
  });
  const out = await res.json();
  console.log(`PUT ${res.status}  version=${out.version && out.version.number}  title=${JSON.stringify(out.title || out.message || out)}`);
  if (!res.ok) process.exitCode = 1;
})();

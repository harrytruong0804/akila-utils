---
name: public_akila_confluence
description: Create, write, or edit any Confluence page in the Akila space. Combines the Atlassian Confluence MCP with a REST helper so pages can carry images/attachments. USE FOR ANY request to publish/author/update Confluence content — especially when the content comes from an HTML file or contains figures/diagrams or color-coded text that must stay visible.
---

# public_akila_confluence

Publish content to Confluence in the **AKILA** space, preserving visualization.

Site: `https://akila3d-portal.atlassian.net/wiki` · space **AKILA** (cloudId `akila3d-portal.atlassian.net`).
Credentials: `F:/WORKSPACE/UsdStack/.secrets/confluence.txt` — line 1 = email, line 2 = API token (Basic auth). Override with env `CONFLUENCE_SECRETS`.

## When to use

ANY request to create / write / edit / update content on a Confluence page. This skill is the single entry point for Confluence authoring. It wraps the Atlassian MCP and adds image/attachment support the MCP lacks.

## The one decision: does the content need rasterized images?

```
Content to publish
│
├─ No images, and all color is semantic (callouts, code, status)
│     → TEXT PATH: Confluence MCP only. Done.
│
└─ Has bitmap images, OR comes from an HTML file whose figures/diagrams
   or color-coded text carry meaning that storage-format would strip
         → IMAGE PATH: render → attach → embed.
```

**Why the split.** Confluence storage format discards inline CSS color on text/`<span style>`. So color that *means* something survives only two ways:
- **Native macro** — info/note/warning/success panels, code blocks, status lozenges. Confluence keeps their color. **Prefer this** for callouts, code, badges.
- **Rasterized PNG** — only when color is bound to a *figure* (SVG diagram) or to *aligned monospace* (a color-coded array) that no macro can express.

Never rasterize a whole article. Rasterize *figures*; keep prose, tables, callouts, and code as native storage so they stay searchable, copyable, and themable.

---

## TEXT PATH (no images)

Use the Atlassian Confluence MCP directly:
- Create: `mcp__claude_ai_Atlassian__createConfluencePage` (cloudId `akila3d-portal.atlassian.net`, spaceId/parent as needed, `contentFormat` html or markdown).
- Edit: `mcp__claude_ai_Atlassian__updateConfluencePage`.
- Find ids first with `getConfluenceSpaces` / `getPagesInConfluenceSpace` / `getConfluencePage`.

That is the whole text path. Do not invoke the REST scripts.

---

## IMAGE PATH (figures / color-coded text / attachments)

Five steps. MCP is used for discovery + page creation; REST scripts cover the two things MCP can't do (attach files, write `ac:image` storage reliably).

### 1. Author the content as a standalone HTML file
Put figures in the HTML as **inline `<svg>`** (vector, crisp, sized by `viewBox`) and color-coded data as **monospace blocks**. Mark each renderable figure with a class the render config can find. Keep callouts as ordinary HTML — they become native panels in step 4, not images.
Reference: `reference/storage-format.md` for the macros available.

### 2. Render figures → tight PNG
Heuristic renderer using system Chrome (no npm install). Each figure must be one of:
- `type: "svg"` — an element containing an `<svg viewBox="0 0 W H">`; sized from the viewBox.
- `type: "mono"` — a `white-space:pre` monospace block of color-coded text; sized from char metrics.

```bash
node scripts/render_figures.js <render-config.json>
```
Config shape (see `scripts/render_figures.js` header for a full example):
```json
{ "src": "docs/posts/03-encoding-akila-boundary.html",
  "out": "docs/posts/img",
  "scale": 2,
  "groups": [ { "class": "svgbox", "type": "svg",  "names": ["overview","caseA-fig"] },
              { "class": "enc",    "type": "mono", "names": ["caseA-array"] } ] }
```
> For an arbitrary colored HTML block that is **not** SVG or monospace, either redraw it as inline SVG (preferred) or screenshot the element with the **playwright MCP** (`browser_navigate` the `file://` URL → `browser_take_screenshot` of the element ref) — the Chrome heuristic only sizes svg/mono cleanly.

### 3. Create (or locate) the target page via MCP — get its `pageId`
You must have a page id before attaching. Create the page with a placeholder body via `createConfluencePage`, or reuse an existing id.

### 4. Upload the PNGs as attachments (REST — MCP can't)
```bash
node scripts/upload_attachments.js <attach-config.json>
```
```json
{ "pageId": "2079391757", "files": ["docs/posts/img/enc-*.png"] }
```
Re-uploading the same filename creates a new attachment version — safe to re-run.

### 5. Write the page body embedding the attachments (REST, storage format)
Embed each image as `<ac:image ac:width="..."><ri:attachment ri:filename="enc-overview.png"/></ac:image>` and keep everything else as native storage (panels, tables, code). Put the full body in a file and push:
```bash
node scripts/push_page.js <push-config.json>
```
```json
{ "pageId": "2079391757", "title": "Encoding the Boundary — akila:boundary by example",
  "bodyFile": "docs/posts/_body.html" }
```
`push_page.js` GETs the current version and PUTs `version+1` with `representation: storage`, so `ac:image` macros survive (the MCP html path can strip them).

---

## Notes
- Build the storage body programmatically with the helpers in `reference/storage-format.md` (`img()`, `panel()`, code macro) — they match what already ships on the AKILA pages.
- All three scripts read the same secrets file and base URL; override via env `CONFLUENCE_SECRETS`, `CONFLUENCE_BASE` if needed.
- Idempotent: render → attach → push can be re-run; attachments version, page version bumps.
- Related memory: `[[confluence-geospatial-howto-pages]]`.

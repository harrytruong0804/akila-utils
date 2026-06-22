#!/usr/bin/env node
/*
 * scaffold_post.js — turn a standalone HTML artifact into a harrytruong blog post.
 *
 * Usage:  node scaffold_post.js <config.json>
 *
 * Config shape:
 * {
 *   "blogRoot":    "F:/SOURCE/Docs/harrytruong",   // repo root (default: cwd)
 *   "src":         "F:/DATA/.../report.html",       // source HTML file
 *   "slug":        "my-post",                        // URL slug + folder name
 *   "title":       "My Post Title",
 *   "description": "One-paragraph summary for the homepage card + <meta>.",
 *   "date":        "2026-06-22",                     // YYYY-MM-DD, drives sort order
 *   "tags":        ["claude", "first-principles"]
 * }
 *
 * What it does (idempotent — safe to re-run to update an existing post):
 *   1. Reads the source HTML.
 *   2. Extracts inline <style> -> styles, inline <script> -> script, <body> -> html.
 *   3. Scopes every CSS selector under `.artifact-scope` (matching how every other
 *      post is written) so the artifact's CSS can't leak into the Next.js layout.
 *   4. Writes src/app/posts/<slug>/content.ts and page.tsx.
 *   5. Inserts the metadata entry into src/lib/posts.ts (skips if slug exists).
 *
 * It does NOT deploy. Deploy via the PR workflow (see SKILL.md) — never push to master.
 */

const fs = require("fs");
const path = require("path");

/* ---------- args ---------- */
const cfgPath = process.argv[2];
if (!cfgPath) {
  console.error("usage: node scaffold_post.js <config.json>");
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const blogRoot = path.resolve(cfg.blogRoot || process.cwd());
for (const k of ["src", "slug", "title", "description", "date"]) {
  if (!cfg[k]) { console.error(`config missing required field: ${k}`); process.exit(1); }
}
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(cfg.slug)) {
  console.error(`slug must be kebab-case [a-z0-9-]: "${cfg.slug}"`); process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.date)) {
  console.error(`date must be YYYY-MM-DD: "${cfg.date}"`); process.exit(1);
}
const tags = Array.isArray(cfg.tags) ? cfg.tags : [];

/* ---------- read + split the HTML ---------- */
const rawHtml = fs.readFileSync(path.resolve(cfg.src), "utf8");

// inline <style> blocks (concatenated)
const styleBlocks = [];
const rawCss = (rawHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [])
  .map((b) => b.replace(/<style[^>]*>/i, "").replace(/<\/style>/i, ""))
  .join("\n\n");

// inline <script> blocks WITHOUT a src= attribute (external scripts are dropped — warn)
let droppedExternal = 0;
const scriptParts = [];
(rawHtml.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || []).forEach((b) => {
  const open = b.match(/<script\b[^>]*>/i)[0];
  if (/\bsrc\s*=/.test(open)) { droppedExternal++; return; }
  scriptParts.push(b.replace(/<script\b[^>]*>/i, "").replace(/<\/script>/i, ""));
});
const script = scriptParts.join("\n\n").trim();

// body: inner <body> if present, else the whole doc minus the <head>
let body = rawHtml;
const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
if (bodyMatch) body = bodyMatch[1];
else body = body.replace(/<head[\s\S]*?<\/head>/i, "");
// strip the style/script tags we already pulled out, plus doctype/html wrappers
const html = body
  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  .replace(/<!DOCTYPE[^>]*>/gi, "")
  .replace(/<\/?html[^>]*>/gi, "")
  .trim();

/* ---------- scope the CSS under .artifact-scope ---------- */
// Brace-matching tokenizer -> array of {selector, body} | {statement}.
function splitRules(css) {
  const rules = [];
  let buf = "", i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === "{") {
      let depth = 1, j = i + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      rules.push({ selector: buf.trim(), body: css.slice(i + 1, j - 1) });
      buf = ""; i = j;
    } else if (ch === ";" && buf.trim().startsWith("@")) {
      rules.push({ statement: buf.trim() + ";" });   // e.g. @import url(...);
      buf = ""; i++;
    } else { buf += ch; i++; }
  }
  if (buf.trim()) rules.push({ statement: buf.trim() });
  return rules;
}

function scopeOne(sel) {
  if (!sel) return sel;
  // :root / html / body all map to the scope root itself, not a descendant.
  const m = sel.match(/^(:root|html|body)\b/i);
  if (m) return sel.replace(m[0], ".artifact-scope");
  return ".artifact-scope " + sel;
}
const scopeSelectorList = (s) => s.split(",").map((x) => scopeOne(x.trim())).join(", ");

function scopeCss(css) {
  return splitRules(css).map((r) => {
    if (r.statement) return r.statement;            // @import/@charset/leftover
    const sel = r.selector, low = sel.toLowerCase();
    // at-rules whose inner block must NOT be scoped (keyframe stops, font descriptors)
    if (/^@(-\w+-)?keyframes|^@font-face|^@page|^@font-feature-values|^@property/.test(low)) {
      return `${sel} {${r.body}}`;
    }
    // conditional groups: keep the wrapper, recurse into the inner rules
    if (/^@(media|supports|container|layer|scope)\b/.test(low)) {
      return `${sel} {\n${scopeCss(r.body)}\n}`;
    }
    if (sel.startsWith("@")) return `${sel} {${r.body}}`;
    return `${scopeSelectorList(sel)} {${r.body}}`;
  }).join("\n");
}
const scopedCss = rawCss.trim() ? scopeCss(rawCss) : "";

/* ---------- emit content.ts (template-literal exports) ---------- */
// Escape for a JS template literal: backslash, backtick, and ${ interpolation.
const tl = (s) => s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
const contentTs =
  `export const styles = \`\n${tl(scopedCss)}\n\`;\n\n` +
  `export const html = \`\n${tl(html)}\n\`;\n\n` +
  `export const script = \`\n${tl(script)}\n\`;\n`;

/* ---------- emit page.tsx ---------- */
const pascal = cfg.slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("");
const pageTsx =
`import type { Metadata } from "next";
import { getPost } from "@/lib/posts";
import ArtifactEmbed from "@/components/artifact-embed";
import { styles, html, script } from "./content";

const post = getPost("${cfg.slug}")!;

export const metadata: Metadata = {
  title: \`\${post.title} | harrytruong\`,
  description: post.description,
};

export default function ${pascal}Page() {
  return <ArtifactEmbed styles={styles} html={html} script={script} />;
}
`;

const postDir = path.join(blogRoot, "src", "app", "posts", cfg.slug);
fs.mkdirSync(postDir, { recursive: true });
fs.writeFileSync(path.join(postDir, "content.ts"), contentTs);
fs.writeFileSync(path.join(postDir, "page.tsx"), pageTsx);

/* ---------- register in src/lib/posts.ts ---------- */
const postsPath = path.join(blogRoot, "src", "lib", "posts.ts");
let postsSrc = fs.readFileSync(postsPath, "utf8");
let registered = false;
if (postsSrc.includes(`slug: "${cfg.slug}"`)) {
  console.log(`! posts.ts already has slug "${cfg.slug}" — leaving metadata untouched`);
} else {
  const q = (s) => JSON.stringify(s);
  const entry =
`  {
    slug: ${q(cfg.slug)},
    title: ${q(cfg.title)},
    description: ${q(cfg.description)},
    date: ${q(cfg.date)},
    tags: [${tags.map(q).join(", ")}],
  },
`;
  const anchor = "export const posts: Post[] = [\n";
  const at = postsSrc.indexOf(anchor);
  if (at === -1) { console.error("could not find posts array anchor in posts.ts"); process.exit(1); }
  const insertAt = at + anchor.length;
  postsSrc = postsSrc.slice(0, insertAt) + entry + postsSrc.slice(insertAt);
  fs.writeFileSync(postsPath, postsSrc);
  registered = true;
}

/* ---------- report ---------- */
console.log(`✓ wrote ${path.relative(blogRoot, path.join(postDir, "content.ts"))}`);
console.log(`✓ wrote ${path.relative(blogRoot, path.join(postDir, "page.tsx"))}`);
console.log(registered ? `✓ registered "${cfg.slug}" in src/lib/posts.ts` : `· posts.ts unchanged`);
if (droppedExternal) console.log(`! dropped ${droppedExternal} external <script src> tag(s) — inline them or add to the post manually`);
console.log(`\nNext: review the files, then ship via PR (NEVER push master):`);
console.log(`  cd "${blogRoot}"`);
console.log(`  git checkout -b post/${cfg.slug}`);
console.log(`  git add -A && git commit -m "Add post: ${cfg.slug}"`);
console.log(`  git push -u origin post/${cfg.slug}`);
console.log(`  gh pr create --base master --fill && gh pr merge --merge --delete-branch`);
console.log(`Preview locally: npm run dev  ->  http://localhost:3000/posts/${cfg.slug}`);

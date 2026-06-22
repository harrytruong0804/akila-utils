---
name: public_harry_blog
description: Publish an HTML artifact as a full post on the harrytruong Next.js blog (harrytruong.vercel.app) — the post is listed on the homepage and lives at /posts/<slug>. USE FOR ANY request to publish/post/add an HTML file or content as a (public, listed) blog post on harry's blog. Splits the HTML into scoped styles/html/script, scaffolds the route, registers metadata, and ships via the owner-attributed PR workflow Vercel Hobby requires. (For an UNLISTED secret link instead, this is the wrong skill — that drops raw HTML into public/r-<hash>/.)
---

# public_harry_blog

Publish an HTML artifact as a **full, homepage-listed post** on the harrytruong blog
(Next.js App Router, repo `F:/SOURCE/Docs/harrytruong`, deployed to Vercel).

## When to use

ANY request to publish / post / add content or an HTML file as a real blog post on
harry's blog — i.e. it should appear on the homepage and live at `/posts/<slug>`.

**Not this skill** when the user wants a *secret/unlisted* link with the HTML kept
byte-for-byte (no homepage entry): that path drops the file at
`public/r-<random-hash>/index.html` and is served statically — handle it directly,
don't use this skill.

## How the blog renders a post (the contract you must satisfy)

A post is two files in `src/app/posts/<slug>/` plus one metadata entry:

- `content.ts` — exports three template-literal strings: `styles`, `html`, `script`.
- `page.tsx` — a thin wrapper: `<ArtifactEmbed styles={styles} html={html} script={script} />`.
- `src/lib/posts.ts` — one object in the `posts` array (`slug,title,description,date,tags`).

`ArtifactEmbed` (`src/components/artifact-embed.tsx`) renders `<style>{styles}` once,
drops `html` into `<div class="artifact-scope">`, then re-executes `script` and hoists
its top-level `function`s onto `window` so inline `onclick=` handlers keep working.

**The one hard rule: all CSS must be scoped under `.artifact-scope`.** The artifact's
styles share the page with the Next.js layout; unscoped `body{}`, `:root{}`, `h1{}`
etc. would leak out and wreck the site. The scaffold script does this automatically.

## Workflow

### 1. Gather metadata
You need: `slug` (kebab-case), `title`, `description` (one paragraph for the homepage
card + `<meta>`), `date` (`YYYY-MM-DD`, controls sort order — newest first), `tags`.
Ask the user for anything missing; infer sensible defaults from the HTML `<title>`/`<h1>`.

### 2. Scaffold from the source HTML
```bash
node scripts/scaffold_post.js <config.json>
```
```json
{
  "blogRoot": "F:/SOURCE/Docs/harrytruong",
  "src": "F:/DATA/.../report.html",
  "slug": "my-post",
  "title": "My Post Title",
  "description": "One-paragraph summary shown on the homepage and in <meta>.",
  "date": "2026-06-22",
  "tags": ["claude", "first-principles"]
}
```
The script: extracts inline `<style>`→`styles`, inline `<script>`→`script`,
`<body>`→`html`; **scopes every selector under `.artifact-scope`**; writes
`content.ts` + `page.tsx`; inserts the `posts.ts` entry (skipped if the slug already
exists). It is idempotent — re-run to update the content of an existing post.

> External `<script src=...>` tags are dropped (the embed runs inline code only) — the
> script warns when it drops any. Inline the code, or add the dependency by hand.

### 3. Review + preview
- Skim `content.ts`: confirm the CSS is scoped and the `styles`/`html`/`script` split
  looks right. The scoper is a heuristic — eyeball unusual at-rules (`@media`,
  `@keyframes`, `@font-face` are handled; deeply nested/odd CSS may need a touch-up).
- Preview locally: `npm run dev` → `http://localhost:3000/posts/<slug>`, and check the
  homepage lists the card. Optionally `npm run build` to catch type errors.

### 4. Ship via the PR workflow (NEVER push to master)
Vercel Hobby only lets the repo **owner** deploy; a merge commit is owner-attributed,
a direct push from another git author is **blocked**. So always:
```sh
cd F:/SOURCE/Docs/harrytruong
git checkout -b post/<slug>
git add -A && git commit -m "Add post: <slug>"
git push -u origin post/<slug>
gh pr create --base master --fill
gh pr merge --merge --delete-branch
```
Use `--merge` (not squash/rebase) to match the "Merge pull request #N" history. Do not
add `Co-Authored-By` trailers (Vercel Hobby treats them as collaborators and blocks).

## Notes
- Reads/writes only inside `blogRoot`; the source HTML can live anywhere.
- The CSS scoper handles `:root`/`html`/`body` → `.artifact-scope`, prefixes ordinary
  selectors, recurses into `@media`/`@supports`, and leaves `@keyframes`/`@font-face`
  inner blocks untouched.
- Sort order is by `date` descending (`getAllPosts` in `posts.ts`); the exact array
  position doesn't matter.

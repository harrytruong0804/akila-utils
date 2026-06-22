# Confluence storage-format cheatsheet (AKILA)

Build the page body with these. Color that is *semantic* should be a native macro;
rasterize to PNG only when color is bound to a figure (SVG) or aligned monospace.

## Embed an uploaded attachment as an image
```html
<ac:image ac:align="center" ac:width="830" ac:alt="Encoding overview">
  <ri:attachment ri:filename="enc-overview.png"/>
</ac:image>
```
`ac:width` is display width in px (use the figure's natural width / scale).
The filename must match what `upload_attachments.js` POSTed to the page.

## Colored callout panels — keep these native, don't rasterize
```html
<ac:structured-macro ac:name="info">    <ac:rich-text-body><p>…</p></ac:rich-text-body></ac:structured-macro>
<ac:structured-macro ac:name="note">    <ac:rich-text-body><p>…</p></ac:rich-text-body></ac:structured-macro>
<ac:structured-macro ac:name="warning"> <ac:rich-text-body><p>…</p></ac:rich-text-body></ac:structured-macro>
<ac:structured-macro ac:name="tip">     <ac:rich-text-body><p>…</p></ac:rich-text-body></ac:structured-macro>
```

## Code block (syntax highlight kept by Confluence)
```html
<ac:structured-macro ac:name="code">
  <ac:parameter ac:name="language">python</ac:parameter>
  <ac:plain-text-body><![CDATA[ def f(): ... ]]></ac:plain-text-body>
</ac:structured-macro>
```

## Status lozenge (colored badge)
```html
<ac:structured-macro ac:name="status">
  <ac:parameter ac:name="colour">Green</ac:parameter>
  <ac:parameter ac:name="title">DONE</ac:parameter>
</ac:structured-macro>
```

## JS helpers (match what already ships on AKILA pages)
```js
const W = { 'overview': 830, 'caseA-fig': 630 };  // display widths per figure key
const img   = (key, alt) => `<ac:image ac:align="center" ac:width="${W[key]}" ac:alt="${alt}"><ri:attachment ri:filename="${key}.png"/></ac:image>`;
const panel = (name, html) => `<ac:structured-macro ac:name="${name}"><ac:rich-text-body>${html}</ac:rich-text-body></ac:structured-macro>`;
```

## Plain elements that pass through storage as-is
`<p> <h2> <h3> <ul><li> <ol><li> <table><tbody><tr><th><td> <blockquote> <code> <strong> <em>`.
Inline `style="color:…"` on text is **stripped** — that is why color-coded data must be a PNG or a macro.

---
name: usd-viewer-local-debug
description: >
  Switch the Akila web-user-platform USD viewer (src/views/digital-twin/open-usd) from
  cloud streaming to a LOCAL Kit/Omniverse streaming server for debugging. USE FOR ANY
  request to "debug the usd viewer locally", "point the viewer at a local Kit server",
  "connect to local streaming", "run open-usd locally", or when the user mentions
  STREAM_CONFIG, usd-config.js, source:'local', forceWSS, the Omniverse/Kit streaming
  app, or "why is the viewer trying to authenticate / use WSS locally". Also covers the
  Windows dev-build prerequisites needed to even run `npm run serve` on this repo
  (cross-env, thread-loader instead of HappyPack, private Azure DevOps npm auth) and the
  datacenter switch in serverConfig.json. Edits the web-user-platform repo, not this one.
---

# USD Viewer — Local Streaming Debug

Flip the Akila **web-user-platform** USD viewer so its WebRTC stream comes from a Kit
/ Omniverse streaming server **running on your LAN** instead of the cloud streaming
service. Use this when you have a local Kit app (or a colleague's workstation) serving
the `usd-viewer` stream and you want the Vue app to render against it.

> **Scope:** this skill edits the `web-user-platform` repo (default
> `F:/SOURCE/USD/web-user-platform`). Confirm the path with the user if it differs.
> Every change below is a **local-only toggle** — it must NOT be committed to the app
> repo. Remind the user to revert before pushing (see *Revert* at the end).

## When to use

- "Let me debug the USD viewer against my local Kit server / workstation."
- The viewer connects to cloud streaming but you need to test local Kit changes.
- The stream fails locally with auth or secure-WebSocket (WSS) errors.
- `npm run serve` won't even start on Windows, or the build dies in HappyPack.

## The contract — what "local mode" actually means

The single source of truth is
`src/views/digital-twin/open-usd/utils/usd-config.js`. Two objects control the
connection:

```js
export const STREAM_CONFIG = {
  source: 'local',            // 'stream' = cloud streaming service, 'local' = LAN Kit server
  name: 'Bouygues',
  stream: { applicationId: 'usd-viewer', /* … cloud opts … */ },
  local: {
    server: '10.164.24.130'   // ← IP/host of the machine running the local Kit stream
  }
};

export const DEFAULT_STREAM_OPTIONS = {
  // …
  authenticate: false,        // local Kit servers usually have no auth gateway
  maxReconnects: 1,
  forceWSS: false,            // local Kit serves plain ws://, not wss://
  logLevel: 'WARN'            // bump to 'INFO'/'DEBUG' while chasing a stream issue
};
```

Why each flip matters:
- **`source: 'local'`** routes the connection through `STREAM_CONFIG.local.server`
  instead of the cloud streaming URL builder.
- **`local.server`** is the LAN IP/hostname of the Kit/Omniverse box. Ask the user —
  it changes per machine/session (the value above is only an example).
- **`authenticate: false`** — the cloud path goes through an auth gateway; a bare local
  Kit server has none, so leaving this `true` makes the handshake hang/fail.
- **`forceWSS: false`** — local Kit streams over `ws://`. Forcing WSS against a server
  with no TLS cert fails the WebSocket upgrade.

## Workflow

### 1. Confirm inputs
Ask the user for:
- **Local Kit server IP/host** (e.g. `10.164.24.130`) — required.

**Do NOT block on the datacenter.** Apply the local-mode change with whatever
`serverConfig.json` already has, then **remind the user to set the API URL to the right
datacenter** for their project (step 3). Don't try to infer it — just apply and remind.

### 2. Switch the viewer to local mode
Edit `src/views/digital-twin/open-usd/utils/usd-config.js`:
- `STREAM_CONFIG.source` → `'local'`
- `STREAM_CONFIG.local.server` → the user's Kit IP/host
- `DEFAULT_STREAM_OPTIONS.authenticate` → `false`
- `DEFAULT_STREAM_OPTIONS.forceWSS` → `false`
- (optional) `DEFAULT_STREAM_OPTIONS.logLevel` → `'INFO'` while debugging

### 3. Remind the user to set the right datacenter (don't guess it)
After applying the local-mode change, **do not infer or auto-pick the datacenter.** Apply
with whatever `serverConfig.json` currently holds, then tell the user plainly:

> "Local stream is pointed at your Kit box. Now set `VUE_APP_API_BASE_URL` in
> `public/config/serverConfig.json` to the datacenter that hosts **your** project's data,
> or the app will load the wrong site/project list."

In **local** mode only `VUE_APP_API_BASE_URL` strictly matters — it must point at the DC
that actually hosts the project/stage data, so REST calls (project list, scene tree,
auth-free reads) resolve. The streaming/STUN hosts are bypassed (the stream comes from
`STREAM_CONFIG.local.server`), so they can stay on any DC — but keep the whole set
consistent if the user ever flips `source` back to `'stream'`.

Reference sets — let the **user** pick the one matching their project (most Akila projects,
e.g. **CGCO** on `nucleus-fr.akila3d.com`, are **FR**):
```jsonc
// FR
{ "VUE_APP_API_BASE_URL": "https://fr-api.akila3d.com/", "VUE_APP_DC": "fr",
  "VUE_APP_STREAMING_BASE_URL": "https://streaming-fr-staging.akila3d.com",
  "VUE_APP_STREAMING_STUN_SERVER": "nucleus-fr.akila3d.com:3478" }
// US
{ "VUE_APP_API_BASE_URL": "https://us-api-test.akila3d.com/", "VUE_APP_DC": "us",
  "VUE_APP_STREAMING_BASE_URL": "https://streaming-us-staging.akila3d.com",
  "VUE_APP_STREAMING_STUN_SERVER": "nucleus-us-test.akila3d.com:3478" }
// CN
{ "VUE_APP_API_BASE_URL": "https://api-test.akila3d.com/", "VUE_APP_DC": "cn",
  "VUE_APP_STREAMING_BASE_URL": "https://streaming-cn-staging.akila3d.com",
  "VUE_APP_STREAMING_STUN_SERVER": "nucleus-cn-test.akila3d.com:3478" }
```
A common working edit is changing **only** `VUE_APP_API_BASE_URL` to the right host (e.g.
`https://fr-api.akila3d.com/`). Keep `VUE_APP_DC`, API host, and STUN host on the **same**
datacenter if you set more than one.

### 4. Windows dev-build prerequisites — always apply
This repo's build assumes a POSIX shell and an old toolchain. **Apply all three by default**
— don't gate on the user's shell: the bash-style serve script and HappyPack break in
PowerShell/cmd and on modern Node, and the edits are harmless under bash/WSL. Just apply
them every time (and remind the user they're build-only, arguably worth upstreaming):

**a. `package.json` — make the serve script cross-platform**
The bare `NODE_OPTIONS=… VUE_APP_LOCAL_MODE=true vue-cli-service serve` is bash-only and
fails in PowerShell/cmd. Prefix with `cross-env`:
```json
"serve": "cross-env NODE_OPTIONS=--max-old-space-size=4096 VUE_APP_LOCAL_MODE=true vue-cli-service serve",
```
Ensure `cross-env` is installed (`npm i -D cross-env` if missing — it's usually already a dep).

**b. `vue.config.js` — replace HappyPack with thread-loader**
HappyPack is unmaintained and breaks on modern Node. Remove the `HappyPack` require, its
`happyThreadPool`, and the `new HappyPack({ id: 'babelLoader', … })` plugin, then swap the
JS rule to `thread-loader` + `babel-loader`:
```js
const jsRule = config.module.rule('js');
jsRule.uses.clear();
jsRule
  .use('thread-loader')
  .loader('thread-loader')
  .options({ workers: Math.max(1, Math.floor(os.cpus().length * 0.7)) })
  .end()
  .use('babel-loader')
  .loader('babel-loader')
  .options({ cacheDirectory: true })
  .end();
```

**c. `jsconfig.json` — silence the TS deprecation error** (only if the dev server errors on it)
```json
"compilerOptions": { "ignoreDeprecations": "6.0" }
```

**d. `.npmrc` — private Azure DevOps registry auth** (so `npm install` can fetch private pkgs)
The `@nvidia` and Azure feeds need auth tokens appended to `.npmrc`. **Never commit real
tokens.** Get yours from Azure DevOps → the feed → **Connect to feed → npm → "Other"**,
which generates a personal token block. The shape is:
```ini
; begin auth token
//pkgs.dev.azure.com/akiladev01/_packaging/akiladev01/npm/registry/:username=akiladev01
//pkgs.dev.azure.com/akiladev01/_packaging/akiladev01/npm/registry/:_password=<BASE64_TOKEN>
//pkgs.dev.azure.com/akiladev01/_packaging/akiladev01/npm/registry/:email=<you>@akila3d.com
//pkgs.dev.azure.com/akiladev01/_packaging/akiladev01/npm/:username=akiladev01
//pkgs.dev.azure.com/akiladev01/_packaging/akiladev01/npm/:_password=<BASE64_TOKEN>
//pkgs.dev.azure.com/akiladev01/_packaging/akiladev01/npm/:email=<you>@akila3d.com
; end auth token
```
Prefer putting this in your **user-level** `~/.npmrc` rather than the repo's `.npmrc`,
so a token can never be committed.

### 5. Run it
```bash
cd F:/SOURCE/USD/web-user-platform
npm install          # only if deps/.npmrc changed
npm run serve
```
Open the digital-twin / open-usd view and confirm the stream connects to the local Kit
server. If it doesn't:
- Check the browser console for the WebRTC/WebSocket target — it should be your local IP.
- Verify the Kit box is reachable (`ws://<server>:<port>`), reachable on the LAN, and the
  Kit `usd-viewer` app is actually streaming.
- Set `logLevel: 'DEBUG'` in `DEFAULT_STREAM_OPTIONS` for a verbose handshake log.

## Revert before committing
None of these belong in the app repo. Before pushing app changes:
```bash
cd F:/SOURCE/USD/web-user-platform
git checkout -- src/views/digital-twin/open-usd/utils/usd-config.js \
                public/config/serverConfig.json
```
The Windows build fixes (`cross-env`, `thread-loader`, `jsconfig`) are arguably worth
upstreaming — discuss with the team rather than auto-reverting. The `.npmrc` token block
must **always** be discarded / kept user-level.

## Notes
- The `source: 'local'` switch and the cloud path diverge entirely in how the streaming
  URL is built — read `getStreamingBaseUrl()` and the `local` branch in
  `usd-config.js` if a new option is needed.
- This skill is intentionally instruction-driven (no auto-edit script): the server IP,
  datacenter, and token are per-developer and must be supplied each time.

---
name: remote-gpu
description: >
  All the ways to SSH into a rented GPU machine (thuepcpro.vn / ezycloudx and similar
  hourly Windows GPU rentals) when the provider only port-forwards RDP and gives NO
  inbound SSH port. USE FOR ANY request like "ssh vào máy thuê", "ssh into the rented
  GPU box", "remote gpu", "bypass để ssh", "connect to thuepcpro / ezycloudx machine",
  "máy thuê chỉ có RDP làm sao SSH", "set up tailscale to the rented machine", "reverse
  ssh tunnel to GPU rental", or when the user mentions a rented RTX/GPU Windows machine
  reachable only via an RDP address like netN.thuepcpro.vn:PORT and wants shell/SSH
  access. Covers Tailscale (recommended), reverse SSH via VPS, and ngrok/Cloudflare
  tunnels, plus enabling OpenSSH Server + firewall on Windows, key auth, and a
  per-rental checklist. ALSO covers running the Akila **usd-viewer** (Omniverse Kit
  streaming app) on the rented box and connecting the web-user-platform FE to it over
  Tailscale end to end — use for "chạy usd-viewer trên gpu thuê", "run usd-viewer on
  remote gpu", "stream the viewer from the rented box", "monitor the Kit log on the
  remote box", or when remote streaming fails with "Got stop event while waiting for
  client connection" / "Client sent STUN requests but did not receive any responses".
---

# Remote GPU — SSH into a Rented GPU Machine

Hourly Windows GPU rentals (thuepcpro.vn, ezycloudx, and similar) give you a machine you
reach **only via RDP**: an address like `net4.thuepcpro.vn:59211` mapped to the machine's
RDP port. The provider forwards **exactly one inbound port (RDP)** and nothing else, so a
plain SSH server on port 22 inside the box is **unreachable from the internet**.

You DO have full Administrator inside the box (via RDP), and the box has **working
outbound internet**. Every method here exploits that: the rented machine makes an
**outbound** connection to a rendezvous point, and you SSH back through it. This is the
legitimate "bypass" — you own the rental, you're not defeating anyone's security, you're
just routing around a missing inbound port.

> **Scope:** this skill is about getting an SSH shell into a machine you have rented and
> have lawful admin access to. Do not use it to reach machines you don't control.

## Core concept (why a "bypass" is even needed)

```
Provider NAT/firewall:  INBOUND blocked (only RDP port forwarded)   OUTBOUND allowed
                                                                          │
   [Your home PC] ───────────── rendezvous (Tailscale / VPS / ngrok) ────┘
        SSH client                        ▲ rented box dials OUT to here
                                          │
                                   [Rented GPU box]  ← you are admin via RDP
```

Pick a rendezvous the rented box can dial out to, register your home PC on the same
rendezvous, then `ssh` over that path. Tailscale is the default; the other two are
fallbacks for when you can't/won't use a mesh VPN.

---

## Shared prerequisite — enable OpenSSH Server on the rented box

Every method needs an SSH **server** running inside the rented box. Run in an **Admin
PowerShell inside the RDP session**:

```powershell
# Install OpenSSH Server (Windows capability). If WU is disabled it errors 0x800f0954 —
# the fallback (winget) pulls the same binary straight from GitHub.
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
if (-not (Get-Service sshd -ErrorAction SilentlyContinue)) {
    winget install --id Microsoft.OpenSSH.Beta -e --accept-source-agreements --accept-package-agreements
}

# Start + auto-start on boot
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd

# Open firewall on ALL profiles (the Tailscale/relay NIC is often classified "Public",
# and the default OpenSSH rule may be scoped to Private only → port 22 looks "filtered").
New-NetFirewallRule -Name sshd-all -DisplayName 'OpenSSH 22 (all profiles)' -Enabled True `
  -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -Profile Any -ErrorAction SilentlyContinue
Set-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -Profile Any -ErrorAction SilentlyContinue

# Verify: want Status=Running and a LocalPort 22 Listen line
Get-Service sshd | Select-Object Name, Status, StartType
Get-NetTCPConnection -LocalPort 22 -State Listen -ErrorAction SilentlyContinue
```

The default Windows SSH login uses the **Windows account** of the box — for these rentals
that's the RDP user shown on the dashboard (e.g. `ezycloudx-admin`) and its password.

---

## Method 1 — Tailscale mesh VPN (RECOMMENDED, no VPS)

Free, no public server, automatic NAT traversal. Both machines join one tailnet and get
stable `100.x.x.x` IPs; you SSH to the rented box's `100.x` IP as if on the same LAN.

### One-time, on your HOME PC

```powershell
winget install --id Tailscale.Tailscale -e --accept-source-agreements --accept-package-agreements --silent
& "C:\Program Files\Tailscale\tailscale.exe" up        # prints a login URL → open, sign in
& "C:\Program Files\Tailscale\tailscale.exe" ip -4     # your home 100.x IP
```

> Reference (this user's setup): home node `desktop-ai-engineer` = `100.85.114.104`,
> Tailscale account **hanzotruong0804@**. The home node is permanent — **never redo it**.

### Every rented box, inside RDP (Admin PowerShell)

```powershell
# 1) OpenSSH Server — see "Shared prerequisite" above (run that block first)

# 2) Tailscale
winget install --id Tailscale.Tailscale -e --accept-source-agreements --accept-package-agreements --silent
& "C:\Program Files\Tailscale\tailscale.exe" up        # prints login URL → sign in SAME account
& "C:\Program Files\Tailscale\tailscale.exe" ip -4     # the box's 100.x IP — note it
```

### Connect from HOME PC

```powershell
& "C:\Program Files\Tailscale\tailscale.exe" status    # find the rented node + its 100.x IP
ssh ezycloudx-admin@100.64.174.26                      # ← rented box's Tailscale IP
```

First connect asks to trust the host key → `yes`, then the RDP password.

> **Verify the path without a password** (useful when scripting a check):
> ```powershell
> & "C:\Program Files\Tailscale\tailscale.exe" ping <100.x>       # expect "pong"
> Test-NetConnection <100.x> -Port 22 | Select TcpTestSucceeded   # expect True
> ```
> `pong ... via DERP` just means relayed (not direct P2P) — **still works**, slightly higher latency.

---

## Method 2 — Reverse SSH tunnel via a VPS (if you already have a public-IP server)

The rented box opens an outbound SSH connection to your VPS and asks it to forward a VPS
port back into the box's port 22.

```powershell
# On the rented box (needs an SSH client; OpenSSH Client ships with Win10/11):
ssh -N -R 2222:localhost:22 vpsuser@YOUR_VPS_IP
# keep this running (run as a scheduled task / nssm service to persist)
```

```bash
# From home: hop through the VPS
ssh -p 2222 ezycloudx-admin@YOUR_VPS_IP
```

On the VPS, set `GatewayPorts clientspecified` in `/etc/ssh/sshd_config` if you want to
reach the forwarded port from a third host rather than only from the VPS itself.

---

## Method 3 — ngrok / Cloudflare Tunnel (no VPS, quickest one-off)

```powershell
# ngrok (free tier gives a random host:port each run)
winget install --id Ngrok.Ngrok -e
ngrok config add-authtoken <YOUR_NGROK_TOKEN>
ngrok tcp 22            # prints tcp://0.tcp.ngrok.io:1XXXX  → that is your SSH endpoint
```

```bash
# From home
ssh ezycloudx-admin@0.tcp.ngrok.io -p 1XXXX
```

Cloudflare alternative: `cloudflared tunnel --url ssh://localhost:22` (needs a Cloudflare
account + the `cloudflared` client config on the home side). Use these when you want a
throwaway link and don't want to install a mesh VPN.

---

## Passwordless login (SSH key) — optional, do once per box

> **DO NOT copy-paste the public key by hand into the rented box.** RDP clipboard is
> often not shared, so the user retypes the ~50-char base64 and flips one character
> (classic: `...bkDvz...` → `...bkDVz...`). Base64 is case-sensitive — one wrong char =
> a different key = sshd silently ignores it and keeps asking for the password. Use the
> `scp` transfer below so the key file moves **byte-exact**; password is typed only once.

### Step 0 — on HOME PC: ensure a key exists + add the `gpu` alias

```powershell
# Create an ed25519 key if you don't have one
if (-not (Test-Path "$env:USERPROFILE\.ssh\id_ed25519")) {
    ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\id_ed25519" -N '""'
}
# Alias so you can later just type `ssh gpu` (edit HostName to the box's 100.x IP)
@"
Host gpu
    HostName 100.64.174.26
    User ezycloudx-admin
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking accept-new
"@ | Add-Content "$env:USERPROFILE\.ssh\config"
```

### Step 1 — on HOME PC: ship the public key (type the RDP password once)

```powershell
scp $env:USERPROFILE\.ssh\id_ed25519.pub ezycloudx-admin@100.64.174.26:mykey.pub
# first time asks to trust host key -> yes; then the RDP password (e.g. 58734097)
```

### Step 2 — on the RENTED box (Admin PowerShell): install it

```powershell
$pub   = (Get-Content "$env:USERPROFILE\mykey.pub" -Raw).Trim()
$akeys = "$env:ProgramData\ssh\administrators_authorized_keys"
Set-Content -Path $akeys -Value $pub -Encoding ascii          # overwrite -> wipes any bad key
icacls $akeys /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" | Out-Null
Restart-Service sshd
Remove-Item "$env:USERPROFILE\mykey.pub" -ErrorAction SilentlyContinue
Get-Content $akeys
```

### Step 3 — from HOME PC: verify (no password should be asked)

```powershell
ssh -o BatchMode=yes gpu whoami     # prints the remote user => key works
```

> **Windows OpenSSH quirk:** for accounts in the **Administrators** group the key MUST
> live in `C:\ProgramData\ssh\administrators_authorized_keys` (NOT the user's
> `~/.ssh/authorized_keys`), with ACL restricted to `Administrators` + `SYSTEM`. Wrong
> location or loose ACL → sshd ignores the key and silently falls back to the password.

### Handy alias — `~/.ssh/config` on the home PC

```
Host gpu
    HostName 100.64.174.26
    User ezycloudx-admin
    IdentityFile ~/.ssh/id_ed25519
```

Then just: `ssh gpu`.

---

## Per-rental quick checklist

Each new machine reuses your permanent home setup; you only redo the box side:

1. RDP into the new box (address/user/pass from the thuepcpro.vn dashboard).
2. Run the **Shared prerequisite** block (OpenSSH Server + firewall).
3. Install Tailscale, `tailscale up`, sign in with **the same account** → grab its `100.x` IP.
4. From home: `tailscale status` to confirm the node, then `ssh <rdp-user>@<100.x>`.
5. (Optional) push your SSH key + add an `~/.ssh/config` alias.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Get-Service sshd` → not found | OpenSSH Server not installed | Run the install block; if `Add-WindowsCapability` errors `0x800f0954`, use the winget fallback |
| `tailscale ping` works but `Test-NetConnection -Port 22` = False | sshd stopped OR firewall blocks 22 on the Public/Tailscale NIC | `Start-Service sshd`; add the `-Profile Any` firewall rule |
| `ping ... via DERP`, "direct connection not established" | No P2P hole-punch, using relay | Cosmetic — relayed SSH still works; ignore |
| Node missing from `tailscale status` | Box signed into a different Tailscale account | Re-run `tailscale up` and log in with **hanzotruong0804@** |
| Key ignored, still asks password | Admin account key not in `administrators_authorized_keys` / wrong ACL | Place key there and restrict ACL to Administrators+SYSTEM |
| Key ignored even after correct ACL | Public key mistyped when pasted by hand over RDP (case-sensitive base64) | Don't hand-type — `scp` the `.pub` file (see Passwordless login Step 1); `Set-Content` to overwrite the bad line |
| Can't reach the box at all | Provider NAT blocks inbound (expected) | Don't SSH the RDP host:port — use the `100.x` Tailscale IP |

## Reference values (this user)

- Provider: **thuepcpro.vn** (ezycloudx). Dashboard shows RDP address `netN.thuepcpro.vn:PORT`, user `ezycloudx-admin`, a per-machine password, plus a "Tải file RDP" button.
- `no-nas` machines have no NAS; NAS machines expose an **internal-only** SMB share
  `\\10.10.20.20\ezc-common` (reachable only from inside the box — not useful from home).
- Home Tailscale node: `desktop-ai-engineer` = `100.85.114.104`, account **hanzotruong0804@** (permanent).

---

# Part 2 — Run usd-viewer on the box + stream the FE over Tailscale

Once SSH/Tailscale (Part 1) works, this brings up `akila.viewer_streaming.kit` on the box
and streams it to the local `web-user-platform` FE. `BOX` = the box's Tailscale IP
(example `100.64.174.26`), user `ezycloudx-admin`. Helper files ship with this skill:
`stun_server.py`, `run_stun.bat`, `setup_task.bat`, `runfast.example.bat`.

## The one trick that makes remote ops sane

PowerShell→ssh→cmd→powershell quoting is a graveyard. Two rules:

1. **Run remote PowerShell via base64 `-EncodedCommand`** — zero quoting issues:
   ```powershell
   $ps = @'
   <multi-line PowerShell that runs ON THE BOX>
   '@
   $enc=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($ps))
   ssh -o BatchMode=yes ezycloudx-admin@BOX "powershell -NoProfile -EncodedCommand $enc"
   ```
2. **Ship files with `scp`, don't echo them** — write any .bat/.py locally and `scp` it.

## A0 — git auth on the box (so you can clone the akila Bitbucket repos)

A fresh box has git installed but **no working Bitbucket credentials**. The repos live on
Bitbucket Cloud (`git@bitbucket.org:aden-akila/<repo>.git`, e.g. `usd-viewer`).

> **A SCOPED Atlassian API token DOES work for git over HTTPS — but only with the right
> username.** Verified 2026-06-25: an `ATATT…` token carrying the `read:repository:bitbucket`
> scope clones fine using the fixed username **`x-bitbucket-api-token-auth`**. The SAME token is
> rejected (`remote: You may not have access… / Authentication failed`) when the username is the
> account **email** or **`x-token-auth`** — those are wrong for an API token (`x-token-auth` is
> the username for a *Repository/Workspace Access Token*, a different credential). A **scopeless**
> API token authenticates the REST API only, never git. Note: Bitbucket **App Passwords are
> deprecated/removed by Atlassian** — a scoped API token or an SSH key are the paths now.

Also note: a **non-interactive ssh session can't use Git Credential Manager** — GCM's
`wincredman` store needs the interactive desktop, so over `ssh gpu` you get
`fatal: Unable to persist credentials with the 'wincredman' credential store`. Headless git
auth must avoid GCM (use an SSH key, or `credential.helper store`).

### Recommended — reuse your home SSH key (fully headless, no token)

Your home `~/.ssh/id_ed25519` is already registered with Bitbucket (that's why home clones
work). Ship it to the box and clone over SSH — no token, no expiry:

```powershell
# from HOME (you already have passwordless `ssh gpu`):
# 1) confirm the home key authenticates to Bitbucket
ssh -o BatchMode=yes -T git@bitbucket.org          # → "authenticated via ssh key."
# 2) make ~/.ssh on the box, then scp the keypair in byte-exact
#    (mkdir via EncodedCommand so $env resolves on the box)
scp -o BatchMode=yes "$env:USERPROFILE\.ssh\id_ed25519" "$env:USERPROFILE\.ssh\id_ed25519.pub" gpu:.ssh/
```

Then on the box (via `-EncodedCommand`): lock the key's ACL, trust Bitbucket's host key, test:

```powershell
$k="$env:USERPROFILE\.ssh\id_ed25519"
icacls $k /inheritance:r | Out-Null
icacls $k /grant:r "$($env:USERNAME):F" | Out-Null          # Windows OpenSSH rejects a loose-ACL key
ssh-keyscan -t rsa,ed25519 bitbucket.org 2>$null | Out-File -Encoding ascii -Append "$env:USERPROFILE\.ssh\known_hosts"
ssh -o BatchMode=yes -T git@bitbucket.org                   # "authenticated via ssh key."
git clone --branch <branch> git@bitbucket.org:aden-akila/usd-viewer.git C:\SOURCE\USD\usd-viewer
```

> Clone onto the **roomy drive** — these boxes put ~800 GB free on `C:` while `D:`/`E:` are
> near-full; check with `Get-PSDrive -PSProvider FileSystem`. The `connection is not using a
> post-quantum key exchange` warning from Bitbucket is cosmetic.

Trade-off: this copies your private key onto a rented box. Fine for an ephemeral rental you
control; if you'd rather not, generate a box-local key and add its `.pub` to Bitbucket.

### Alternative — scoped API token over HTTPS (verified 2026-06-25)

Create the token at **https://id.atlassian.com/manage-profile/security/api-tokens** — use
**"Create API token with scopes"** and grant **`read:repository:bitbucket`** (+ `write:…` to
push). NOT the plain "Create API token" (no git scope). Username = the fixed literal
**`x-bitbucket-api-token-auth`** (NOT your email). Set it via `url.insteadOf` so the main repo
AND submodules both authenticate, and disable GCM (headless ssh can't reach the `wincredman`
store). Run on the box via `-EncodedCommand`:

```powershell
$tok = 'ATATT…' -replace '=','%3D'    # URL-encode any '=' in the token
git config --global url."https://x-bitbucket-api-token-auth:$tok@bitbucket.org/".insteadOf "https://bitbucket.org/"
git config --global credential.helper ''
git -c credential.helper= clone --branch <branch> https://bitbucket.org/aden-akila/usd-viewer.git C:\Users\ezycloudx-admin\Desktop\usd-viewer
```

If the box already has a `url."git@bitbucket.org:".insteadOf` (SSH) rule from a prior setup,
remove it first (`git config --global --remove-section url."git@bitbucket.org:"`) — it hijacks
the HTTPS URL to SSH and you get `Permission denied (publickey)`.

## A — clone + confirm build

Launch chain: `runfast.bat` → `run.bat` (`cd kit-sdk` → `repo.bat launch -n akila.viewer_streaming.kit`).
Build output is in **`kit-sdk\_build`**, NOT repo-root. If missing, `cd kit-sdk && repo.bat build`
on the box (multi-GB packman pull). **Python ext edits load live** — no rebuild for `.py`.

## A2 — fresh box: clone + build from scratch (Bitbucket gotchas, verified 2026-06-27)

When the box has no `usd-viewer` (old rental gone, can't copy): clone + build. Repos are **private
Bitbucket** (`aden-akila`): `usd-viewer` (origin SSH) + 3 HTTPS submodules `kit-sdk`,
`externals/akila.main_ext`, `externals/akila.core.pylib`.

**Auth — three gotchas that each waste a round:**
- **App passwords are removed from Atlassian** → use an **Atlassian API token** (`ATATT…`).
- **Username = the Bitbucket username, NOT the email.** `harry.truong@akila3d.com` → `harrytruongakila`.
  Email-as-username gives `403 "may not have access" / Authentication failed`. Find the username (and verify
  the token) via the REPO endpoint — `/2.0/user` returns 403 (token has no account scope) but the repo works
  and its clone URL carries the username:
  `curl -u <email>:<TOKEN> https://api.bitbucket.org/2.0/repositories/aden-akila/usd-viewer`
  → `"clone":[{"name":"https","href":"https://harrytruongakila@bitbucket.org/…"}]`.
- **Git Credential Manager (GCM/wincredman) blocks headless SSH** — it overrides `credential.helper store`
  and can't prompt (`Unable to persist with 'wincredman'` + `/dev/tty: No such device`). **Bypass with
  `url.insteadOf`** so creds are inline in every URL (clone + submodules), no helper:
  ```powershell
  $tok = "<TOKEN, with any '=' url-encoded as %3D>"
  git config --global url."https://harrytruongakila:$tok@bitbucket.org/".insteadOf "https://bitbucket.org/"
  cd $env:USERPROFILE\Desktop
  git clone https://bitbucket.org/aden-akila/usd-viewer.git
  cd usd-viewer; git checkout feature/<branch>; git submodule update --init --recursive
  ```
  (The `Unable to persist with wincredman` line still prints — harmless, the inline creds already authed.)

**Build — must survive the SSH session.** A detached `Start-Process` build is **killed when the SSH session
ends** (Windows OpenSSH kills session children → log freezes mid-packman). Run it as a **scheduled task**,
log to a file + `.done` marker, poll `build.done`:
```powershell
# build.bat: cd /d <root>\kit-sdk && call repo.bat build > <Desktop>\build.log 2>&1 && echo EXIT=%errorlevel% > <Desktop>\build.done
schtasks /create /tn AkilaBuild /tr "cmd /c <Desktop>\build.bat" /sc once /st 00:00 /ru ezycloudx-admin /rp <PASS> /rl highest /f
schtasks /run /tn AkilaBuild
```
`BUILD (RELEASE) SUCCEEDED` in ~30s is normal — Kit "build" stages prebuilt packman packages, not a compile.

**The build does NOT stage the usd-viewer app or its akila extensions** (only kit-sdk's own go to
`_build\…\exts`). Two manual steps after build, or the launch finds nothing — the `.kit` app's
`[settings.app.exts.folders]` is `${app}/../exts` + `/../apps`:
1. **Apps** → `Copy-Item source\apps\*.kit kit-sdk\_build\windows-x86_64\release\apps\`.
2. **Extensions** → junction every local ext into `_build\…\release\exts`: for each dir under
   `source\extensions\` and `externals\` that has `config\extension.toml`,
   `New-Item -ItemType Junction -Path <exts>\<name> -Target <dir>` (akila.viewer_messaging, akila.main_ext,
   akila.core.pylib, akila.streaming.readiness, akila.observability_bootstrap, akila.viewer_setup, …).

**Deploy local-only commits:** the cloned remote branch lacks any unpushed work — `scp` the changed
`.py`/`.kit`/`.toml` on top (Python loads live; same as the push+pull rule).

## B — launch Kit in the RDP session (GPU needs a real session)

A GPU app from a plain detached ssh process can't get the GPU. Launch via a one-shot
scheduled task that runs inside the logged-on RDP session (`ssh BOX "query user"` must show
an `Active` rdp line). Ship `setup_task.bat`, then `ssh BOX "C:\...\setup_task.bat"`. Kill
reliably (Kit spawns helpers — loop it), via EncodedCommand:
`1..4 | % { Get-Process kit -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue; Start-Sleep -m 500 }`

## C — fixed-path logging (NOT tee)

`tee` is unreliable on Windows. In `runfast.bat` forward to Kit:
`--/log/file=%~dp0viewer.log` and `--/log/level=info` (the `[PNSD-2649]` diag logs are
`[Warning]`). Log is always at `...\usd-viewer\viewer.log`.

## D — streaming bring-up over Tailscale (the hard part)

FE library connects `streamSource:'direct'`, `server=BOX` (IP only). Kit ports: signaling
**TCP 49100**, media **UDP 47998 / shared 49100**, messaging **8011**. `akila.streaming.readiness`
injects a cloud STUN/candidate config that breaks local. Three required fixes:

- **D1 candidate** — `stunIp` becomes BOTH the client's STUN server AND the advertised media
  candidate; default `demo-nucleus-us-staging.akila3d.com` (unreachable). Override in runfast.bat:
  `--/exts/akila.streaming.readiness/stun_ip=BOX`. Log should then show `Processed ice candidate: ... BOX 49100`.
- **D2 STUN responder** — because `stunIp` is also the client's STUN server, the FE STUNs
  `BOX:3478` and hangs if nothing answers (browser: *"Client sent STUN requests but did not
  receive any responses"*; Kit: *"Got stop event while waiting for client connection"*). Ship
  `stun_server.py` + `run_stun.bat`, run as a **SYSTEM scheduled task** (Start-Process dies with
  the ssh session): `schtasks /create /tn AkilaStun /ru SYSTEM /sc once /st 23:59 /f /tr "C:\Users\ezycloudx-admin\Desktop\run_stun.bat"` then `schtasks /run /tn AkilaStun`.
  **Do NOT use Google STUN** — it returns the unreachable public IP and corrupts the candidate.
- **D3 firewall** — TCP 49100 is often already open but UDP (media + STUN) is not. EncodedCommand:
  ```powershell
  $kit=(Get-Process kit|Select -First 1).Path
  New-NetFirewallRule -DisplayName 'Akila Kit Stream' -Direction Inbound -Program $kit -Action Allow -Profile Any
  New-NetFirewallRule -DisplayName 'Akila Stream UDP'  -Direction Inbound -Protocol UDP -LocalPort 47998,49100,3478 -Action Allow -Profile Any
  ```
- **D4 FE** — `usd-config.js`: `STREAM_CONFIG.source='local'`, `local.server='BOX'`, `forceWSS=false`,
  `authenticate=false` (see the `usd-viewer-local-debug` skill for the full FE switch).

## E — verify, in order

```powershell
(Test-NetConnection BOX -Port 49100).TcpTestSucceeded   # True
@'
import socket,struct,os
m=0x2112A442;s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.settimeout(5)
s.sendto(struct.pack("!HHI",1,0,m)+os.urandom(12),("BOX",3478))
print("OK" if s.recvfrom(2048) else "FAIL")
'@ | python -                                            # OK = STUN answers over Tailscale
```
In `viewer.log`, in order: `Processed ice candidate: ... BOX 49100` → `Client connected to WebRTC server`.

## F — monitor the remote log live (auto-reconnect; DERP drops ssh)

Use the harness **Monitor** tool with a persistent command. Build the base64 of
`Get-Content -LiteralPath '<viewer.log path>' -Wait -Tail 0`, then:
```bash
while true; do ssh -o BatchMode=yes -o ServerAliveInterval=20 ezycloudx-admin@BOX \
  "powershell -NoProfile -EncodedCommand <b64>" 2>/dev/null \
  | grep -aiE --line-buffered 'client.connected|\[PNSD-2649\]|ghost bound|GPU crash|[Dd]evice lost|\[Fatal\]|\[Error\]' \
  | grep -aviE --line-buffered 'opentelemetry|Streaming Manager|Viewer Readiness|waiting for client connection|Can not import AKILA Schema'; sleep 3; done
```
The Kit log floods with `[Info] omni.rtx Mapping...` — keep the include filter tight.

## Part 2 troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `git clone` → `Authentication failed` with an `ATATT…` token | plain Atlassian API token has no git scope | use SSH key (A0) or a **scoped** API token from id.atlassian.com (A0) |
| `Unable to persist credentials with the 'wincredman' credential store` over ssh | GCM needs the interactive desktop; ssh session has none | use SSH key, or `credential.helper store` (A0) — not GCM |
| Kit via ssh has no GPU / crashes | detached process, no session | scheduled task in the active RDP session (B) |
| `Got stop event while waiting for client connection` (Kit) | client never completes WebRTC | server side of an FE-connect failure — debug FE/streaming, not Kit |
| browser `Client sent STUN requests but did not receive any responses` | no STUN server at `stunIp:3478` | run `stun_server.py` on the box (D2) |
| candidate = `demo-nucleus-us-staging...` | default cloud STUN | override `stun_ip=BOX` (D1) |
| STUN test times out; server "listening" then gone | `Start-Process` died with ssh session | run STUN as a **SYSTEM scheduled task** |
| TCP 49100 ok but media never connects | UDP blocked on Tailscale NIC | allow kit.exe + UDP `-Profile Any` (D3) |
| ssh monitor dies every few min | Tailscale DERP relay drop | wrap ssh in `while true; do ...; sleep 3; done` |
| `tee` log empty/mangled | Windows tee unreliable | use `--/log/file=` (C) |
| ghost bound but a few prims unaffected | `IsInstance` prims ignore material binding + doubleSided | USD limitation; instanced geometry needs another approach |

Verified 2026-06-24 on a rented **RTX 5060 Ti** box: full chain works; ghost PT-bounce=32 +
backface-cull ran without GPU device-loss (the A4000-local crash did not reproduce on Blackwell).

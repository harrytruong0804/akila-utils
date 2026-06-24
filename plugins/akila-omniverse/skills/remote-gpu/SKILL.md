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
  per-rental checklist.
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

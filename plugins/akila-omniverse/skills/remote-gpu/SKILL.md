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

```powershell
# On HOME PC: create a key if you don't have one
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\id_ed25519 -N '""'

# Copy the PUBLIC key into the box's authorized_keys. For an ADMIN account on Windows,
# OpenSSH reads C:\ProgramData\ssh\administrators_authorized_keys (NOT the user's folder):
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh ezycloudx-admin@<100.x> `
  "powershell -c \"Add-Content C:\ProgramData\ssh\administrators_authorized_keys (\$input); icacls C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F'\""
```

> Windows OpenSSH quirk: for accounts in the Administrators group the key MUST live in
> `administrators_authorized_keys` with permissions limited to `Administrators` + `SYSTEM`,
> otherwise sshd ignores it and silently falls back to the password.

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
| Can't reach the box at all | Provider NAT blocks inbound (expected) | Don't SSH the RDP host:port — use the `100.x` Tailscale IP |

## Reference values (this user)

- Provider: **thuepcpro.vn** (ezycloudx). Dashboard shows RDP address `netN.thuepcpro.vn:PORT`, user `ezycloudx-admin`, a per-machine password, plus a "Tải file RDP" button.
- `no-nas` machines have no NAS; NAS machines expose an **internal-only** SMB share
  `\\10.10.20.20\ezc-common` (reachable only from inside the box — not useful from home).
- Home Tailscale node: `desktop-ai-engineer` = `100.85.114.104`, account **hanzotruong0804@** (permanent).

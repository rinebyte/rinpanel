# Deploying rinpanel to a VPS

End-to-end guide for a fresh Ubuntu 22.04+ box. Time to first login: ~15 min (Quick mode) or ~30 min (Production mode).

Two deployment modes are supported:

| Mode | URL | HTTPS? | DNS needed? | Setup time |
|---|---|---|---|---|
| **Quick (default)** | `http://<VPS_IP>:8443/login` | ❌ plain HTTP | no | ~15 min |
| **Production** | `https://panel.<your-domain>/login` | ✅ nginx + certbot | yes | ~30 min |

Pick at §6. Steps 0–5 are identical.

**Threat model heads-up:** rinpanel runs as `root` (matches cPanel / aaPanel convention; the security boundary is the Credentials auth + the strict `validateDomain` regex, not OS user separation). A compromise of the HTTP layer = compromise of the box. Use a strong `ADMIN_PASSWORD` (~20+ chars). **In Quick mode, login creds travel in plaintext over HTTP** — fine for VPN/Tailscale-only access, **risky if the panel is exposed to the open internet**. If exposed publicly, prefer Production mode.

---

## 0. Prerequisites

- Ubuntu 22.04 LTS (or newer) VPS with root SSH access
- Quick mode: nothing else needed
- Production mode: a domain (or subdomain) pointed at the VPS IP — e.g. `panel.your-site.com`
- Open ports (we configure firewall in §5):
  - Always: **22** (SSH)
  - Quick mode: **8443** (or whatever `PORT` you choose) for the panel + **80/443** for hosted vhosts
  - Production mode: **80** + **443** only

---

## 1. Server packages

```bash
apt update
apt install -y nginx certbot python3-certbot-nginx git curl ca-certificates

# Node 20+ via NodeSource (Ubuntu's nodejs is too old)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

node -v   # should print v20.x or newer
npm -v
```

> nginx + certbot are installed even in Quick mode — the panel itself doesn't use them in Quick mode, but it MANAGES nginx vhosts + SSL certs for the sites you host (Slices N and S).

---

## 2. Get rinpanel onto the box

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/rinebyte/rinpanel.git
cd rinpanel

npm install            # install runtime + dev deps (drizzle-kit needed for migrations)
npm run build          # produce .next/ build output
```

---

## 3. Configure environment

```bash
cp .env.production.example .env.local
nano .env.local
```

Fill in:
- `AUTH_SECRET` — paste output of `openssl rand -base64 32`
- `ADMIN_USERNAME` — your login (e.g. `admin`)
- `ADMIN_PASSWORD` — pick something strong (~20+ chars; you'll rarely type it)
- `USE_DOCKER=false` (already the default — must stay false on the VPS)
- `LETS_ENCRYPT_EMAIL` — admin email for Let's Encrypt account / expiry notices (used by the SSL slice)
- `CERTBOT_DRY_RUN=false` — required for real cert issuance on hosted domains
- **`HOSTNAME` + `PORT`** — see below per mode

### Quick mode (direct IP:PORT)
Leave the defaults from the template:
```
HOSTNAME=0.0.0.0
PORT=8443
```
This binds Next to all interfaces on port 8443. After §5 the panel will be reachable at `http://<VPS_IP>:8443/login`.

### Production mode (behind nginx)
Set:
```
HOSTNAME=127.0.0.1
PORT=8443
```
This binds Next to localhost only — nginx in §6B reverse-proxies `https://panel.<your-domain>` → `127.0.0.1:8443`.

Either way, lock the env file:

```bash
chmod 600 /opt/rinpanel/.env.local
```

---

## 4. Initialize the database

```bash
cd /opt/rinpanel
npm run db:push        # create users / domains / activity_logs tables
npm run db:seed        # create admin user from .env.local
```

You should see `Created admin user: <ADMIN_USERNAME>`. Re-running `db:seed` after editing `ADMIN_PASSWORD` rotates it idempotently.

---

## 5. systemd service + firewall

```bash
cp deploy/rinpanel.service /etc/systemd/system/rinpanel.service
systemctl daemon-reload
systemctl enable --now rinpanel
systemctl status rinpanel
```

The service reads `EnvironmentFile=/opt/rinpanel/.env.local`, so the `HOSTNAME` + `PORT` you set in §3 take effect automatically.

Logs:
```bash
journalctl -u rinpanel -f      # follow live
journalctl -u rinpanel -n 100  # last 100 lines
```

### Firewall (UFW)

```bash
ufw allow OpenSSH                       # don't lock yourself out
ufw allow 80                            # for hosted vhosts + Let's Encrypt
ufw allow 443                           # for hosted vhosts (HTTPS once you enable SSL)

# Quick mode only — open the panel port (skip this for Production mode):
ufw allow 8443/tcp

ufw enable
ufw status
```

---

## 6. Pick a mode

### 6A. Quick mode — direct IP:PORT (HTTP)

That's it for setup. Visit:
```
http://<VPS_IP>:8443/login
```
Sign in with the admin credentials from `.env.local`. Skip to §7.

**Heads-up:** plain HTTP. Don't post the IP+port publicly. Tailscale, WireGuard, or `ufw allow from <your_home_IP> to any port 8443` are easy ways to restrict access.

---

### 6B. Production mode — nginx reverse-proxy + Let's Encrypt

```bash
cp deploy/nginx-panel.conf.example /etc/nginx/sites-available/rinpanel.conf
nano /etc/nginx/sites-available/rinpanel.conf
# → change `server_name panel.example.com;` to YOUR panel domain
# → the template already proxies to 127.0.0.1:8443 (matching the default PORT in §3)

ln -s /etc/nginx/sites-available/rinpanel.conf /etc/nginx/sites-enabled/rinpanel
nginx -t                # must say "syntax is ok" + "test is successful"
systemctl reload nginx
```

Test plain-HTTP works:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: panel.your-domain.com" http://127.0.0.1/
# expect 200 or 307 (NextAuth redirecting to /login)
```

DNS for `panel.your-domain.com` must resolve to this VPS before the next step.

```bash
certbot --nginx -d panel.your-domain.com
```

certbot will:
1. Solve the HTTP-01 challenge through your nginx vhost
2. Issue the cert
3. Rewrite the vhost to add a `listen 443 ssl` block and a `:80 → :443` redirect
4. Install a renewal cron / systemd timer (auto-renews every ~60 days)

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://panel.your-domain.com/
# expect 200 or 307
```

Visit `https://panel.your-domain.com/login` and sign in.

---

## 7. First login + provision your first site

Sign in with the admin credentials from `.env.local`. You should land on the dashboard with live CPU / Memory / Disk / Load / Uptime / Hostname of the VPS itself.

- **Domains** → add a domain. The panel writes `/etc/nginx/sites-available/<domain>.conf`, symlinks it, creates `/var/www/<domain>/public_html/` with a placeholder, runs `nginx -t`, reloads. After ~2s the new domain serves the PROVISIONED placeholder on port 80.
- **Files** → click the domain → upload your site files (50 MB / file, drag-and-drop).
- **Domains → Lock icon** → enable SSL via certbot once DNS for that domain resolves to this box.

> The dashboard reads metrics directly from `/proc/stat`, `free`, `df`, `/proc/loadavg`, `/proc/uptime`, `hostname` — the same commands the dev Docker container runs. Nothing else changes between dev → prod beyond `USE_DOCKER=false`.

---

## 8. Updates

```bash
cd /opt/rinpanel
git pull
npm install            # apply any new deps
npm run build          # rebuild .next/
npm run db:push        # apply any schema migrations (idempotent)
systemctl restart rinpanel
```

If an update changes `panel.db` schema in a non-backward-compatible way, **back up first** (see §9).

---

## 9. Backups

`panel.db` holds the admin hash, the domain list, and the activity log. SQLite is a single file, but a naive `cp` while the app is writing can capture a torn page — use the SQLite backup API.

Simple daily backup cron (`crontab -e`, as root):

```cron
0 3 * * * sqlite3 /opt/rinpanel/panel.db ".backup '/var/backups/rinpanel/panel-$(date +\%F).db'"
0 4 * * * find /var/backups/rinpanel -name 'panel-*.db' -mtime +30 -delete
```

```bash
mkdir -p /var/backups/rinpanel
```

Also worth backing up: `/etc/nginx/sites-available/` and `/etc/letsencrypt/`.

---

## 10. Troubleshooting

| Symptom | Check |
|---|---|
| `systemctl status rinpanel` shows `failed` | `journalctl -u rinpanel -n 50` — usually `AUTH_SECRET` missing, port already in use, or `npm run build` was never run |
| Quick mode: `http://IP:8443` times out | UFW didn't open 8443 (`ufw status`), or `HOSTNAME=127.0.0.1` instead of `0.0.0.0` in `.env.local` |
| Production mode: 502 Bad Gateway | Next process isn't running (`systemctl status rinpanel`), or `proxy_pass` in the nginx vhost points at the wrong port |
| Dashboard tiles show `—` / "unreachable" | The metric commands failed. Run them manually: `free -m`, `df -P -BK /`, `cat /proc/stat`. They MUST work on the VPS. |
| `Domains` add returns nginx error | The error banner shows `nginx -t` stderr verbatim. Usually a typo in `server_name` or a missing dir. |
| certbot fails for a hosted domain | DNS doesn't resolve to this VPS yet (`dig +short <domain>` from elsewhere), or port 80 is blocked. |

---

## 11. Hardening (later, optional)

Items flagged in CLAUDE.md for a future production-hardening pass. None are blockers for v1.

- **Drop to a dedicated `rinpanel` user with scoped sudoers** instead of running as root. Sample sudoers entries:
  ```
  rinpanel ALL=(root) NOPASSWD: /usr/sbin/nginx -t
  rinpanel ALL=(root) NOPASSWD: /usr/sbin/nginx -s reload
  ```
  Plus `chown -R rinpanel /etc/nginx/sites-{available,enabled} /var/www`. Would require `runOnTarget` to learn about `sudo` for those specific commands.
- **DB-backed login rate-limiter** so process restarts don't reset the counter (currently in-memory, 7 attempts / 10 min).
- **Audit log retention / rotation** — the `activity_logs` table grows unbounded.
- **Per-vhost log viewer** in the UI (logs already exist at `/var/log/nginx/<domain>.{access,error}.log` per the render template).
- **Fail2ban** for SSH and for repeated `/login` 401s.
- **Quick → Production migration**: any time after you grab a domain + DNS for the panel itself, follow §6B and flip `HOSTNAME=127.0.0.1` to lock the panel behind nginx. Close `ufw allow 8443` after.

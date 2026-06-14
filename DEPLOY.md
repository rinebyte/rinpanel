# Deploying rinpanel to a VPS

End-to-end guide for a fresh Ubuntu 22.04+ box. Time to first login: ~30 min.

**Threat model heads-up:** rinpanel runs as `root` (matches cPanel / aaPanel convention; the security boundary is the Credentials auth + the strict `validateDomain` regex, not OS user separation). A compromise of the HTTP layer = compromise of the box. Don't expose this panel directly to the open internet behind weak credentials — use a strong `ADMIN_PASSWORD` and keep the panel domain off public lists.

---

## 0. Prerequisites

- Ubuntu 22.04 LTS (or newer) VPS with root SSH access
- A domain (or subdomain) pointed at the VPS IP — e.g. `panel.your-site.com`
- Open ports: **22** (SSH), **80** (HTTP), **443** (HTTPS)

> The panel itself only needs ports 80/443 reachable. Once running, every vhost it provisions also serves on 80 (and 443 once the SSL slice ships).

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
- `ADMIN_PASSWORD` — pick something strong (~16+ chars)
- `USE_DOCKER=false` (already the default in the template — must stay false on the VPS)

Lock down the file:

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

## 5. systemd service

```bash
cp deploy/rinpanel.service /etc/systemd/system/rinpanel.service
systemctl daemon-reload
systemctl enable --now rinpanel
systemctl status rinpanel
```

The service binds Next to `127.0.0.1:3000` (see `npm start` in `package.json` — `next start -H 127.0.0.1`). It is NOT directly reachable from the internet; nginx will reverse-proxy to it.

Logs:

```bash
journalctl -u rinpanel -f      # follow live
journalctl -u rinpanel -n 100  # last 100 lines
```

---

## 6. nginx vhost for the panel

```bash
cp deploy/nginx-panel.conf.example /etc/nginx/sites-available/rinpanel.conf
nano /etc/nginx/sites-available/rinpanel.conf
# → change `server_name panel.example.com;` to YOUR panel domain

ln -s /etc/nginx/sites-available/rinpanel.conf /etc/nginx/sites-enabled/rinpanel
nginx -t                # must say "syntax is ok" + "test is successful"
systemctl reload nginx
```

Test plain-HTTP works:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: panel.your-domain.com" http://127.0.0.1/
# expect 200 or 307 (NextAuth redirecting to /login)
```

---

## 7. SSL via Let's Encrypt

DNS for `panel.your-domain.com` must already resolve to this VPS before this step.

```bash
certbot --nginx -d panel.your-domain.com
```

certbot will:
1. Solve the HTTP-01 challenge through your nginx vhost
2. Issue the cert
3. Rewrite the vhost to add a `listen 443 ssl` block and a `:80 → :443` redirect
4. Install a renewal cron / systemd timer (auto-renews every ~60 days)

Quick check:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://panel.your-domain.com/
# expect 200 or 307
```

---

## 8. First login

Open `https://panel.your-domain.com` in a browser. Sign in with the admin credentials from `.env.local`. You should land on the dashboard with live CPU / Memory / Disk / Load / Uptime / Hostname of the VPS itself.

Go to **Domains** to provision vhosts. Each `add domain` writes `/etc/nginx/sites-available/<domain>.conf`, symlinks into `sites-enabled/`, creates `/var/www/<domain>/public_html/` with a placeholder `index.html`, runs `nginx -t`, and reloads.

> The dashboard reads metrics directly from `/proc/stat`, `free`, `df`, `/proc/loadavg`, `/proc/uptime`, `hostname` — the same commands the dev Docker container runs. Nothing else needs to change to switch dev → prod beyond `USE_DOCKER=false`.

---

## 9. Updates

```bash
cd /opt/rinpanel
git pull
npm install            # apply any new deps
npm run build          # rebuild .next/
npm run db:push        # apply any schema migrations (idempotent)
systemctl restart rinpanel
```

If the update changes `panel.db` schema in a non-backward-compatible way, **back up first** (see §10).

---

## 10. Backups

`panel.db` holds the admin credentials hash, the domain list, and the activity log. SQLite is a single file, but a naive `cp` while the app is writing can capture a torn page — use the SQLite backup API or pause the service.

Simple daily backup cron (`crontab -e`, as root):

```cron
0 3 * * * sqlite3 /opt/rinpanel/panel.db ".backup '/var/backups/rinpanel/panel-$(date +\%F).db'"
0 4 * * * find /var/backups/rinpanel -name 'panel-*.db' -mtime +30 -delete
```

```bash
mkdir -p /var/backups/rinpanel
```

---

## 11. Troubleshooting

| Symptom | Check |
|---|---|
| `systemctl status rinpanel` shows `failed` | `journalctl -u rinpanel -n 50` — usually `AUTH_SECRET` missing, port 3000 already in use, or `npm run build` was never run |
| Dashboard tiles show `—` / "unreachable" | The metric commands failed. Run them manually: `free -m`, `df -P -BK /`, `cat /proc/stat`. They MUST work on the VPS. |
| `Domains` add returns nginx error | The error banner shows `nginx -t` stderr verbatim. Usually a typo in `server_name` or a missing dir. |
| 502 Bad Gateway from nginx | Next process isn't running. `systemctl status rinpanel`. |
| Renewal failed (certbot) | `journalctl -u snap.certbot.renew.service` or `certbot certificates` — usually DNS changed or port 80 is blocked. |

---

## 12. Hardening (later, optional)

Items the spec/CLAUDE.md flagged for a future production-hardening pass. None are blockers for v1.

- **Drop to a dedicated `rinpanel` user with scoped sudoers** instead of running as root. Sample sudoers entries:
  ```
  rinpanel ALL=(root) NOPASSWD: /usr/sbin/nginx -t
  rinpanel ALL=(root) NOPASSWD: /usr/sbin/nginx -s reload
  ```
  Plus `chown -R rinpanel /etc/nginx/sites-{available,enabled} /var/www`. Would require `runOnTarget` to learn about `sudo` for those specific commands.
- **DB-backed login rate-limiter** so process restarts don't reset the counter (currently in-memory, 7 attempts / 10 min).
- **Audit log retention / rotation** — the `activity_logs` table grows unbounded.
- **Per-vhost log viewer** in the UI (logs already exist at `/var/log/nginx/<domain>.{access,error}.log` per the render template).
- **Firewall** — UFW or nftables. Allow 22 (or your SSH port), 80, 443. Deny rest.
- **Fail2ban** for SSH and for repeated `/login` 401s.

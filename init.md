# Hosting Panel — Init Guide

## Overview

Bikin hosting panel sendiri (seperti aaPanel/cPanel) menggunakan Next.js sebagai fullstack framework, dengan Docker sebagai Linux environment untuk development di Mac.

**Stack:**
- Frontend + API: Next.js Latest (App Router)
- Database: SQLite via Drizzle ORM
- Auth: NextAuth.js
- Linux environment: Docker (Ubuntu + Nginx)
- Shell executor: Node.js `child_process`

**Fitur yang akan dibangun:**
1. Auth (login/session)
2. Web server management (Nginx)
3. File manager
4. SSL management (Let's Encrypt / Certbot)
5. Monitoring & logs

---

## Prasyarat

Pastikan sudah terinstall di Mac:

```bash
node -v      # v20+
docker -v    # Docker Desktop
```

Download jika belum ada:
- Node.js: https://nodejs.org
- Docker Desktop: https://docker.com/products/docker-desktop

---

## Langkah 1 — Buat Project Next.js

```bash
npx create-next-app@latest hosting-panel \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --no-src-dir \
  --import-alias "@/*"

cd hosting-panel
```

---

## Langkah 2 — Install Dependencies

```bash
# Database
npm install drizzle-orm better-sqlite3
npm install -D drizzle-kit @types/better-sqlite3

# Auth
npm install next-auth@beta

# Shell & system
npm install node-pty
npm install -D @types/node-pty

# Utilities
npm install zod lucide-react clsx
```

---

## Langkah 3 — Setup Docker

Buat file `docker/Dockerfile`:

```dockerfile
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    nginx \
    certbot \
    python3-certbot-nginx \
    curl \
    openssh-server \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Setup SSH
RUN mkdir /var/run/sshd
RUN echo 'root:panel123' | chpasswd
RUN sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config

# Nginx
RUN mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
COPY nginx-default.conf /etc/nginx/sites-available/default

EXPOSE 22 80 443

CMD service ssh start && nginx -g 'daemon off;'
```

Buat file `docker/nginx-default.conf`:

```nginx
server {
    listen 80 default_server;
    server_name _;
    root /var/www/html;
    index index.html;
}
```

Buat file `docker-compose.yml` di root project:

```yaml
version: '3.8'

services:
  server:
    build: ./docker
    container_name: panel-server
    ports:
      - "2222:22"    # SSH
      - "8080:80"    # HTTP
      - "8443:443"   # HTTPS
    volumes:
      - ./server-data/www:/var/www
      - ./server-data/nginx:/etc/nginx/sites-available
    restart: unless-stopped
```

---

## Langkah 4 — Setup Database

Buat file `db/schema.ts`:

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
})

export const domains = sqliteTable("domains", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  domain: text("domain").notNull().unique(),
  rootPath: text("root_path").notNull(),
  sslEnabled: integer("ssl_enabled", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
})

export const activityLogs = sqliteTable("activity_logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
})
```

Buat file `db/index.ts`:

```ts
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import * as schema from "./schema"

const sqlite = new Database("panel.db")
export const db = drizzle(sqlite, { schema })
```

Buat file `drizzle.config.ts`:

```ts
import type { Config } from "drizzle-kit"

export default {
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./panel.db",
  },
} satisfies Config
```

Jalankan migrasi:

```bash
npx drizzle-kit push
```

---

## Langkah 5 — Shell Executor

Buat file `lib/shell.ts`:

```ts
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export async function runCommand(command: string): Promise<{
  stdout: string
  stderr: string
  success: boolean
}> {
  try {
    const { stdout, stderr } = await execAsync(command)
    return { stdout: stdout.trim(), stderr: stderr.trim(), success: true }
  } catch (error: any) {
    return {
      stdout: "",
      stderr: error.message,
      success: false,
    }
  }
}

// Khusus untuk development — jalankan command di Docker container
export async function runInContainer(command: string) {
  return runCommand(`docker exec panel-server bash -c "${command}"`)
}
```

---

## Langkah 6 — Environment Variables

Buat file `.env.local`:

```env
# Auth
NEXTAUTH_SECRET=ganti-dengan-random-string-panjang
NEXTAUTH_URL=http://localhost:3000

# Docker container (untuk development)
CONTAINER_NAME=panel-server
USE_DOCKER=true
```

---

## Langkah 7 — Jalankan

```bash
# Terminal 1 — Start Docker container
docker-compose up -d

# Terminal 2 — Start Next.js
npm run dev
```

Akses panel di: http://localhost:3000

---

## Struktur Folder Final

```
hosting-panel/
├── app/
│   ├── (auth)/
│   │   └── login/
│   │       └── page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── page.tsx              ← Dashboard/monitoring
│   │   ├── domains/
│   │   │   └── page.tsx
│   │   ├── files/
│   │   │   └── page.tsx
│   │   └── ssl/
│   │       └── page.tsx
│   └── api/
│       ├── auth/[...nextauth]/
│       ├── nginx/
│       ├── files/
│       ├── ssl/
│       └── system/
├── db/
│   ├── schema.ts
│   └── index.ts
├── lib/
│   └── shell.ts
├── docker/
│   ├── Dockerfile
│   └── nginx-default.conf
├── docker-compose.yml
├── drizzle.config.ts
├── .env.local
└── package.json
```

---

## Urutan Development

| Step | Fitur | Estimasi |
|------|-------|----------|
| 1 | Auth (login/session) | ~2 jam |
| 2 | Dashboard + monitoring (CPU/RAM/disk) | ~2 jam |
| 3 | Domain & Nginx management | ~3 jam |
| 4 | File manager | ~4 jam |
| 5 | SSL management | ~2 jam |

---

## Catatan Penting

- Panel ini harus jalan **langsung di VPS** saat production (bukan di shared hosting)
- Butuh akses **sudo/root** untuk manage Nginx, SSL, dll
- Untuk production, ganti `runInContainer()` dengan `runCommand()` langsung
- Jangan lupa proteksi API routes dengan auth middleware


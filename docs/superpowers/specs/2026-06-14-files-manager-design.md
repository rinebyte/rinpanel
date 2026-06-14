# rinpanel — Slice Fs: File Manager (Design Spec)

- **Date:** 2026-06-14
- **Status:** Approved (brainstorm) → ready for plan
- **Depends on:** Slice 1, Polish, Slice N
- **Sibling docs:** `design.md` (PHOSPHOR), `CLAUDE.md`, prior specs in `docs/superpowers/specs/`

## 1. Context & goal

Slice Fs adds a per-vhost **file manager** so the user can actually populate the static sites Slice N provisions. Without it, every domain only serves the auto-generated PROVISIONED placeholder — the user has to SSH in to upload content, which defeats the purpose of having a panel.

This is the **second slice where HTTP input touches the filesystem** (after Slice N). Slice N's threat surface was nginx config writes (constrained by `validateDomain`); Fs's threat surface is arbitrary filesystem reads/writes (constrained by a new `validatePath` gate). The pattern is the same: a strict pure-function validator at the wire boundary, then the I/O service trusts its inputs.

## 2. Decisions locked during brainstorming

1. **Full file manager** scope (not minimal): browse + mkdir + upload + download + delete + rename + text-edit-in-place.
2. **Chroot to `/var/www/<domain>/`** — the file manager only operates inside provisioned vhost roots. Cannot read or write `/etc/`, `/root/`, the rinpanel install dir, or any path outside `/var/www/`.
3. **Operations via server actions** (no REST API routes this slice — consistent with Slice N).
4. **Upload limit: 50 MB per file**, via `experimental.serverActions.bodySizeLimit` in `next.config.ts`. Covers static-site assets (HTML/CSS/JS/images/video thumbs). Larger uploads explicitly out of scope for v1.
5. **Inline text editor** for files ≤ 100 KB (raw text in a `<textarea>` with PHOSPHOR mono styling). Binary files are not editable — UI shows file info + download link.
6. **Display:** breadcrumb + flat list (NOT a tree view) — matches PHOSPHOR aesthetic and keeps the component count small.

## 3. Scope

**In scope**
- New service `lib/fs/path.ts` — pure `validatePath(domain, relPath)` returning canonical absolute path or rejection.
- New service `lib/fs/files.ts` — `listDir`, `readFile`, `writeFile`, `mkdir`, `remove`, `rename`, `download` wrappers — all path-gated, all argv-arrayed, integration-tested against the container.
- Server actions: `listEntries`, `mkdir`, `uploadFiles`, `deleteEntry`, `renameEntry`, `saveFile`, `downloadFile` (download is actually a route handler — see §11).
- Files page UI under `/files` — per-domain browser with breadcrumb, file list, action menu, upload drop-zone, inline editor modal.
- Sidebar: enable the `Files` nav item.
- `next.config.ts`: raise server-action body size limit to 50 MB.
- Tests: TDD on `validatePath`, integration tests on `files.ts`, Playwright e2e for the full UI flow.

**Out of scope (other slices / never)**
- Files outside `/var/www/<domain>/` (no `/etc`, no rinpanel-install browsing).
- Bulk operations beyond multi-file upload (no select-all delete, no zip-and-download-dir).
- File preview rendering (no syntax highlighting, no image lightbox — just file info + download).
- Permissions / ownership editor in UI (always force `root:www-data 644 / 755` on writes).
- Multi-megabyte text files (editor capped at 100 KB; larger files are read-only via download).
- Archive extract / create.
- Symlink management — symlinks INSIDE `/var/www/` are not followed; symlinks pointing OUTSIDE are not creatable.
- Move-across-domains.

## 4. UI/UX consistency contract (inherited — non-negotiable)

Reuses every pattern from `docs/superpowers/specs/2026-06-13-domains-nginx-design.md` §4:

- PHOSPHOR tokens, hero block with `MODULE 03 · FILES`, `.glass` + `.corner-ticks` cards.
- ▸-prefix terminal fields for every text input (filename, mkdir name, rename input).
- Native `<dialog>` confirm modal for destructive ops (delete file / delete dir-with-contents) — same shape as the logout and Slice N delete dialogs.
- Eyebrow uppercase mono labels.
- Semantic translucent palette (red on destructive, emerald on success, amber on warnings).
- `animate-glow-pulse` dot for upload-in-progress / save-in-progress.
- Mobile-first at 390 px; closing QA gate = Playwright at desktop + mobile.

Specific to this slice:
- Breadcrumb under the hero: `▸ /var/www / example.com / public_html / blog`, each segment clickable.
- File rows: icon (lucide) + mono name + size (right-aligned mono) + modified-at (right-aligned, zinc-500) + action menu (`⋯` icon → popover with Edit / Rename / Download / Delete).
- Upload drop-zone is a dashed-border `.glass` panel above the list ("drop files here · or click to choose"). Shows progress per file during upload.
- Editor modal: `<dialog>` opening to ~80% viewport with breadcrumb + `<textarea>` filling the body + Save (lime) / Cancel (ghost) footer. Save uses optimistic UI: pending state shows `[ ·· ] saving`.

## 5. Path validation rules (the security gate — `lib/fs/path.ts`)

`validatePath(domain, relPath)` is the **only** function that turns user input into an absolute filesystem path. Everything downstream assumes its output is safe.

Rules:
1. `domain` must already be in DB (the caller checks; the validator only checks string shape via `validateDomain` from Slice N).
2. `relPath` is the path **relative to** `/var/www/<domain>/`. Empty string = root. Leading `/` allowed and stripped.
3. After stripping leading `/`, split on `/`. Each segment:
   - Non-empty.
   - Not `.` or `..`.
   - No null bytes (`\0`).
   - No control chars (`< 0x20`).
   - No forward slashes (already split, but defensive).
   - Length ≤ 255 (POSIX filename limit).
4. Total path length (joined absolute) ≤ 4096 (POSIX `PATH_MAX`).
5. Compute candidate = `path.posix.join("/var/www", domain, ...segments)`.
6. **Canonical check:** the candidate must START with `/var/www/<domain>/` (or equal `/var/www/<domain>` exactly for the root). This is structural, not realpath-based — the I/O layer separately rejects symlinks pointing outside.
7. Return `{ ok: true, absolute: candidate }` or `{ ok: false, reason }`.

> **Why structural rather than `realpath`-based:** `realpath` requires the path to exist, which prevents validating uncreated paths (mkdir, write-new-file). Structural validation handles non-existent paths correctly; the symlink-escape risk is mitigated by the I/O service: every `read`/`write`/`unlink` operation uses `O_NOFOLLOW` semantics (in practice: `lstat` first, refuse if symlink crosses out of `/var/www/<domain>/`).

Filename validation for ops that CREATE entries (mkdir, upload, rename target):
- Same per-segment rules as above.
- Plus: no leading dot for v1 (`.htaccess` is the only common exception — note below).

**Open call-out (not blocking):** `.htaccess`-style hidden files are blocked by the "no leading dot" rule. This is the safe-by-default choice; nginx doesn't use `.htaccess` anyway (that's Apache), so the practical loss is near zero. If a user needs them later, we can add an "allow leading dot" toggle in a polish pass.

## 6. File service (`lib/fs/files.ts`)

All ops take `(domain, relPath)` (or `(domain, oldRel, newRel)` for rename), validate via `validatePath`, then call `runOnTarget` for the actual I/O. Operations:

### `listDir(domain, relPath)`
Returns `{ entries: Array<{ name, type: "file"|"dir", size: number, mtime: number }>, error? }`. Implemented via `runOnTarget(["ls", "-la", "--time-style=+%s", absPath])` and parsed; alternative: `find -maxdepth 1 -printf '%y\t%s\t%T@\t%f\n'`.

`find` is cleaner to parse (tab-delimited) and is in the container. Going with `find`.

### `readFile(domain, relPath, maxBytes)`
Used by the editor. Returns `{ content: string, truncated: boolean, isBinary: boolean }`. Implemented via `runOnTarget(["head", "-c", String(maxBytes), absPath])`. Binary detection: scan first 8 KB for null bytes — if any, `isBinary: true`. Default `maxBytes = 100 KB + 1` to detect truncation cleanly.

### `writeFile(domain, relPath, content)`
For editor save AND for upload (which is multi-write). Uses `writeFileOnTarget(absPath, content)` from `lib/system/target-fs.ts` (Slice N). After write: `runOnTarget(["chown", "root:www-data", absPath])` + `runOnTarget(["chmod", "644", absPath])`.

### `mkdir(domain, relPath)`
`runOnTarget(["mkdir", "-p", absPath])` + chown/chmod 755.

### `remove(domain, relPath, opts: { recursive?: boolean })`
For files: `runOnTarget(["rm", "-f", absPath])`. For dirs with `recursive`: `runOnTarget(["rm", "-rf", absPath])`.

> **Refuse `recursive` if `relPath === ""` (the webroot itself).** A user accidentally `rm -rf /var/www/<domain>` is hard to undo; that op should go through `removeVhost(domain, { wipeWebroot: true })` instead.

### `rename(domain, oldRel, newRel)`
Both paths validated; same-domain only. `runOnTarget(["mv", oldAbs, newAbs])`.

### `download(domain, relPath) → ReadableStream`
**Different mechanism — see §11** (this is a route handler, not a service function). For prod, `fs.createReadStream(absPath)`; for dev, `docker cp` from container to a temp file, then stream that file (similar pattern to `writeFileOnTarget` but inbound).

## 7. Server actions (`app/(dashboard)/files/actions.ts`)

- `mkdirEntry(_prev, formData)` — `{ domain, relPath, name }` → call service → revalidate.
- `uploadFiles(formData)` — `{ domain, relPath, files: File[] }` → loop write → revalidate. **The big one** (multipart, 50 MB cap).
- `deleteEntry(formData)` — `{ domain, relPath, recursive }` → call service → revalidate.
- `renameEntry(_prev, formData)` — `{ domain, relPath, newName }` → call service → revalidate.
- `saveFile(_prev, formData)` — `{ domain, relPath, content }` → service write → revalidate.

Common: each action calls `requireSession()`, validates inputs (string shape + `validateDomain` + `validatePath`), calls the service, returns `ActionResult`. Audit events: `file_mkdir`, `file_upload` (with count), `file_delete`, `file_rename`, `file_edit`.

The browse operation is NOT a server action — the page is a Server Component that calls `listDir` directly during render.

## 8. UI

### Pages

- **`/files`** — Server Component. Lists the user's domains (read from DB) as a grid of `.glass` cards: domain name + active chip + entry count (cheap `find -maxdepth 1 | wc -l`). Click → `/files/[domain]`.
- **`/files/[domain]/[[...path]]`** — Server Component. Renders the breadcrumb + flat list for the requested path. Uses the catch-all segment to navigate freely.

### Components

- `components/files/breadcrumb.tsx` — server: parses path, renders clickable segments separated by `/`. PHOSPHOR mono.
- `components/files/file-list.tsx` — server-rendered list of `<FileRow/>` (client).
- `components/files/file-row.tsx` — client: icon + name + size + mtime + `⋯` menu. Menu items: Edit (if `<100KB` text), Rename, Download (route handler link), Delete.
- `components/files/upload-zone.tsx` — client: drag-and-drop + click-to-choose. Per-file progress bar. Calls `uploadFiles` server action.
- `components/files/mkdir-form.tsx` — small form at the top of the list (next to the upload zone): `+ new folder` button → expands to ▸ input.
- `components/files/delete-dialog.tsx` — `<dialog>` confirm. For dirs with content, the dialog warns and requires checking "include all contents" (parallel to wipeWebroot in Slice N).
- `components/files/rename-dialog.tsx` — `<dialog>` with the ▸ input pre-filled.
- `components/files/editor-dialog.tsx` — large `<dialog>` (80% viewport): breadcrumb + `<textarea>` with monospace lime caret + Save / Cancel footer. ESC closes (with unsaved-changes confirm — handled via standard `beforeunload`-style guard inside the dialog state).

### Sidebar

Flip the `Files` `NAV` entry to `enabled: true`. `code: "03"`. Same active-pill behavior.

### Empty states

- No domains yet → "no domains configured · tambahin di /domains dulu"
- Empty webroot dir → "no files here · drop files in the zone above"

## 9. Failure semantics

- Path validation runs **twice** (server action, then inside `lib/fs/files.ts`) — defense in depth.
- Every mutating op returns `{ ok, error? }`. The UI surfaces errors in semantic-red banners (inline for the row that triggered it, or top-of-page for upload).
- Upload partial failure: each file is uploaded independently; the UI shows per-file status (queued / uploading / done / failed `<reason>`). One file failing doesn't abort the batch.
- Editor save on a file that vanished mid-edit: `ENOENT` surfaces as "file no longer exists". The dialog stays open so the user can copy out their changes.
- Permission errors (root vs www-data write conflicts) surface verbatim in the banner.
- `nginx -t` / reload are NOT invoked for any file ops (these files don't affect nginx config; nothing to reload).

## 10. Security

- **`validatePath` is the wire boundary.** No other entry point. Every server action calls it on every user-supplied path.
- **`lib/shell.ts` argv-array seam carries over.** Domain + filename interpolation only happens AFTER validation strips dangerous chars.
- **Webroot-only chroot is structural** (path startsWith check after join). Not relying on `realpath` so we can validate non-existent paths.
- **Symlink escape:** the I/O layer uses `lstat` checks before any read/write. If a path resolves to a symlink pointing outside `/var/www/<domain>/`, refuse.
- **Upload content** is bytes — written to a fresh inode, no exec. Files served by nginx as static; nginx won't execute server-side anything (no PHP-FPM in this slice).
- **Filename sanitization on upload:** the browser-supplied `file.name` goes through the same per-segment rules as `validatePath`. Reject — don't rename.

## 11. Downloads — route handler, not server action

Server actions can't stream binary responses. Add a route handler:

`app/api/files/[domain]/[...path]/route.ts` — auth-gated, calls `validatePath`, then streams the file:

- Dev (`USE_DOCKER=true`): use the same `docker cp` mechanism as `writeFileOnTarget` but in reverse — `docker cp panel-server:<abs> /tmp/<rand>` then stream the temp file + cleanup.
- Prod (`USE_DOCKER=false`): `createReadStream(abs)` directly.

Wraps in `Response` with `Content-Disposition: attachment; filename="<name>"`. This is the only API route added by Slice Fs — necessary because of the binary-stream semantics.

## 12. Tests

- `validatePath` — unit, TDD. Positive: `("example.com", "")`, `("example.com", "public_html")`, `("example.com", "public_html/index.html")`, `("example.com", "/public_html/")` (leading slash stripped). Negative: `("example.com", "..")`, `("example.com", "public_html/../../etc/passwd")`, `("example.com", "foo/ /bar")`, very-long, control chars, dot-segments, leading-dot filename rejection.
- `files.ts` — integration against the live `panel-server` container (skip if Docker absent). For each op: setup a fixture vhost via `applyVhost`, then exercise `listDir` / `writeFile` / `readFile` / `mkdir` / `remove` / `rename`, asserting both the in-container effects (via `runOnTarget` checks) and the returned shapes.
- Server actions — auth gate (401), invalid path rejection, success path (mock service).
- Files page — Playwright e2e: navigate `/files` → pick domain → create dir → upload 2 files (one ~1 MB, one tiny) → verify list updates → rename a file → edit a text file → save → re-open → confirm content persisted → delete file → delete dir with contents (via dialog checkbox).
- Mobile QA at 390 px.

## 13. Acceptance criteria

1. Unauthenticated request to `/files`, `/files/[domain]`, server actions, or the download route → redirect/401.
2. `validatePath` rejects every payload in §12 negative list with a clear `reason`.
3. Creating a directory works and appears in the listing; permissions are `755 root:www-data`.
4. Uploading a 30 MB file succeeds and the file is served by nginx (curl returns 200 with the content) at `http://<domain>/<filename>`.
5. Editing `index.html` inline, saving, then curling the domain returns the edited content (overwrites the placeholder).
6. Renaming a file/dir updates the listing and disk state; curl serves at the new name and 404s at the old.
7. Deleting a file removes it from disk; deleting a non-empty dir requires the "include all contents" checkbox.
8. PHOSPHOR styling correct at 390 px and desktop; sidebar `Files` item active when on `/files`.
9. Activity log captures `file_mkdir`, `file_upload`, `file_delete`, `file_rename`, `file_edit`.
10. Attempting `..`-escapes via any UI path (URL bar, filename input, upload filename) is rejected with a clear error.

## 14. Project structure (additions)

```
lib/fs/path.ts                              # NEW (+ .test.ts) — validatePath
lib/fs/files.ts                             # NEW (+ .test.ts) — service ops, container integration
next.config.ts                              # MODIFY — experimental.serverActions.bodySizeLimit: '50mb'
app/(dashboard)/files/page.tsx              # NEW (server) — domain picker
app/(dashboard)/files/[domain]/[[...path]]/page.tsx  # NEW (server) — file browser
app/(dashboard)/files/actions.ts            # NEW — mkdir/upload/delete/rename/save server actions
app/api/files/[domain]/[...path]/route.ts   # NEW — download route handler
components/files/breadcrumb.tsx             # NEW
components/files/file-list.tsx              # NEW (server)
components/files/file-row.tsx               # NEW (client, with action menu)
components/files/upload-zone.tsx            # NEW (client, drag+drop)
components/files/mkdir-form.tsx             # NEW (client)
components/files/delete-dialog.tsx          # NEW (client, native <dialog>)
components/files/rename-dialog.tsx          # NEW (client, native <dialog>)
components/files/editor-dialog.tsx          # NEW (client, native <dialog>, textarea)
components/app-shell/sidebar.tsx            # MODIFY — Files nav enabled: true
```

## 15. Dependencies

None new. Reuse `lucide-react`, drizzle, `runOnTarget`, `writeFileOnTarget`, the PHOSPHOR utilities.

## 16. Notes / gotchas

- **`next.config.ts` bodySizeLimit** is experimental as of Next 16; we set `experimental.serverActions.bodySizeLimit: '50mb'`. If the experimental flag is renamed in a later Next version, update accordingly.
- **`find` in the container** is GNU find (Ubuntu base) — `-printf` is GNU-only and works there. Don't switch to BusyBox.
- **Editor large-file UX:** the 100 KB cap is enforced server-side; the UI tells the user "file too large for editor — download to edit" with a download button. No silent truncation in the editor.
- **Upload zone uses `<input type="file" multiple>`** for the click-fallback and dragenter/dragover/drop handlers for the drag path. Both funnel into the same `uploadFiles` action.
- **The `Edit` menu item is hidden for binary files** (detected via the first-8KB null-byte scan in `readFile` — but for the LIST view we can't afford to read every file; use file-extension heuristic instead: `.html`, `.css`, `.js`, `.txt`, `.md`, `.json`, `.svg`, `.xml`, `.conf` are editable, everything else is download-only).
- **Permissions: ALWAYS chown to `root:www-data` after writes.** nginx in the container runs as `www-data`; without this the file is `root:root` and may still be readable (because of `o+r`), but for prod parity we do it consistently.
- **In dev container we write as root via `docker exec`, so the `chown root:www-data` works.** In prod (rinpanel running as root), same.
- **Path canonicalization order:** strip leading `/` → split on `/` → reject `.`/`..` segments → join with `path.posix.join`. Posix join collapses internal `//` but does NOT resolve `..` once we've already rejected them; we never let `..` reach `path.posix.join`.
- **`/files` and `/domains` cross-link**: each domain card on `/files` should link to its own `/files/<domain>`, and each row on `/domains` could optionally show a "files" icon → its `/files/<domain>`. The reverse cross-link is a polish item; defer.

## 17. Follow-ups (later, not this slice)

- Image lightbox / preview.
- Syntax highlight in the editor (CodeMirror or similar — would need to weigh bundle size).
- Bulk operations: select-all delete, zip-download dir.
- `.htaccess`-style hidden file toggle (currently blocked).
- Larger upload via chunked / resumable protocol (defer until 50 MB cap becomes a real complaint).
- Read-only file-info panel for files > 100 KB (currently we just say "too large for editor").

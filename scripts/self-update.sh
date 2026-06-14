#!/usr/bin/env bash
# rinpanel self-update — pulls latest main, installs deps, rebuilds,
# then restarts the rinpanel systemd service.
#
# Invoked via `systemd-run --collect --no-block --unit=rinpanel-update`
# so it lives in its own transient unit and survives the
# `systemctl restart rinpanel` at the end.

set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

INSTALL_DIR="${INSTALL_DIR:-/opt/rinpanel}"
LOG_FILE="${LOG_FILE:-/var/log/rinpanel-update.log}"
STATUS_FILE="${STATUS_FILE:-$INSTALL_DIR/.update-status}"

mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true

set_status() { printf '%s\n' "$1" > "$STATUS_FILE"; }

# Redirect everything from here onward to the log file.
exec >>"$LOG_FILE" 2>&1
echo
echo "=========================================="
echo "rinpanel self-update · $(date -Is)"
echo "=========================================="

trap '{
  rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "FAILED at exit $rc"
    set_status "failed"
  fi
}' EXIT

set_status "pulling"
cd "$INSTALL_DIR"
echo "▸ git pull"
git pull --ff-only

set_status "installing"
echo "▸ npm install"
npm install --silent

set_status "building"
echo "▸ npm run build"
npm run build

set_status "migrating"
echo "▸ npm run db:push"
npm run db:push || true   # idempotent; never fatal

set_status "restarting"
echo "▸ systemctl restart rinpanel"
systemctl restart rinpanel

set_status "ok"
echo "done · $(date -Is)"

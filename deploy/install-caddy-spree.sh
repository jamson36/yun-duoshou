#!/bin/sh
set -eu

target=/etc/caddy/Caddyfile
snippet=/home/spree/deploy/Caddyfile.spree
candidate="$(mktemp)"
backup="/etc/caddy/Caddyfile.bak-$(date +%Y%m%d%H%M%S)-spree"

cleanup() {
  rm -f "$candidate"
}
trap cleanup EXIT

test -f "$target"
test -f "$snippet"

cp -a "$target" "$backup"
awk '
  /^# BEGIN SPREE$/ { skipping = 1; next }
  /^# END SPREE$/ { skipping = 0; next }
  !skipping { print }
' "$target" > "$candidate"
printf '\n' >> "$candidate"
cat "$snippet" >> "$candidate"

caddy validate --adapter caddyfile --config "$candidate"
install -m 644 "$candidate" "$target"

if ! systemctl reload caddy || ! systemctl is-active --quiet caddy; then
  install -m 644 "$backup" "$target"
  systemctl reload caddy
  echo "Caddy reload failed; restored $backup" >&2
  exit 1
fi

echo "Caddy updated; backup: $backup"

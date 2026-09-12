#!/usr/bin/env bash
#
# Scans tracked files for high-signal secret material.
#
# Scope is `git ls-files`, so node_modules, .env, dist and coverage are never
# scanned and the check is cheap. Only the file and line number are printed —
# never the matched value — so a finding cannot leak into CI logs.
#
# This is a backstop, not a replacement for credential scanning at the edge.
# Upgrade path: gitleaks (full entropy + ruleset) once it is available in CI,
# see docs/adr/ADR-007-secret-scanning.md.
#
# Usage: scripts/check-secrets.sh
# Exit:  0 = clean, 1 = findings

set -uo pipefail

cd "$(dirname "$0")/.."

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  FILES=$(git ls-files)
else
  FILES=$(find . -type f \
    -not -path './node_modules/*' \
    -not -path './.git/*' \
    -not -path './dist/*' \
    -not -path './coverage/*' \
    -not -path './.turbo/*' \
    -not -name '.env' -not -name '.env.*' \
    | sed 's|^\./||')
fi

# Files that legitimately contain pattern-looking text.
ALLOWLIST_FILE='scripts/check-secrets.allowlist'

if [ -f "$ALLOWLIST_FILE" ]; then
  FILES=$(printf '%s\n' "$FILES" | grep -vxFf "$ALLOWLIST_FILE" || true)
fi

# pattern-key|extended-regex
PATTERNS=(
  'private-key-block|-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'aws-access-key-id|AKIA[0-9A-Z]{16}'
  'aws-secret-access-key|aws_secret_access_key[[:space:]]*[=:][[:space:]]*[A-Za-z0-9/+=]{40}'
  'hex-private-key|(privateKey|private_key|PRIVATE_KEY)[[:space:]]*[=:][[:space:]]*["'\'']?(0x)?[a-fA-F0-9]{64}'
  'mnemonic|(mnemonic|seedPhrase|seed_phrase|SEED_PHRASE)[[:space:]]*[=:][[:space:]]*["'\''][a-z]+([[:space:]]+[a-z]+){11,23}["'\'']'
  'bearer-or-api-key-literal|(api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token)[[:space:]]*[=:][[:space:]]*["'\''][A-Za-z0-9_\-]{32,}["'\'']'
  'pem-pkcs8|-----BEGIN ENCRYPTED PRIVATE KEY-----'
)

FINDINGS=0

for entry in "${PATTERNS[@]}"; do
  KEY="${entry%%|*}"
  REGEX="${entry#*|}"
  # shellcheck disable=SC2086
  while IFS=: read -r file line _rest; do
    [ -z "${file:-}" ] && continue
    echo "  ❌ ${KEY}  ${file}:${line}"
    FINDINGS=$((FINDINGS + 1))
  done < <(printf '%s\n' "$FILES" | xargs -r grep -InE -- "$REGEX" 2>/dev/null || true)
done

if [ "$FINDINGS" -gt 0 ]; then
  echo
  echo "❌ Secret scan found ${FINDINGS} potential secret(s)."
  echo "   Values are intentionally not printed. Remove the material, rotate the"
  echo "   credential, and add false positives to $ALLOWLIST_FILE."
  exit 1
fi

echo "✅ Secret scan clean"

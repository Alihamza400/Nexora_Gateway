#!/usr/bin/env bash
#
# Structural policy checks that unit tests cannot express.
#
# These guard rules from docs/adr and docs/REMAINING-IMPLEMENTATION-STRATEGY.md:
#   - no mock adapters reachable from a production entrypoint (guiding principle 4)
#   - no in-process timers in retry paths; retries must be durable (principle 1)
#   - monetary values in the ledger must never be hardcoded to zero
#
# Known, accepted violations live in scripts/policy-baseline.txt. The baseline may
# only shrink: adding new violations fails the build. When you fix a violation,
# delete its line from the baseline. Run with --show-current to print the live
# violation set.
#
# Usage: scripts/check-policy.sh [--show-current]
# Exit:  0 = no new violations, 1 = new violations (or baseline file missing)

set -uo pipefail

cd "$(dirname "$0")/.."

BASELINE_FILE="scripts/policy-baseline.txt"
CURRENT_FILE="$(mktemp)"
BASELINE_CLEAN="$(mktemp)"
trap 'rm -f "$CURRENT_FILE" "$BASELINE_CLEAN"' EXIT

# Only real, runnable processes. Library packages are not entrypoints.
ENTRYPOINT_DIRS=(
  packages/api-gateway/src
  packages/worker/src
)

# Services whose retry logic must be durable, never timer-based.
RETRY_PATH_DIRS=(
  packages/settlement/src
  packages/payment-intent/src
  packages/recovery/src
  packages/reconciliation/src
  packages/compliance/src
  packages/worker/src
)

existing_dirs() {
  local dir
  for dir in "$@"; do
    [ -d "$dir" ] && printf '%s\n' "$dir"
  done
}

# Emits "<check-id>|<file>|<count>" lines, sorted.
collect_violations() {
  local dirs

  # 1. Mock adapters must not be imported by a production entrypoint.
  #    Tests may mock freely; only shipped code is gated.
  dirs=$(existing_dirs "${ENTRYPOINT_DIRS[@]}")
  if [ -n "$dirs" ]; then
    # shellcheck disable=SC2086
    grep -rIn --include='*.ts' --exclude='*.test.ts' -iE 'mock' $dirs 2>/dev/null \
      | cut -d: -f1 | sort | uniq -c | awk '{print "no-mocks-in-entrypoints|" $2 "|" $1}' || true
  fi

  # 2. Retries must be durable, not setTimeout-based.
  dirs=$(existing_dirs "${RETRY_PATH_DIRS[@]}")
  if [ -n "$dirs" ]; then
    # shellcheck disable=SC2086
    grep -rIn --include='*.ts' --exclude='*.test.ts' 'setTimeout' $dirs 2>/dev/null \
      | cut -d: -f1 | sort | uniq -c | awk '{print "no-setTimeout-in-retry-paths|" $2 "|" $1}' || true
  fi

  # 3. Monetary fields must never be hardcoded to zero.
  if [ -d packages/chain-abstraction/src ]; then
    grep -rIn --include='*.ts' --exclude='*.test.ts' \
      -E 'amountUSD: 0|totalCostUSD = 0|totalCostUSD: 0' packages/chain-abstraction/src 2>/dev/null \
      | cut -d: -f1 | sort | uniq -c | awk '{print "no-zero-usd-valuation|" $2 "|" $1}' || true
  fi
}

collect_violations | sort -u > "$CURRENT_FILE"

if [ "${1:-}" = "--show-current" ]; then
  if [ ! -s "$CURRENT_FILE" ]; then
    echo "(no violations)"
  else
    sed 's/|/  /g' "$CURRENT_FILE"
  fi
  exit 0
fi

if [ ! -f "$BASELINE_FILE" ]; then
  echo "❌ policy: baseline file $BASELINE_FILE is missing" >&2
  exit 1
fi

grep -v '^[[:space:]]*#' "$BASELINE_FILE" 2>/dev/null | grep -v '^[[:space:]]*$' | sort -u > "$BASELINE_CLEAN" || true

NEW_VIOLATIONS=$(comm -23 "$CURRENT_FILE" "$BASELINE_CLEAN")
FIXED_VIOLATIONS=$(comm -13 "$CURRENT_FILE" "$BASELINE_CLEAN")

if [ -n "$NEW_VIOLATIONS" ]; then
  echo "❌ New policy violations:"
  echo "$NEW_VIOLATIONS" | sed 's/^/     /'
  echo
  echo "  Fix the violation, or add its line to $BASELINE_FILE with a justification."
  exit 1
fi

if [ -n "$FIXED_VIOLATIONS" ]; then
  echo "ℹ️  Baseline entries that no longer exist — delete them from $BASELINE_FILE:"
  echo "$FIXED_VIOLATIONS" | sed 's/^/     /'
fi

echo "✅ Policy checks passed ($(wc -l < "$CURRENT_FILE" | tr -d ' ') known violation file(s))"

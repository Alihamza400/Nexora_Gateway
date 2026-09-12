# ADR-007: Repository-level secret scanning

## Status

Accepted — 2026-09-12

## Context

The gateway handles material that is immediately monetizable if leaked: hot-wallet
signing keys (or the KMS key ARNs and role permissions that reach them),
compliance vendor API keys, RPC provider keys with billing attached, and merchant
webhook secrets.

Three specific exposures existed at the time of this decision:

1. `k8s/secrets.yml` was committed with a working `DATABASE_URL`
   (`postgresql://postgres:postgres@...`). Even as a placeholder it establishes the
   pattern of secrets living in git — and the placeholder password is a real
   credential in local and CI environments.
2. `.env.example` is the only documented surface for configuration, and it lists
   no signing, routing, paymaster or oracle variables. New integrations would
   naturally put values somewhere undocumented.
3. There was no check at all, so nothing prevented the next commit from adding a key.

## Decision

Two complementary controls, plus one that is deliberately deferred.

1. **`scripts/check-secrets.sh`** — a zero-dependency scanner over `git ls-files`.
   High-signal patterns only: PEM private key blocks (including encrypted PKCS#8),
   AWS access key IDs and secret access keys, hex private keys adjacent to
   `privateKey`/`private_key`, BIP-39 mnemonics, and long literal strings assigned
   to `api_key`/`secret`/`access_token`/`client_secret`.
   It prints **only the file and line number, never the matched value**, so a
   finding cannot leak into CI logs. It runs as a gating step in the `policy` job.

2. **External Secrets Operator** instead of committed secrets
   (`k8s/base/external-secrets.yml`). `k8s/secrets.yml` was deleted. Secrets are
   pulled from AWS Secrets Manager at runtime and never exist in the repository.

3. **Deferred: gitleaks.** Full entropy scanning plus a maintained rule set is
   strictly better than a fixed pattern list. It is deferred only because it needs
   a licensed action or a pinned binary in CI, and a scanner that fails to install
   is worse than a scanner that always runs. The upgrade path is a drop-in
   replacement for the `Secret scan` step.

## Consequences

### Positive

- A committed key now fails CI within seconds, with a clear pointer to the fix.
- The scan works with no network access, no license, and no version pinning, so it
  cannot break the build by being unavailable.
- Not logging matched values means CI artifacts and logs from a failing build are
  themselves safe to share.

### Negative

- Pattern-based detection has false negatives that entropy scanning would catch: an
  unknown-format key assigned to an innocuous variable name is missed. Accepted as a
  backstop, not the only line of defence — the primary controls are ESO, IAM scoping
  (ADR-001 service accounts), and never committing secrets at all.
- Patterns have some false positives, managed via
  `scripts/check-secrets.allowlist` (file-level), so a legitimately pattern-shaped
  fixture does not block the build.

## Alternatives considered

**`gitleaks/gitleaks-action`.** Requires a license for organizations; availability
is uncertain for this repository. Deferred rather than adopted, to keep the gate
deterministic.

**GitHub push protection only.** Necessary but insufficient: it depends on the
provider recognizing the secret format, and it gives no local feedback before push.

**Pre-commit hook only.** The Husky hook is a convenience, not a control. It can be
bypassed with `--no-verify` and is absent in CI's checkout. The gate must live in CI;
the local hook is a bonus.

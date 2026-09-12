import { defineConfig } from 'vitest/config';

/**
 * Coverage configuration.
 *
 * Type-only modules, barrel files, and constant tables are excluded because they
 * contain no executable logic — counting them dilutes the signal and hides real
 * gaps.
 *
 * Thresholds are a RATCHET, not a target. Each per-package value is the floor
 * measured when the gate was introduced, so it blocks regressions immediately and
 * must be raised as work lands. The money-path packages (settlement,
 * payment-intent, compliance, rate-lock) are required to reach 80% by Gate G3 —
 * see docs/REMAINING-IMPLEMENTATION-STRATEGY.md §5 and §6 WS5.
 *
 * Ratchet history:
 *   2026-09  introduced. payment-intent 24, settlement 47, rate-lock 63.
 *   2026-09  worker added at 60 (composition.ts, job-handlers.ts and
 *            health-server.ts are exercised end-to-end, not by unit tests).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'json-summary'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.test.ts',
        'packages/*/src/**/*.spec.ts',
        // Interfaces and enums only — no runtime behaviour to cover.
        'packages/*/src/types/**',
        // Data tables (ABI manifests, address lists, static configs).
        'packages/*/src/constants/**',
        // Re-export barrels.
        'packages/*/src/**/index.ts',
      ],
      thresholds: {
        // Repo-wide floor, measured at 65.2% lines.
        lines: 60,
        statements: 60,
        functions: 85,

        // ─── Ratchet floors, lowest first ────────────────────────────────────
        'packages/api-gateway/src/**': { lines: 39, statements: 39 },
        'packages/settlement/src/**': { lines: 47, statements: 47 },
        'packages/rate-lock/src/**': { lines: 63, statements: 63 },
        'packages/chain-abstraction/src/**': { lines: 77, statements: 77 },
        'packages/compliance/src/**': { lines: 79, statements: 79 },
        'packages/reconciliation/src/**': { lines: 80, statements: 80 },
        'packages/recovery/src/**': { lines: 81, statements: 81 },
        'packages/gas-abstraction/src/**': { lines: 91, statements: 91 },
        'packages/routing-engine/src/**': { lines: 97, statements: 97 },
        'packages/shared/src/**': { lines: 99, statements: 99 },

        // payment-intent is the system of record; its floor is set by the
        // repository layer, which needs live Postgres (integration suite).
        'packages/payment-intent/src/**': { lines: 24, statements: 24 },

        // worker: the untested remainder is the composition root and HTTP surface,
        // which need a live database and chain to exercise meaningfully.
        'packages/worker/src/**': { lines: 60, statements: 60 },
      },
    },
  },
});

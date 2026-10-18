# Server boot captures

Captured on 2026-10-18 from worktree commit `c7358571a` using the real
`SparkyFitnessServer/index.ts` boot path and disposable `postgres:18.3-alpine`.
The excerpts end at `Starting server...`; each complete boot reached
`SparkyFitnessServer listening on port` before graceful shutdown.

- Fresh database: 273 `Applying migration:` lines (capture used to seed the
  disposable database; the full capture stays in local test evidence).
- `zero-applied.txt`: second boot against that database, without changes.
- `one-applied.txt`: third boot, after deleting exactly the
  `20261018100000_strength_rir.sql` row from `system.schema_migrations`.
  The SQL file and schema were unchanged; its idempotent statements reran.

The boots used the worktree's `tsx` loader, an inline environment with synthetic
credentials and role `fixture_app`, and a preload overriding `dotenv.config` to
prevent loading repo `.env`. Scheduled jobs were disabled and the log level was
`info`. Only disposable container `zfit-test-94` on loopback port 55494 was used;
it was removed afterward. No live logs or database were accessed.

These are contiguous startup excerpts, including the real multiline historical
migration lists and their built-in Node inspection truncation. No log lines were
invented. The excerpts contain no credentials, hostnames, or local paths, so no
substitutions were necessary. Timestamps and migration names are preserved.

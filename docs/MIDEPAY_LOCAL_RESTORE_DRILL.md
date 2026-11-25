# Isolated backup restore drill

This drill uses only a newly created loopback PostgreSQL cluster and synthetic financial records. It never accepts a remote database URL, exports hosted customer data, restores over an active database, or changes staging/production controls.

## What the test does

Run the existing native financial regression suite with `MIDEPAY_BACKUP_DRILL=1`. Supply `MIDEPAY_PG_BIN` containing matching `postgres`, `initdb`, `pg_ctl`, `pg_dump` and `pg_restore` tools. The existing native test root and optional `MIDEPAY_PG_MODULE` settings still apply. CI enables the drill with its installed PostgreSQL 16 toolchain.

After migrations and financial regressions, the test takes a custom-format `pg_dump` of the populated synthetic database and restores it with `pg_restore --exit-on-error` into a separate empty database. It compares every ordinary table in public/private/auth using row counts and ordered content digests. It compares sequence positions, column metadata, constraints, indexes, triggers, function definitions/execution grants, table grants and RLS policy definitions. Only database catalog names are normalized because the restore target deliberately has a different name.

The restored database must also reject anonymous access to private reconciliation controls, expose no wallets to an authenticated caller without a live session, and return a balanced ledger reconciliation for the synthetic refund test member through the service API. PostgreSQL may restore default owner permissions as a null ACL instead of an explicit owner-only ACL; the comparison expands null ACLs to their PostgreSQL defaults before comparing, without ignoring grants.

The test writes `backup-restore-evidence.json` with aggregate assertions and archive size. The synthetic archive remains in the local evidence directory; CI uploads evidence JSON and logs, not database archives. The entire disposable server is stopped in the test's cleanup path.

## Actual result — 25 November 2026

PostgreSQL 15.15 with matching backup tools: **23/23 native groups passed**, including the restore drill. All 29 migrations applied; 34 tables matched; archive size was 402,884 bytes. Catalog/sequence comparison, anonymous private-access denial, missing-session wallet denial and the restored refund-wallet ledger check passed. The disposable server stopped with process exit code 0.

Evidence: Codex workspace `work/restore-drill/midepay-isolated-pg-qcR4b0/backup-restore-evidence.json` and `server.log`. The new GitHub workflow configuration has not yet been observed running on GitHub; this result is the local run, not a claim of a green hosted CI run.

## Limits

During development, the first attempt stopped before dumping because libpq looked for a missing service file. The fixture now supplies empty local connection files and removes inherited service selection. A subsequent restore completed but its catalog assertion rejected an explicit owner-only ACL versus PostgreSQL's equivalent default ACL; the comparator now expands defaults. Neither failure was treated as a successful drill. No application migration or hosted database was changed to address these fixture issues.

This validates a local logical backup/restore process against the application migration chain. It does not verify a Supabase-managed backup, PITR/WAL recovery, managed Auth schema, cluster-role recovery, encrypted backup custody, off-site retention, storage objects, Edge Functions, secrets or external provider records. Roles already exist in the disposable cluster, as they must in a prepared restore target. The full native suite is not rerun against the restored database; the listed restored-access and ledger checks are explicit acceptance probes.

Synthetic concurrency fixtures deliberately mutate some balances to isolate locking, so this is not a claim that every synthetic wallet is globally reconciled. Full contents are compared exactly and the dedicated refund wallet has a verified balanced ledger after restore.

A genuine hosted backup restore into an isolated approved target, with agreed recovery objectives and custody, remains a launch blocker. Passing this test does not authorize live payouts.

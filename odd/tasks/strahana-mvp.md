# strahana-mvp

Objective: implement the STRAHANA MVP (docs/00-pov.md) phase by phase (POV §16). Package manager: pnpm (user decision; CLAUDE.md still says npm -> to be aligned in P1).
Scope: POV only. No proposals (docs/proposals) code.

## Tasks
- [x] P0.1 (done: 175/175 tests, 62/62 allowed, 0/102 forbidden slipped; awaiting user approval) Parser spike in spikes/ (~100-query corpus; subset parses, unsupported fails closed). GATE: user approves before P1.
- [ ] P0.2 STRAHANA_RO .hdbrole + HANA connectivity checks (external, needs user/infra) - pending user
- [x] P1 platform/ (config, credentials, errors, logger, API key, MCP stdio+HTTP, MTA) - implemented, uncommitted (CLAUDE.md: commits are manual); 75/75 tests, lint green
- [x] P2 catalog context + hana_context (recall 96.0% >= 90%, context <= 800 tokens) - implemented, uncommitted; awaiting user review
- [x] P3 query context + hana_query (code complete, in-memory executor; real-DB validation as STRAHANA_RO pending = P0.2 + opt-in integration test)
- [ ] P4 pilot (user-driven)

## Routes
- P0.1: delegated direct (writer; multi-file, prep reading of POV §6)

## Progress / evidence
(none yet)

## Phase 1 breakdown (spike approved by user; real DB tests deferred, test connection only)
- [x] P1.1 Tooling: tsconfig strict NodeNext, eslint+prettier, node:test scripts, pinned deps (pnpm)
- [x] P1.2 platform/errors + logging (SanitizedError, JSON stderr whitelist logger) + security (HMAC)
- [x] P1.3 platform/config (xsenv, strahana.config.json, zod) + credentials handling
- [x] P1.4 platform/auth (TokenVerifier port, ApiKeyVerifier, apikey:new) + hana/access Principal
- [x] P1.5 platform/mcp (createMcpServer, stdio + Streamable HTTP, /health) + tool catalog stubs + docs:tools + token budget test
- [x] P1.6 mta.yaml + README/docs alignment
Evidence: pnpm build/test/lint green; docs:tools in sync; HTTP+stdio smoke OK; no commits made (CLAUDE.md rule: human commits). Open: mta/cf deploy unverified (no BTP/mbt).
Route: delegated direct, one writer (prep reading of POV §4,8,9,11,12,13,14)

## Phase 2 breakdown (catalog + hana_context)
- [x] P2.1 catalog/domain: model, zod schema, YAML loader port, validation rules (POV §5.3) - schemas/catalog.schema.json + drift test, pnpm catalog:validate, content-derived version
- [x] P2.2 catalog detection (minisearch, synonyms never in response) + context assembly (top-k<=5, <=12 cols, POV §4.2 format) 
- [x] P2.3 context_id signing (HMAC: user, env, catalog version, expiry)
- [x] P2.4 hana/access guards + in-memory rate limit
- [x] P2.5 hana_context handler wired in hana/mcp; docs/tools.md update; synthetic catalog + 30 reference questions, recall >= 90% test; context token budget test
Route: delegated direct, one writer. Commits: manual by the user (CLAUDE.md rule).
Evidence P2 (observed): pnpm build ok; pnpm test 119/119 pass (recall 97/101 = 96.0% on 30 synthetic ES/EN questions; worst context ~430 tokens by bytes/4, budget 800); pnpm lint green (eslint + prettier); pnpm docs:tools -> docs/tools.md unchanged (drift test green); e2e over MCP HTTP: valid key gets context + signed context_id, invalid key / outsider / disallowed environment rejected; audit log has questionHash only.
Open for user: entity-level `rules` field in the catalog (extension, see report); recall misses are synonym gaps (impagas/unpaid/discontinued/cancelados) kept honest in the fixtures. No commits made (CLAUDE.md rule).

## Phase 3 breakdown (query + hana_query) — no real DB tests yet (user decision); commits manual by user
- [x] P3.1 query/domain: SQL policy + validator (POV §6), exhaustive positive/negative tests, fuzzing, column/table resolution vs catalog+context
- [x] P3.2 query/application: hana_query use case (guards, context_id verify, validate, execute via port, pagination, TSV format, notes, maxResponseBytes)
- [x] P3.3 query/infrastructure: @sap/hana-client executor (read-only txn, timeout, schema fixed per env, pool) behind a port; opt-in integration test skipped by default
- [x] P3.4 hana/mcp: wire hana_query, audit (user, env, sql hash, rows, duration, result, bytes), docs/tools.md, token budget tests
- [x] P3.5 docs/README/CLAUDE.md state
Route: delegated direct, one writer.
Evidence P3 (observed, see final run): pnpm install --frozen-lockfile ok (deps pinned: node-sql-parser 5.4.0, @sap/hana-client 2.30.27 with allowBuilds in pnpm-workspace.yaml); pnpm build ok; pnpm test 548 tests / 545 pass / 0 fail / 3 skipped (the opt-in integration tests); validator: 41 positive + 141 negative cases (exact error code each), spike corpus ported (62 allowed accepted, 102 forbidden rejected, 8 gaps: 6 parser gaps still rejected with an actionable hint, TO_VARCHAR/LOCATE now whitelisted), seeded fuzz 20000 mutants (seed 0xC0FFEE) with an independent text oracle, extra seeds up to 60000 iterations explored by hand; fuzz found one real bypass during development (schema-qualified function `S.UPPER(x)`), fixed and covered; pnpm lint green; pnpm docs:tools -> docs/tools.md unchanged (drift test green); e2e over MCP HTTP with an in-memory executor: hana_context -> hana_query happy path, pagination (120 rows, no repeats/skips), invalid context_id, other user's context_id, forbidden SQL, table outside context, DB errors sanitized, response-size cap; typical 50-row x 4-col page ~424 tokens (bytes/4, budget 1500); tools/list budget test unchanged (<= 300).
Open for user / not verified: real HANA Cloud run (SET TRANSACTION READ ONLY acceptance, Statement.setTimeout, rowsAsArray result shape, error codes in hana-error-mapping.ts are from memory of the SAP error-code list), STRAHANA_RO write test (STRAHANA_IT=1), p95 < 3 s. Decisions to confirm: trailing ';' is rejected (spike/POV); limit > maxRows is rejected (POV 6.3 rule 7); added limits.poolSize (default 4) to the config schema; case-insensitive matching for unquoted identifiers, exact match for quoted ones. No commits made (CLAUDE.md rule).

# strahana-mvp

Objective: implement the STRAHANA MVP (docs/00-pov.md) phase by phase (POV §16). Package manager: pnpm (user decision; CLAUDE.md still says npm -> to be aligned in P1).
Scope: POV only. No proposals (docs/proposals) code.

## Tasks
- [x] P0.1 (done: 175/175 tests, 62/62 allowed, 0/102 forbidden slipped; awaiting user approval) Parser spike in spikes/ (~100-query corpus; subset parses, unsupported fails closed). GATE: user approves before P1.
- [ ] P0.2 STRAHANA_RO .hdbrole + HANA connectivity checks (external, needs user/infra) - pending user
- [x] P1 platform/ (config, credentials, errors, logger, API key, MCP stdio+HTTP, MTA) - implemented, uncommitted (CLAUDE.md: commits are manual); 75/75 tests, lint green
- [ ] P2 catalog context + hana_context (recall >= 90%, token budget tests)
- [ ] P3 query context + hana_query (validator tests, execution as STRAHANA_RO)
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

# strahana-mvp

Objective: implement the STRAHANA MVP (docs/00-pov.md) phase by phase (POV §16). Package manager: pnpm (user decision; CLAUDE.md still says npm -> to be aligned in P1).
Scope: POV only. No proposals (docs/proposals) code.

## Tasks
- [x] P0.1 (done: 175/175 tests, 62/62 allowed, 0/102 forbidden slipped; awaiting user approval) Parser spike in spikes/ (~100-query corpus; subset parses, unsupported fails closed). GATE: user approves before P1.
- [ ] P0.2 STRAHANA_RO .hdbrole + HANA connectivity checks (external, needs user/infra) - pending user
- [ ] P1 platform/ (config, credentials, errors, logger, API key, MCP stdio+HTTP, MTA)
- [ ] P2 catalog context + hana_context (recall >= 90%, token budget tests)
- [ ] P3 query context + hana_query (validator tests, execution as STRAHANA_RO)
- [ ] P4 pilot (user-driven)

## Routes
- P0.1: delegated direct (writer; multi-file, prep reading of POV §6)

## Progress / evidence
(none yet)

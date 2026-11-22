Lifecycle: living

# Architecture contract

Inputs: `../data/CONTRACT.md` (bundle v1.0), `../data/ORDER-BUILDING-SPEC.md`, `../../sources.py`, `../../learning.py`, `../../engine.py`.
Job: `MCP.md` documents the implemented read-only `../../mcp_server.py` and `../../tests/test_mcp.py`; other connector, automation and learning-loop designs remain proposed under [ROADMAP-CONNECT](../ROADMAP-CONNECT.md).
Outputs: `CONNECTORS.md`, `AUTOMATION.md`, `LEARNING-LOOP.md`, `MCP.md`; JSON Schemas in `schema/`; mapping examples in `mappings/`; synthetic examples in `examples/`.
Human check: `python3 -B -m pytest -q tests/test_mcp.py` from repo root checks MCP; `python3 scripts/check_docs.py` checks links. Other design examples validate against the schemas (a standard-library validator is planned in P1.1); vendor API details stay marked "verify" until there is evidence. Anything that sends, writes or spends needs owner approval.

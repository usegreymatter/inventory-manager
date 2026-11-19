Lifecycle: proposed

# Architecture contract

Inputs: `../data/CONTRACT.md` (bundle v1.0), `../data/ORDER-BUILDING-SPEC.md`, `../../sources.py`, `../../learning.py`, `../../engine.py`.
Job: design docs for connectors, automation, the learning loop and the MCP server. Nothing here is implemented until a [ROADMAP-CONNECT](../ROADMAP-CONNECT.md) packet ships it.
Outputs: `CONNECTORS.md`, `AUTOMATION.md`, `LEARNING-LOOP.md`, `MCP.md`; JSON Schemas in `schema/`; mapping examples in `mappings/`; synthetic examples in `examples/`.
Human check: examples validate against the schemas (a standard-library validator is planned in P1.1); vendor API details stay marked "verify" until there is evidence. Anything that sends, writes or spends needs owner approval.

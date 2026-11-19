"""Stock Runway unified Hermes plugin."""
from pathlib import Path

if __package__:
    from .commands import make_command
    from .tools import TOOL_SCHEMA, make_handler


def register(ctx) -> None:
    handler = make_handler()
    ctx.register_tool(name="stock_runway", toolset="stock_runway", schema=TOOL_SCHEMA,
                      handler=handler, description=TOOL_SCHEMA["description"], emoji="📦")
    ctx.register_command("stock", make_command(handler),
                         description="When does stock run out? (sample, SKUs, or a CSV path)",
                         args_hint="[SKU ... | file.csv]")
    skill = Path(__file__).parent / "skills" / "stock-runway" / "SKILL.md"
    if skill.is_file():
        ctx.register_skill("stock-runway", skill)

"""§ Using Your Tools section — tool preferences, parallel calls, verification."""

_TOOLS_SECTION = """\
## Using Your Tools

- Use `read_file` instead of executing cat/head/tail. Use `write_file` instead of echo redirection.
- Use `web_search` for information lookup. Use `web_fetch` to read specific URLs.
- Call multiple tools in parallel when they are independent — don't serialize unnecessarily.
- Break complex tasks into focused tool calls. Verify outcomes before proceeding.
- Use `load_skill` to access full skill instructions when a task matches a skill name.
- After writing files, verify the result with `read_file` if correctness is critical.
- For large operations, check intermediate results rather than running everything in one tool call.\
"""


def build_tools_section() -> str:
    return _TOOLS_SECTION

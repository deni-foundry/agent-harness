---
name: mcp-usage
description: "Use when choosing or calling MCP tools — Context7 library docs, Playwright or Chrome DevTools browser automation — or deciding between an MCP server and web search."
targets: ["*"]
---

> Source: agent-harness `core/skills/mcp-usage/SKILL.md`. Edit it there; this copy is generated.

# MCP Server Usage Guidelines

## Configured MCP Servers

> **Servers get enabled and disabled per task**, so treat this as a list of what is *configured*,
> not what is currently reachable. The project's IDE configs (`.mcp.json` for Claude Code,
> `.cursor/mcp.json`, `.kiro/settings/mcp.json`) are generated from the agent-harness servers
> (`core/mcp.jsonc` and each stack's `mcp.jsonc`) plus the project's `.rulesync/mcp.jsonc`, which
> overrides them per server. Personal servers that need your own tokens live in the user-level IDE
> configs instead. The project's own MCP skill lists its servers and IDs. If a call fails because
> a server is unavailable, say so and fall back — don't assume the doc is wrong.

### Context7 - Library Documentation
Use Context7 MCP to fetch up-to-date documentation for libraries and frameworks.

**When to use:**
- Before implementing features with external libraries
- When unsure about API changes or deprecated methods
- When encountering library-specific errors
- When the project's tech rule may be outdated

**How to use:** the prefix in front of each tool name depends on the harness (in Kiro, Context7
may be installed as a Power):
1. Resolve the library ID with Context7's `resolve-library-id` tool
2. Call `query-docs` with the resolved ID and your question

### Web search
Use the built-in web search for anything Context7 doesn't cover: current events, pricing, version
information, specific error messages, community solutions, and libraries Context7 hasn't indexed.

### Playwright MCP
Use for interactive browser automation and E2E test debugging.

**When to use:**
- Debugging E2E test failures interactively
- Exploring page structure with `browser_snapshot`
- Recording user interactions for test generation

**Key tools:**
- `browser_snapshot` - Get accessibility tree (preferred over screenshots)
- `browser_navigate` - Navigate to URLs
- `browser_click`, `browser_type` and the form-filling tool - Interact with elements

Tool names are shown without the harness prefix.

### Chrome DevTools MCP
Alternative browser automation with Chrome-specific features.

**When to use:**
- Performance tracing and analysis
- Network request inspection
- Console message debugging
- When Playwright MCP isn't suitable

## Best Practices

1. **Check Context7 first** for library documentation before web searching
2. **Use browser_snapshot over screenshots** - accessibility trees are more useful for automation
3. **Prefer Playwright MCP** for E2E testing workflows
4. **Check availability by calling, not by reading this file.** A disabled server fails on the first call; that is cheaper than assuming it's off and working around it.

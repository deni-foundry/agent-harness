---
targets: ["*"]
description: "Hosted Supabase (production and staging branches) is read-only without the user's confirmation"
cursor:
  alwaysApply: true
---

> Source: agent-harness `stacks/supabase/rules/supabase-hosted.md`. Edit it there; this copy is generated.

# Hosted Supabase Databases

Treat hosted Supabase (production and any staging branch) as read-only: run writes, DDL,
migrations or deploys there only after the user confirms that action, because both hold shared
data. How to reach them is in the `supabase-mcp` skill; project IDs are in the project's own MCP
skill.

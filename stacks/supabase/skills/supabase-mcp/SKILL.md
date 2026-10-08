---
name: supabase-mcp
description: "Use when calling Supabase MCP tools, local or hosted: which server to use for what, finding the staging branch, and the read-only safety rules for hosted databases."
targets: ["*"]
---

> Source: agent-harness `stacks/supabase/skills/supabase-mcp/SKILL.md`. Edit it there; this copy is generated.

# Supabase MCP

Server names, the local API URL and project IDs are in the project's own MCP skill.

## Local

Use for local Supabase development operations.

**When to use:**
- Database schema changes
- RLS policy management
- Edge function development
- Local development testing

## Hosted

Use for debugging staging/production issues and inspecting remote database state. To find a
staging branch's project_ref, use `list_branches` on the production project ID.

**When to use:**
- Debugging staging issues (auth logs, user state, data inspection)
- Checking edge function deployment status
- Inspecting auth logs for login/signup failures
- Verifying migration state on remote environments

**Safety rules:**
- Only execute **read-only** queries (SELECT) unless the user explicitly asks for a write operation
- Never DROP, DELETE, UPDATE, or INSERT on production without explicit user confirmation
- For staging, read operations are always safe; write operations require user confirmation
- Use the Supabase logs tool (`get_logs` or `query_logs`, depending on the harness and server version) with the `auth` service to debug authentication issues
- Use `execute_sql` for read-only data inspection (user state, lockouts, profiles)

## Best Practices

1. **Use the local server** for database operations during development
2. **Use the hosted server** for debugging staging/production issues — default to the staging branch for debugging

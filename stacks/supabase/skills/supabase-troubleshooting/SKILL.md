---
name: supabase-troubleshooting
description: "Debugging guide for local Supabase problems: the local stack not responding, migration errors, stale generated types, RLS policies that hide or block rows, and Realtime subscriptions that never fire."
targets: ["*"]
---

> Source: agent-harness `stacks/supabase/skills/supabase-troubleshooting/SKILL.md`. Edit it there; this copy is generated.

# Supabase Troubleshooting

## Connection Errors
```bash
# Check if Supabase is running
npx supabase status

# Restart Supabase
npx supabase stop
npx supabase start
```

## Migration Errors
```bash
# Reset database completely
npx supabase db reset

# Check migration status of the local database
npx supabase migration list --local
```

## Stale Generated Types
```bash
# Generate fresh Supabase types
npx supabase gen types typescript --local > <path of the generated types file>
```

## RLS Policy Issues
- Check `auth.uid()` returns expected value
- Verify the user has the membership or role rows the policy checks
- Test policies in Supabase Studio SQL editor

## Real-time Not Working
- Check WebSocket connection in browser DevTools
- Verify RLS allows SELECT on the table
- Ensure channel name matches subscription

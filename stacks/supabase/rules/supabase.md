---
targets: ["*"]
description: "Supabase patterns: local CLI, migrations and grants, Edge Functions, calling functions from Postgres via Vault, RLS, search_path, type generation"
globs: ["**/supabase/**", "**/migrations/**", "**/functions/**", "**/*Supabase*", "**/*supabase*"]
kiro:
  inclusion: fileMatch
  fileMatchPattern: ["**/supabase/**", "**/migrations/**", "**/functions/**", "**/*Supabase*", "**/*supabase*"]
---

> Source: agent-harness `stacks/supabase/rules/supabase.md`. Edit it there; this copy is generated.

# Supabase Patterns

## Local Development

The local Supabase instance runs at the API URL that `npx supabase status` prints (ports are set
in `supabase/config.toml`).

### Common Commands
```bash
# Start local Supabase
npx supabase start

# Stop local Supabase
npx supabase stop

# Reset database (runs migrations + seed)
npx supabase db reset

# Create new migration
npx supabase migration new <name>

# Push migrations to remote
npx supabase db push

# Generate TypeScript types
npx supabase gen types typescript --local > path/to/database.types.ts
```

## Database Migrations

Location: `supabase/migrations/`

### Migration Immutability Rule
**Never modify a migration file that has been pushed to git.** Pushed migrations have already been applied to staging/production databases. To fix a mistake or make a change, always create a new migration file. Only local-only (unpushed) migrations may be edited or squashed.

### Migration Naming
Format: `YYYYMMDDHHMMSS_description.sql`
Example: `20250115120000_add_items_table.sql`

### Migration Template
```sql
-- Migration: Add items table
-- Description: Creates the items table with RLS policies

-- Create table (always use public. prefix for consistency)
CREATE TABLE public.items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Grants — REQUIRED, see "Table Grants" below. Without these the Data API
-- cannot see the table at all and every supabase-js call returns 42501.
GRANT SELECT ON public.items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.items TO service_role;

-- Enable RLS
ALTER TABLE items ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Public can view active items"
ON items FOR SELECT
USING (status = 'active');

CREATE POLICY "Org members can manage own items"
ON items FOR ALL
USING (
  org_id IN (
    SELECT org_id FROM org_members
    WHERE user_id = auth.uid()
  )
);

-- Indexes
CREATE INDEX idx_items_org_id ON items(org_id);
CREATE INDEX idx_items_status ON items(status);

-- Updated_at trigger (assumes a shared update_updated_at_column() trigger function)
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Table Grants

**Every migration that creates a table, view or sequence in `public` must grant on it
explicitly, in the same migration.** Grants are a separate layer from RLS: without a grant
Postgres rejects the query before a policy is ever consulted, and PostgREST answers
`42501 permission denied for table ...`. That applies to `service_role` too — Edge Functions
reach the database through the Data API like everyone else.

```sql
GRANT SELECT ON public.your_table TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.your_table TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.your_table TO service_role;
```

Treat the grants, `ENABLE ROW LEVEL SECURITY` and the policies as one unit — see the
Migration Template above.

Narrow the list when the table is not meant to be public. A table only Edge Functions touch
gets `service_role` alone, and follows the grant with an explicit `REVOKE ALL ... FROM anon, authenticated`
so the intent survives a later bulk grant. Sequences read by a column `DEFAULT nextval(...)`
need `GRANT USAGE, SELECT ON SEQUENCE ... TO authenticated` or the insert fails.

#### Why explicit, when defaults exist

Two `ALTER DEFAULT PRIVILEGES` layers make new `public` tables reachable without a grant, and
neither is something to rely on:

| Layer                            | Set by                        | Status                                                     |
|----------------------------------|-------------------------------|------------------------------------------------------------|
| Supabase platform                | project creation              | Removed on existing projects 2026-10-30                    |
| The project's own, as `postgres` | an early migration (optional) | Safety net only; re-assert it on a schedule if you keep it |

A project-owned layer has to be re-asserted by a scheduled job (a `pg_cron` job calling a
function that re-runs the `ALTER DEFAULT PRIVILEGES`), because a migration alone cannot fix
this: `db push` runs on every merge, so it lands before the 2026-10-30 cutover and would just be
undone by it.

Such a layer covers fresh databases completely — a local `supabase db reset`, CI
integration/E2E jobs and any new Supabase branch run the first migration before a single table
exists, so every table inherits grants. On staging and production the cron re-assert closes the
same gap within a day of any revoke. What neither covers is the window between a revoke and the next
cron tick, and neither makes the access rule visible in the diff where the table is created.

Do not add `GRANT ... ON ALL TABLES IN SCHEMA public` to a migration. It looks like the quick
fix for a table that shipped without grants, and it silently re-exposes every table that
revoked on purpose. Grant the specific table.

Tables in the `private` schema need explicit grants for a different reason — default privileges
only ever applied to `public`. See Private Schema below.

### Private Schema Pattern

Security-sensitive tables live in the `private` schema, accessible only to `service_role`:

```sql
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE TABLE private.rate_limits ( ... );
GRANT ALL ON private.rate_limits TO service_role;
```

`ALTER DEFAULT PRIVILEGES` does NOT cover the `private` schema — every private table needs an explicit `GRANT ALL ... TO service_role`.

### Function Grant Pattern

PostgreSQL grants `EXECUTE` to `PUBLIC` on all functions by default, and Supabase's default privileges for `public` also grant it to `anon` and `authenticated` by name. Revoking only `PUBLIC` leaves the named grants (the function stays callable with the publishable key); revoking only the named roles leaves `PUBLIC`. Name all three. For sensitive functions (e.g., those accessing admin tables), restrict access:

```sql
-- Restrict to service_role only
REVOKE EXECUTE ON FUNCTION public.my_sensitive_function FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_sensitive_function TO service_role;
```

Use this pattern for any function that:
- Accesses admin-only tables
- Performs privileged operations (encryption, key management)
- Should not be callable by `anon` or `authenticated` via PostgREST RPC

Functions intended for client-side RPC need explicit grants to `authenticated` and/or `anon`:

```sql
GRANT EXECUTE ON FUNCTION public.my_search_function TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_search_function TO anon;
```

### RPC Response Mapping

Supabase RPC functions return snake_case field names from PostgreSQL. TypeScript type assertions (`as T`) do NOT transform the data at runtime — they only suppress type errors. Always map snake_case to camelCase explicitly when consuming RPC responses in frontend code:

```typescript
// BAD — type assertion without mapping (camelCase fields will be undefined)
const result = data as unknown as MyInterface;

// GOOD — explicit mapping from snake_case
const raw = data as unknown as { my_field: string };
const result: MyInterface = { myField: raw.my_field };
```

## Edge Functions

Location: `supabase/functions/`. The directory listing is the source of truth for which
functions exist.

Shared code lives in `supabase/functions/_shared/`.

### Function Structure
```
supabase/functions/
├── function-name/
│   ├── index.ts      # Main handler
│   └── deno.json     # Deno config (optional)
```

### Edge Function Template
```typescript
// supabase/functions/my-function/index.ts
import { createServiceRoleClient } from '../_shared/service-role-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createServiceRoleClient();

    const body = await req.json();

    // Your logic here

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

### Service Role Client (Shared Module)

All Edge Functions that need service role access should use one shared factory in `_shared/`
that handles both local (legacy JWT) and hosted (`sb_secret_` format) environments
transparently. The examples call it `createServiceRoleClient()` in
`_shared/service-role-client.ts`; check what the project actually names it (its own Supabase
rule says), and create one if there is none.

```typescript
import { createServiceRoleClient } from '../_shared/service-role-client.ts';
const supabase = createServiceRoleClient();
```

For user-scoped operations (respecting RLS), create a client with the anon key + user's auth header:
```typescript
import { createClient } from 'npm:@supabase/supabase-js@2';
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')!,
  { global: { headers: { Authorization: authHeader } } }
);
```

### Authorizing an internal Edge Function

Functions with `verify_jwt = false` are wide open at the gateway and must authorize
themselves. Pick the guard by counting the legitimate callers, and remember they carry
different credentials that cannot substitute for each other:

| Caller                   | Credential                             | Guard                                     |
|--------------------------|----------------------------------------|-------------------------------------------|
| DB trigger, `pg_cron`    | service role key, from Vault           | service-role-only check                   |
| Logged-in admin, by hand | the admin credential the browser holds | check accepting service role **or** admin |
| Signed-in app user       | their Supabase access token            | user-scoped client, RLS                   |

When a function has both of the first two callers, use one guard that accepts **either** the
service role key or the admin credential and reports which, so the work can be attributed.

**Do not widen a machine-only function.** A function that no admin UI drives stays on the
service-role-only check: adding a credential nothing uses only enlarges the attack surface.

**A browser can never hold the service role key.** It bypasses RLS. So a function an admin
must call directly needs the admin credential path — and the browser has to pass it explicitly,
because `supabase.functions.invoke` defaults `Authorization` to the signed-in user's access
token, or to the publishable key when there is no session:

```typescript
await supabase.functions.invoke('my-function', {
  headers: getAdminAuthHeaders(),
  body: { id },
});
```

Omitting that header is a silent 401 on every call. It is easy to miss when a service-role
check is added to a function whose only caller at the time was a trigger, and the admin path
is overlooked.

### Deno `npm:` Specifiers and Vitest

Edge Functions use Deno's `npm:` import specifier (e.g., `import { createClient } from 'npm:@supabase/supabase-js@2'`). Do NOT use `https://esm.sh/` URLs — they cause transient CDN failures (HTTP 522) during CI deployments.

Vitest (Node.js) cannot resolve `npm:` specifiers natively. When adding or changing an `npm:` import in edge functions, ensure a matching resolve alias exists in `vite.config.ts` → `resolve.alias`. The alias key must equal the specifier exactly, version included (`...@2` does not match `...@2.x.y`), so pin one exact version of each package across every function and alias that spelling:
```typescript
resolve: {
  alias: {
    'npm:@supabase/supabase-js@<version>': '@supabase/supabase-js',
    'npm:standardwebhooks@<version>': 'standardwebhooks',
  },
}
```

### Deploy Edge Function
```bash
# Always pass --use-api so the bundle is built from uploaded source (no Docker
# layer cache). The CLI still skips a slug when the bundle hash matches remote
# (`No change found in Function: <slug>`) — that is not "this git tree is live
# on this project". Make CI fail that case by checking the deploy log.
npx supabase functions deploy function-name --use-api --project-ref <ref>
```

### Response Contracts

When an Edge Function returns data consumed by a frontend service, ensure the response includes all fields the service expects. Document the response shape in a comment above the handler:

```typescript
/** Returns: { accountId, status, chargesEnabled, payoutsEnabled, lastChecked } */
async function handleStatus(...): Promise<Response> { ... }
```

If the frontend service maps `data.someField` and the edge function doesn't return it, the value silently becomes `undefined` → `null`. This causes UI elements to disappear without errors.

### Shared Business Logic

Business logic used by multiple edge functions should live in `supabase/functions/_shared/` to avoid divergent duplicates. If you find the same function copy-pasted across edge functions, extract it to a shared module.

### Edge Function Size Limits

Keep Edge Functions under ~1500 lines. When a function grows beyond this:
- Extract handler groups into a `handlers/` subdirectory within the function folder
- Keep `index.ts` as a thin router (URL matching + dispatch, ~200-300 lines)
- Use a `helpers/` directory for shared utilities (response formatting, audit logging, email)
- Each handler file exports named async functions that accept `(supabase, adminPayload, ...params)` and return `Response`

Supabase Edge Functions can import from local files within the same function directory — use this to keep files focused and navigable.

### Error Logging

All Edge Functions that call external APIs (payment, AI, email or other third-party services) must log the full error details via `console.error` with structured data. Never rely solely on the HTTP response for debugging — Edge Function logs are the primary diagnostic tool for production issues.

**Pattern:**
```typescript
} catch (error) {
  console.error('function-name error:', {
    message: error.message,
    stack: error.stack,
    name: error.name,
  });

  // Return generic message to client — never expose internal error details
  return new Response(
    JSON.stringify({ error: 'User-friendly message here' }),
    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
```

**Rules:**
- Log `{ message, stack, name }` — not the raw error object (which may serialize as `[Object]` in Deno)
- Never expose `error.message` from external APIs in the HTTP response (may contain API keys, internal paths, or sensitive data)
- Use generic user-facing messages: "Internal server error", "Service temporarily unavailable", etc.
- For payment-provider errors: return 502 with "Payment service temporarily unavailable"
- For AI-provider errors: return 502 with "AI service temporarily unavailable"

## Calling Edge Functions from Postgres

Triggers and `pg_cron` jobs reach Edge Functions over `pg_net`. That crosses a boundary
worth understanding before you add or debug one, because it is where whole features get
lost silently.

**Edge Function secrets are invisible to Postgres.** `supabase secrets set` writes
environment variables into the Deno runtime, read with `Deno.env.get(...)`. A trigger is
PL/pgSQL running inside Postgres and has no access to them, so it must supply the project
URL and an auth header from its own side. A third-party API key being set correctly in the
function secrets says nothing about whether the trigger can reach the function that uses it.

**Both values come from Vault**, via two accessors created in a migration (example names):

```sql
private.vault_project_url()       -- Vault secret `project_url`
private.vault_service_role_key()  -- Vault secret `service_role_key`, NULL when unset
```

They are `SECURITY INVOKER` on purpose. `vault.decrypted_secrets` grants SELECT to
`postgres` and `service_role` only, and every caller is a `SECURITY DEFINER` function owned
by `postgres`, so the callers can read the key while `authenticated` cannot. Do not switch
them to `SECURITY DEFINER` — that hands the key to whoever holds EXECUTE.

**Do not use `current_setting('app.*')` for this.** It needs an
`ALTER DATABASE postgres SET ...` step. That step cannot be performed on hosted Supabase:
`postgres` is not a superuser and the statement fails with `42501: permission denied to set
parameter`. It therefore never runs on staging or production, and because call sites typically
treat a missing key as "skip", every feature behind those triggers goes quietly dead while
looking healthy.

### Per-environment setup (manual, once)

Migrations create the accessors; they cannot create the secrets. Run this once per hosted
environment, and after any project restore or new branch:

```sql
SELECT vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
SELECT vault.create_secret('<sb_secret_… key named "default">', 'service_role_key');

-- Only needed if the secrets were created after the migration ran.
SELECT public.setup_my_cron_jobs();  -- each function that schedules a cron job from them
```

Use the **`sb_secret_` key named `default`**, not the legacy `service_role` JWT, when the
function-side guard compares the bearer token to `SUPABASE_SERVICE_ROLE_KEY` verbatim rather
than parsing a JWT: on hosted Supabase with the new API keys that
variable holds the `sb_secret_` value. A non-JWT token on the `Authorization` header is fine
here precisely because every function reached this way runs with `verify_jwt = false`, so the
gateway never tries to parse it — which is also why you must not enable `verify_jwt` on them.

Locally, seed `project_url` from `supabase/seed.sql` but deliberately not
`service_role_key`, since that value differs per machine and a wrong one produces 401s that
look like application bugs — so these paths skip in local dev until you add it by hand.

### Writing a new caller

Read both values through the accessors and treat a NULL key as "skip", so an unconfigured
environment degrades quietly instead of erroring on every write:

```sql
supabase_url := private.vault_project_url();
service_role_key := private.vault_service_role_key();
IF service_role_key IS NULL THEN RETURN NEW; END IF;
```

For `pg_cron`, put the accessor calls **inside** the scheduled command rather than
interpolating their results when scheduling. `cron.job.command` is plain text in a catalog
table, so interpolating stores the key in the clear, and a rotated key then needs
rescheduling rather than just a Vault update.

### Verifying

Verify through a dry-run harness: run the migration plus an invariants SQL script in one
transaction, always rolled back — `pg_net` only dispatches on commit, so nothing leaves the
machine. Assert the fallbacks, the grants, that no cron command contains a key or the
local-stack hostname, and end-to-end that a write to a triggering table queues an
authenticated call at the configured host.

Against a hosted environment, any frequent cron job that calls an Edge Function is a
continuous live probe:

```sql
SELECT status_code, error_msg, count(*)
FROM net._http_response
WHERE created > now() - interval '3 minutes'
GROUP BY 1, 2;
```

- `Couldn't resolve host name` → no `project_url` secret; it fell back to the local host
- `401` → the key does not match what the function sees in `SUPABASE_SERVICE_ROLE_KEY`
- `200` → working

## Real-time Subscriptions

```typescript
// Subscribe to changes
const subscription = supabase
  .channel('messages')
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'messages' },
    (payload) => {
      console.log('New message:', payload.new);
    }
  )
  .subscribe();

// Cleanup — removeChannel unsubscribes and drops the channel from the client
supabase.removeChannel(subscription);
```

## Client-Side Write Boundaries

Frontend services may only write data scoped to the current authenticated user (`auth.uid()`). Any operation that:
- Writes data for OTHER users (notifications, audit logs, status changes on others' records)
- Requires atomicity across multiple tables (e.g., create order + order_items + update inventory)
- Involves fee calculations or financial logic that could be manipulated
- Calls external APIs requiring secret keys (payment, AI or email providers)

MUST go through an Edge Function (either an admin API function for admin operations or a dedicated function for user-initiated privileged actions).

The frontend service acts as a **thin client facade** — it provides a unified API to components but delegates privileged operations to Edge Functions while keeping simple reads direct.

**Pattern:**
```typescript
// ✅ GOOD — read own data directly (RLS-scoped)
const { data } = await supabase.from('orders').select('*').eq('buyer_id', userId);

// ✅ GOOD — write own data directly (RLS-scoped)
await supabase.from('favorites').insert({ user_id: userId, item_id: itemId });

// ✅ GOOD — privileged operation via Edge Function
await supabase.functions.invoke('process-refund', { body: { orderId } });

// ❌ BAD — writing data for another user from the frontend
await supabase.from('notifications').insert({ user_id: otherUserId, ... });

// ❌ BAD — fee calculation client-side (manipulable)
const fee = orderTotal * 0.05; // should be server-side
```

## Row Level Security (RLS) Patterns

### User-owned data
```sql
-- Users can only see their own data
CREATE POLICY "Users can view own account"
ON accounts FOR SELECT
USING (auth.uid() = id);
```

### Org-scoped data
```sql
-- Org members can see org data
CREATE POLICY "Org members can view org items"
ON items FOR SELECT
USING (
  org_id IN (
    SELECT org_id FROM org_members
    WHERE user_id = auth.uid()
  )
);
```

### Public data with auth-gated fields
```sql
-- Anyone can see active and visible archived items
CREATE POLICY "Public can view active items"
ON items FOR SELECT
USING (status IN ('active', 'archived') AND visible = true);
```

## RLS Policy Checklist

When creating or modifying a table's RLS policies, verify:

1. **SELECT**: Scope to `auth.uid()` for user-owned data, or `true` only for genuinely public data (published items, public user pages)
2. **INSERT**: Always include a `WITH CHECK` that validates ownership. Use `TO service_role` for tables that should only be written by Edge Functions (notifications, audit logs, matches)
3. **UPDATE/DELETE**: Always include `USING` clause scoped to `auth.uid()` or org membership
4. **Storage buckets**: INSERT policies must include folder-scoping on the bucket's owning unit — `auth.uid()::text = (storage.foldername(name))[1]` for per-user buckets, an org-membership check on that segment for org-owned ones (a per-user policy on an org-owned bucket locks out every teammate but the uploader)
5. **Service-role-only tables**: Use `TO service_role` explicitly — don't rely on `WITH CHECK (true)` which allows any authenticated user

**Common mistakes:**
- `WITH CHECK (true)` without `TO service_role` → any authenticated user can write
- Missing folder-scoping on storage INSERT → users can upload to other users' folders
- `USING (true)` on UPDATE/DELETE → any user can modify any row

### Multi-Tenant Write Paths

INSERT/UPDATE policies often implicitly assume a user belongs to exactly one tenant (their
active org) or none (registration). A user acting on a tenant that is NOT their active one is
then silently rejected with `42501 new row violates row-level security policy` — for example an
org INSERT policy that only admits users with no org blocks creating a *second* org, and a
member INSERT policy that requires the inserter to already be an admin of that org blocks an
invitee joining *another* org.

When adding a write path where the acting user is not yet an admin/member of the target tenant (creating an additional org, accepting an invitation to join another org, etc.), route it through a **SECURITY DEFINER RPC** that validates server-side and bypasses RLS — rather than loosening the base-table INSERT policy to "any authenticated user." This keeps base-table RLS tight and makes multi-table writes atomic. Inside the function: check `auth.uid()`, re-validate ownership/uniqueness, and fully-qualify all objects with `SET search_path = ''`. Verify any such RPC against the local DB (happy path + rejection paths) before considering it done.

## Every function pins `search_path`

Every `SECURITY DEFINER` function should pin `search_path` at definition
time — `''` where the body fully qualifies everything, `public` or
`public, extensions` where it needs a schema searched. The Supabase security advisor
reports an unpinned one as lint 0011 (`function_search_path_mutable`).

**The trap: a migration's apparent precedent may have been corrected by a later
migration.** An early migration can show a function unpinned while a later migration pinned
it afterwards with `ALTER FUNCTION`. Reading the defining migration and stopping there
reproduces a defect the codebase already fixed.

Check `pg_proc.proconfig` in the live database before copying a function's shape:

```sql
SELECT p.proname, p.proconfig FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public','private') AND p.prosecdef;
```

`search_path = ''` works even for a body resolving `cron.*`, provided every object is fully
qualified (`pg_catalog` is always searched).

## Type Generation

If the project appends hand-written convenience type aliases to the generated types file,
re-append them after every `npx supabase gen types typescript --local > path/to/database.types.ts`.
These are manually maintained and NOT auto-generated:

Use the indexed form, matching what is already at the bottom of the file:

```typescript
// Convenience type aliases for table Row types
/** Row type for the `items` table */
export type Item = Database['public']['Tables']['items']['Row'];
// …same shape for every other table that needs an alias

// Convenience type aliases for enum types
export type ItemStatus = Database['public']['Enums']['item_status'];
```

If such aliases are imported throughout the codebase, missing ones after regeneration break
compilation in many files. Copy the existing block out before regenerating and paste it back after.

> **Encoding:** the committed file is UTF-8 without a BOM, so ordinary edits and
> `str_replace` work normally. If you regenerate with PowerShell `>` redirection you may get
> UTF-16 LE instead, which shows up as a whole-file diff — pipe through
> `Set-Content -Encoding utf8` (or redirect from a shell that defaults to UTF-8) and confirm
> the diff is limited to the schema change before committing.

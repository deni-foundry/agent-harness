---
name: web-troubleshooting
description: "Debugging guide for build, typecheck, test and dev-server failures in a Vite + React + TypeScript project (Vitest, Playwright, Wrangler): stale caches, generated env types that disagree with CI, false green or red test runs, port clashes, hot reload, CORS, runtime hook errors, env vars, slow loads and animation jank."
targets: ["*"]
---

> Source: agent-harness `stacks/react-vite/skills/web-troubleshooting/SKILL.md`. Edit it there; this copy is generated.

# Web Troubleshooting Guide

## Build Errors

### TypeScript Errors
```bash
# Check for type errors
npx tsc --noEmit
```

### Vite Build Failures
```bash
# Clear cache and rebuild
rm -rf node_modules/.vite
npm run build
```

### A `wrangler types` check says the generated env types are out of date, but CI disagrees

`wrangler types` generates the env declaration file from the config `vars`
**plus `.dev.vars`**, and it emits config-only vars first, then the ones
`.dev.vars` overrides. `.dev.vars` is gitignored, so CI has none and generates the
declaration order the committed file carries. Anyone whose `.dev.vars` overrides a var
also declared in the wrangler config gets a different order locally and a red check.

**The committed file is right and CI is the authority. Do not regenerate to make the
local check pass** — that commits your machine's ordering and turns a false local
failure into a real CI one.

To see what CI sees, move `.dev.vars` aside for the run and put it back:

```powershell
$bak='.dev.vars.bak'; Move-Item .dev.vars $bak
try { <the types check command> } finally { Move-Item $bak .dev.vars -Force }
```

Passing any `--env-file` also makes the check pass with `.dev.vars` in place, but why is
not understood — pointing `--env-file` at `.dev.vars` itself still reports up to date —
so do not build that into the gate.

Regenerate **only** when you changed the wrangler config bindings or vars, and then do it
with `.dev.vars` moved aside. Any script that rewrites this file as a side effect has the
same hazard.

### Missing Dependencies
```bash
# Reinstall all dependencies
rm -rf node_modules package-lock.json
npm install
```

## Test Failures

### Vitest Issues
```bash
# Run specific test file
npx vitest run src/lib/feature/Service.test.ts

# Run with verbose output
npx vitest run --reporter=verbose

# Clear test cache
npx vitest run --clearCache
```

**Do not run vitest and Playwright at the same time.** They compete for CPU and
produce failures that are pure contention — tests that pass individually fail in
the combined run, with a different one failing each time. Run the suites
sequentially before believing a red result.

**A test that is slow by design can time out only under full-suite load** — for example a
property test doing real hashing in every iteration. Run it in isolation before treating a
timeout there as real.

### A green run that ran nothing

`vitest` exiting 0 does not mean the suite ran. On Windows/PowerShell two false results are
known:

- A long command line was mangled and a stray path appended to `npx vitest --run`, so
  **one** file ran and exited 0.
- Piping through `Select-Object` closes the pipe early and poisons `$LASTEXITCODE`,
  reporting failure on a passing run.

So never trust the exit code alone — assert the counts. Know roughly how many files and tests
the full suite has. A suite count in the single or low double digits means the
invocation was truncated, not that the suite shrank. Redirect output to a file, read
`$LASTEXITCODE`, and check the count before reporting a pass.

The same caution applies to code search: a file filter that is a bare path
(e.g. `src/locales/en.json`) can silently match nothing, which is
indistinguishable from a real "no matches". Use a recursive glob (`**/locales/**`) or
read the file directly. Never conclude something is absent from a single empty grep.

### Playwright E2E Issues
```bash
# Run with visible browser
npx playwright test --headed

# Run specific test
npx playwright test auth.spec.ts

# Debug mode
npx playwright test --debug

# Update snapshots
npx playwright test --update-snapshots
```

## Development Server

### Port Already in Use
```bash
# Find process using port
netstat -ano | findstr :5173

# Kill process (Windows)
taskkill /PID <pid> /F
```

### Hot Reload Not Working
- Check for syntax errors in recently edited files
- Restart dev server: `npm run dev`
- Clear Vite cache: `rm -rf node_modules/.vite`

### CORS Errors
- Verify the API URL (e.g. the Supabase URL) in `.env.local`
- Check the server or Edge Function CORS headers
- Ensure API requests use correct origin

## Common Runtime Errors

### "Cannot read property of undefined"
- Check if data is loaded before accessing
- Add optional chaining: `user?.email`
- Verify API response structure

### "Invalid hook call"
- Hooks must be called at top level of component
- Don't call hooks inside conditions or loops
- Check for multiple React versions

### Animation Jank
- Respect the app's motion gate (reduced motion and any user setting)
- Prefer `transform` and `opacity` over layout properties
- Use `tween` instead of `spring` for predictable timing
- Add a modifier class that disables CSS transitions on an element Framer Motion animates

## Environment Variables

Local config lives in an env file such as **`.env.local`** (check which one the project uses):
```
VITE_SUPABASE_URL=<local API URL from `npx supabase status`>
VITE_SUPABASE_PUBLISHABLE_KEY=<your-publishable-key>
```

### Missing Environment Variables
- Copy the example env file (e.g. `.env.local.example`) to `.env.local`
- Get keys from `npx supabase status`
- Restart dev server after changes

## Performance Issues

### Slow Initial Load
- Check bundle size: `npm run build`
- Verify lazy loading is working
- Check for large dependencies

### Memory Leaks
- Clean up subscriptions in `useEffect` return
- Unsubscribe from realtime (e.g. Supabase) channels
- Cancel pending requests on unmount

### Slow Animations
- Use `transform` and `opacity` only
- Avoid animating `width`, `height`, `top`, `left`
- Check `prefers-reduced-motion` is respected

---
targets: ["*"]
description: "Playwright E2E testing: checkpoint verification, assertion rules, debugging, service-worker and lazy-route stalls, Radix controls, Mailpit email tests, env-flag test seams, page objects"
globs: ["**/*.spec.ts", "**/e2e/**", "**/playwright*"]
kiro:
  inclusion: fileMatch
  fileMatchPattern: ["**/*.spec.ts", "**/e2e/**", "**/playwright*"]
---

> Source: agent-harness `stacks/playwright/rules/playwright-e2e.md`. Edit it there; this copy is generated.

# E2E Testing Guidelines (Playwright)

## Core Principles

Never simplify, skip or mask a failing test — see the `testing-discipline` rule.

1. **Always verify against spec requirements** - Before modifying any test, check the original spec requirements (where the project keeps its specs) to understand the intended behavior.

2. **Ask when uncertain** - If the expected outcome is not obvious after checking the spec, ask the user for clarification rather than making assumptions.

3. **Visual verification matters** - If UI elements appear empty or broken, this is likely an application bug, not a test issue. Report it rather than working around it.

## Checkpoint Verification Strategy

When reaching checkpoint tasks in a spec or task list (e.g., "Ensure all tests pass"), **DO NOT just ask the user to manually verify**. Instead, run automated tests:

### Checkpoint Verification Order

1. **Run unit/property tests first** - Execute `npx vitest run` for the relevant service/component tests
2. **Run E2E tests for UI checkpoints** - Execute `npx playwright test {feature}.spec.ts` for UI-related checkpoints
3. **Use Playwright MCP for exploratory verification** - When no E2E tests exist, use the Playwright MCP navigate and snapshot tools to verify UI state
4. **Only ask user for manual verification** when:
   - Tests don't exist and can't be quickly written
   - The checkpoint requires subjective judgment (e.g., "looks good visually")
   - External integrations need verification (e.g., payment webhooks)

### Checkpoint Types and Actions

| Checkpoint Type               | Action                                         |
|-------------------------------|------------------------------------------------|
| "Ensure all tests pass"       | Run `npx vitest run` and `npx playwright test` |
| "Verify UI renders correctly" | Run E2E tests OR use Playwright MCP to inspect |
| "Verify navigation works"     | Run E2E navigation tests                       |
| "Verify RLS policies work"    | Run integration tests against Supabase         |
| "Ask user if questions arise" | Only ask if tests reveal ambiguous behavior    |

### Writing E2E Tests for Checkpoints

If a checkpoint doesn't have corresponding E2E tests, consider writing them:

```typescript
// e2e/{feature}.spec.ts
test.describe('Feature Checkpoint', () => {
  test('should render main page correctly', async ({ page }) => {
    await page.goto('/feature');
    await expect(page.getByRole('heading', { name: /feature title/i })).toBeVisible();
  });
  
  test('should navigate between sections', async ({ page }) => {
    await page.goto('/feature');
    await page.getByRole('link', { name: /section/i }).click();
    await expect(page).toHaveURL(/\/feature\/section/);
  });
});
```

### Exploratory Testing with Playwright MCP

When E2E tests don't exist, use Playwright MCP tools to verify:

```
1. The Playwright MCP navigate tool to the page
2. The Playwright MCP snapshot tool to inspect the DOM
3. The Playwright MCP click tool to test interactions
4. Report findings to user with specific observations
```

## Email Testing with Mailpit

Local emails are captured by **Mailpit** (with local Supabase, configured under `[local_smtp]` in
`supabase/config.toml`). A fixture helper that talks to Mailpit's REST API should provide:

```typescript
import { waitForEmail, extractConfirmationLink, clearMailbox } from './fixtures/mailpit';

// Wait for a confirmation email
const { body } = await waitForEmail('test@test.com', { subjectContains: 'Confirm' });
const link = extractConfirmationLink(body);

// Clean up
await clearMailbox('test@test.com');
```

> The helper reads the base URL from `MAILPIT_URL`, falls back to `INBUCKET_URL`, then defaults to
> the local Mailpit address. CI passes `MAILPIT_URL`, resolved from `supabase status --output json`
> as `.MAILPIT_URL // .INBUCKET_URL` — both keys are read at each step, so either one works.

Use this for tests that register fresh users (email confirmation is enabled in local Supabase).
Users inserted by the seed with `email_confirmed_at = NOW()` bypass this.

Cover the registration → confirmation email → login round-trip with a dedicated spec, and mock any
external lookup on the registration path so the test reaches the standard email-confirmation path.

## E2E Test Seams (`VITE_E2E`)

Some production components can't be driven by Playwright. When the app is built
or served with `VITE_E2E=true`, those components expose a test-friendly seam.
This flag is set by the CI e2e build and by the local Playwright dev server
(`webServer.env` in `playwright.config.ts`); it is never set in normal dev or
production builds.

When adding a new seam, gate it strictly on `import.meta.env.VITE_E2E === 'true'`
so production behaviour is unaffected, and document it in the project's table of seams.

## Test Assertion Rules

### No Silent Guards

Do NOT wrap test logic in `if` guards that silently pass when the condition is false:

```typescript
// BAD — passes without testing anything if no items
const hasItems = await listPage.hasItems();
if (hasItems) {
  await listPage.clickItem(0);
  await expect(page).toHaveURL(/\/items\//);
}

// GOOD — fails loudly if seed data is missing
expect(await listPage.hasItems()).toBe(true);
await listPage.clickItem(0);
await expect(page).toHaveURL(/\/items\//);

// GOOD — skips with a clear reason when precondition isn't met
const count = await listPage.getItemCount();
test.skip(count < 30, 'Not enough items for pagination test');
```

Use `test.skip()` with a message for tests that need specific preconditions (e.g., enough items for pagination). Use assertions for conditions that should always be true with seed data.

## Debugging E2E Test Failures

When tests fail (see the `testing-discipline` rule for the "investigate, don't mask" stance):

1. **Check the spec first** - Read the feature's requirements in the project's specs for the intended behavior
2. **Take screenshots** - See what the page actually rendered
3. **Inspect the DOM** - Use the Playwright MCP snapshot tool for the actual DOM state
4. **Check test data ownership** - For interaction tests (follow/unfollow, bookmark, etc.), verify the item isn't owned by the logged-in user

## Service Worker & Lazy-Route Navigation

- **Block service workers in functional tests** (`serviceWorkers: 'block'` in
  `playwright.config.ts`). Functional E2E tests do not exercise
  offline/PWA behaviour. A freshly-registered Workbox SW can intercept lazy
  route chunks and stall the first client-side navigation in a fresh context.
- **Lazy-route SPA navigation cold-chunk stall:** On the FIRST client-side
  (sidebar/link) navigation to a `React.lazy` route in a fresh, uncached
  context, resolving the chunk inside a React transition can occasionally stall
  under headless Chromium — the previous page stays mounted and the chunk never
  commits. Real browsers (with an HTTP cache) render in <500ms, so this is a
  headless-only test artifact, not a product bug. Mitigations:
  - For "direct URL access" style tests, use `page.goto('/route')` (full load).
  - For navigation helpers that must click a link, click, then fall back to
    `page.goto()` if the content doesn't render within a few seconds.

## Interacting with Radix Form Controls

Radix primitives (Checkbox, Select, Switch, RadioGroup) render a real interactive
element (`button[role="checkbox"]`, `[role="combobox"]`, `[role="switch"]`, etc.)
plus a **hidden native proxy** `<input>` that is `aria-hidden` with
`pointer-events: none`. Target the role-based element, never the proxy input —
mouse clicks (even `{ force: true }`) on the proxy do nothing, so the control
never toggles and the failure is silent (form validation blocks submit).

```typescript
// ❌ clicks the hidden pointer-events:none proxy — no-op
page.locator('input[type="checkbox"]').click({ force: true });

// ✅ target the Radix control and confirm it toggled
const checkbox = page.locator('button[role="checkbox"]');
await checkbox.click();
await expect(checkbox).toHaveAttribute('aria-checked', 'true');
```

Assert `aria-checked` / `data-state` to confirm the toggle before submitting.

## Page Object Pattern

- Page objects should use function-style locators: `titleInput()` not `titleInput`
- Locators should match actual DOM structure, not assumed structure
- Update page objects when the application UI changes

## Common Issues

### Responsive Duplicate Elements

Many components render both mobile and desktop versions (e.g., mobile CTA bar + desktop sidebar). Selectors like `.btn-primary-cta` or `.item-price` may match both, causing Playwright strict mode violations.

**Fix:** Scope selectors to the visible container:
```typescript
// BAD — matches mobile (hidden) + desktop (visible)
await expect(page.locator('.btn-primary-cta')).toBeVisible();

// GOOD — scope to the desktop container
await expect(page.locator('.detail-actions .btn-primary-cta')).toBeVisible();

// GOOD — use .first() or .last() when order is predictable
await expect(page.locator('.item-price').last()).toBeVisible();
```

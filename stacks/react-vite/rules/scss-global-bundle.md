---
targets: ["*"]
description: "SCSS compiled into one global stylesheet: @use imports, selector scoping, select controls in forms, layout awareness when adding UI elements, no layout shift from loading states"
globs: ["**/*.scss"]
kiro:
  inclusion: fileMatch
  fileMatchPattern: ["**/*.scss"]
---

> Source: agent-harness `stacks/react-vite/rules/scss-global-bundle.md`. Edit it there; this copy is generated.

# SCSS Global Bundle

## SCSS Import Pattern

Every SCSS file that uses a `$variable` must `@use` the variables module first — Sass modules
are not global, so a missing import is a build error rather than a silent fallback. The path
depends on where the file sits:

```scss
// a partial next to the variables module's folder  (the usual case)
@use '../variables' as *;

// a component-local stylesheet further away
@use '../../styles/variables' as *;
```

A partial that also uses tokens from a second module (for example a separate admin token set)
must `@use` that module as well.

## Selector Scoping — partials are global

Every partial is compiled into one stylesheet via the single entry stylesheet, so there is no
per-component encapsulation. A selector at the top level of a partial applies to
the whole app, including surfaces that partial has nothing to do with.

**Never** write these at the top level of a component partial:
- bare element selectors — `table { ... }`, `input { ... }`, `ul { ... }`
- substring attribute selectors — `[class*='__table']`, `[class*='card']`

Scope them to the component root instead:

```scss
// GOOD — scoped to the surface that needs it
@media (max-width: 767px) {
  .reports-layout {
    [class*='__table'] { min-width: 640px; }
    table { min-width: 560px; }
  }
}
```

Scope first, because an unscoped table rule in one section's partial reaches every other page too and can break its layout on mobile. Genuinely global rules belong in the base stylesheet, deliberately and in one place.

## Select Dropdowns

- **Forms with react-hook-form**: Use native `<select>` — works directly with `{...register('field')}`, no wrapper needed
- **Standalone filters/controls**: Use Radix `Select` + `SelectItem` from the project's UI wrapper — better styling and accessibility
- Reason: Radix Select uses `onValueChange` (not native form events), requiring `Controller` to integrate with react-hook-form. Native `<select>` is simpler for forms.

## Adding UI Elements — Layout Awareness

Before adding any new UI element (banner, notice, badge, section), you MUST:

1. **Read the parent layout** — Check the SCSS of the parent container. Is it `display: flex`, `grid`, or `block`? A `flex-direction: row` parent will place your element side-by-side, not below.
2. **Check two-column form rows** — a row that is a two-column **grid** (`display: grid; grid-template-columns: 1fr 1fr`). Anything you put inside becomes a grid cell, so a full-width banner or notice ends up half-width beside the next field. Place them before or after the row, never inside.
3. **Use standalone classes** — New UI elements get their own class (e.g., `.form-notice`), not a modifier on an existing utility class (e.g., don't do `.hint-text.my-notice`).
4. **Full-width elements** — Banners, notices, and info bars should be direct children of the step/section container, not nested inside `.form-group` or `.form-row`.
5. **Test both themes** — Verify the element looks correct in both light and dark mode. Use `var(--color-*)` tokens, never hardcode hex values or `rgba()` with literal RGB values. Use `rgba(var(--color-*-rgb), opacity)` for transparent variants.
6. **Responsive check** — If the parent has `@include mobile` breakpoints, verify the new element doesn't break on small screens.

### Prevent Layout Shift from Loading States

Controls that appear after data loads (pagination, sort dropdowns, filter bars) must render immediately with their full dimensions. Disable interactive elements while loading rather than hiding them entirely. This prevents content from shifting down when controls appear.

```tsx
// ✅ GOOD — always rendered, disabled while loading
<Pagination disabled={isLoading} ... />

// ❌ BAD — hidden during load, causes layout shift when it appears
{!isLoading && <Pagination ... />}
```

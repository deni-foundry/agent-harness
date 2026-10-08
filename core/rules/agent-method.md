---
targets: ["*"]
description: "How the agent works in any project: evidence, proposing before implementing, layered enforcement, API versions, table formatting"
cursor:
  alwaysApply: true
---

> Source: agent-harness `core/rules/agent-method.md`. Edit it there; this copy is generated.

# Agent Method

## Evidence Discipline

Findings come in two kinds, and conflating them is how a confident report turns out to be wrong.

**Direct** — the file contains, or does not contain, the thing claimed. One read settles it. State these plainly.

**Inferred** — any claim about behaviour, wiring, storage, lifecycle or usage that you reached from a name, a heading, a declaration, or a search hit. A name is evidence about the name, not about what the code does. Before reporting one, open the place where the behaviour actually happens: the call site, the consumer, the runtime path.

Verify inferred findings **before presenting them**, not before acting on them. The trigger is "I am about to ask the user to decide something", not "I am about to edit a file". Verification is usually a single file read; an unverified finding that reaches the user has already cost them a decision by the time it turns out to be wrong.

**Absence is the weakest evidence there is.** One empty search, one doc page that
does not mention a thing, or one example that lacks it does not establish that the
thing does not exist — only that the source you checked did not cover it. Before
claiming a feature, rule or file is absent, check a second independent source and
say which two you checked. A confident "this isn't a thing" is the easiest way to
send the user down a wrong path.

## Propose Before Implementing

When a user request is ambiguous, open-ended, or could be solved in multiple reasonable ways, **do not jump straight to implementation**. Instead:

1. Briefly explain the current state or problem
2. Propose 2-4 concrete options with trade-offs
3. Wait for the user to choose before writing code

### When to propose first
- The request describes a problem but not a specific solution
- There are multiple valid approaches with different trade-offs
- The change involves new UI patterns, workflows, or data models
- The request is phrased as a question ("how does X work?", "I don't see a way to...")

### When it's fine to implement directly
- The request is a clear-cut bug fix with an obvious solution
- The user explicitly says "fix this" or "do X"
- The change is mechanical (rename, move, update import, swap component)
- The user already chose an approach in a previous message

### Examples

**Propose first:**
- "I don't see a way to add notes" → Propose options for how notes could work
- "The search feels slow" → Propose debounce, pagination, or caching approaches
- "We need better error handling here" → Propose a toast vs an inline error vs an error page

**Implement directly:**
- "Replace the native select with our Radix Select component" → Do it
- "Fix the TypeScript error on line 42" → Do it
- "The save button doesn't persist, wire it up to the API" → Do it

## Layered Enforcement — Update Every Layer

Access control and read-only/state guards are usually enforced in several layers at once. Before changing what an action is allowed to do, enumerate every layer that enforces the current rule and update all of them together. Changing one layer either silently fails (another layer still blocks the operation) or leaves a hole (a layer still permits it).

Typical layers: client component and service guards, client-side request or mutation interceptors, database policies (row-level security, permissive and restrictive) and privileged database functions, and server-side code running with elevated credentials, which bypasses those policies entirely. A project's own rules list its layers.

Typecheck and unit tests do NOT catch a missed layer; a policy or client-proxy block only surfaces when the flow runs. When you cannot run the affected flow end-to-end, trace each layer in code and state which ones you verified.

## External API Version Verification

When writing code that calls external APIs (Notion, Stripe, OpenAI, etc.), always verify the latest API version and check for breaking changes before implementation. Use web search to confirm the current API contract.

## Markdown Table Formatting

When writing markdown tables (in docs, rule files, or any `.md` file), **always pad columns to equal width** so they are readable in source view — not just rendered view. Align the pipe characters vertically.

**Good:**
```markdown
| Event              | Type           | Recipient | Status       |
|--------------------|----------------|-----------|--------------|
| Invoice paid       | `payment_ok`   | Customer  | ⚠️ No email |
| Order shipped      | `order_sent`   | Customer  | ✅ Working  |
```

**Bad:**
```markdown
| Event | Type | Recipient | Status |
|-------|------|-----------|--------|
| Invoice paid | `payment_ok` | Customer | ⚠️ No email |
| Order shipped | `order_sent` | Customer | ✅ Working |
```

Use spaces to pad each cell so all `|` characters in a column line up. This applies to all documentation, rule files, and markdown output.

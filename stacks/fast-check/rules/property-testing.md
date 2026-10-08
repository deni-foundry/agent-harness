---
targets: ["*"]
description: "Property-based testing with fast-check: triaging counter-examples, generator and property issues, cleanup in finally blocks, iteration counts, test quality"
globs: ["**/*.property.test.ts", "**/fast-check*"]
kiro:
  inclusion: fileMatch
  fileMatchPattern: ["**/*.property.test.ts", "**/fast-check*"]
---

> Source: agent-harness `stacks/fast-check/rules/property-testing.md`. Edit it there; this copy is generated.

# Property-Based Testing Guidelines

## Core Principles

1. **Tests may reveal bugs in code** - Do not assume the implementation is always correct. Property tests are designed to find edge cases and bugs.

2. **Analyze failures before moving on** - When a property test fails, determine the root cause:
   - Is the implementation wrong?
   - Is the test wrong (incorrect property, bad generator, invalid assumptions)?
   - Is the specification unclear?

3. **Fix obvious issues immediately** - If it's clear which one is wrong (test or implementation), fix it and continue.

4. **Ask for clarification when uncertain** - If you're not sure whether the test or implementation should change, temporarily move on but clearly document the issue in your summary so the user can provide feedback.

## Triaging Counter-Examples

When a property test fails, you get a counter-example. Follow this triage process:

### Step 1: Understand the Counter-Example
- What input caused the failure?
- What was the expected behavior?
- What was the actual behavior?

### Step 2: Determine the Cause

**Option A: The test is incorrect**
- The property doesn't accurately reflect the requirement
- The generator produces invalid inputs (e.g., dates where `endedAt` is before `startedAt`)
- The test has incorrect assumptions about the domain

**Option B: The implementation has a bug**
- The counter-example reveals a real bug in the code
- Fix the implementation, not the test

**Option C: The specification is unclear**
- The acceptance criteria are ambiguous
- The property could be interpreted multiple ways
- Ask the user for clarification before changing anything

### Step 3: Take Action

| Cause              | Action                                            |
|--------------------|---------------------------------------------------|
| Test incorrect     | Fix the test (generator, property, or assertions) |
| Implementation bug | Fix the implementation                            |
| Unclear spec       | Document in summary, ask user for clarification   |

## Common Test Issues

### Generator Issues
- **Invalid data combinations**: Ensure generators produce valid domain objects (e.g., `endedAt` must be after `startedAt`)
- **Missing edge cases**: Generators should cover edge cases like empty strings, zero values, boundary conditions
- **Overly broad generators**: Filter out invalid inputs that don't make sense for the domain

### Property Issues
- **Incorrect invariants**: The property may not accurately reflect the business rule
- **Missing preconditions**: Some properties only hold under certain conditions
- **Floating point precision**: Use appropriate tolerances (e.g., `Math.abs(a - b) < 0.01`)

### Example: Fixing a Generator

```typescript
// BAD: endedAt can be before startedAt
const sessionArbitrary = fc.record({
  startedAt: fc.date().map(d => d.toISOString()),
  endedAt: fc.option(fc.date().map(d => d.toISOString()), { nil: null }),
});

// GOOD: endedAt is always after startedAt when present
const sessionArbitrary = fc.record({
  reason: fc.option(fc.string(), { nil: null }),
}).chain(base => 
  fc.date({ min: new Date('2020-01-01'), max: new Date('2025-01-01') }).chain(startDate =>
    fc.option(
      fc.integer({ min: 1, max: 86400 * 30 }).map(seconds => 
        new Date(startDate.getTime() + seconds * 1000).toISOString()
      ),
      { nil: null }
    ).map(endedAt => ({
      ...base,
      startedAt: startDate.toISOString(),
      endedAt,
    }))
  )
);
```

## Test Cleanup with Finally Blocks

Property tests that modify global state (localStorage, singletons, mocks) MUST clean up in a `finally` block to prevent test pollution:

```typescript
it('should handle state changes', () => {
  fc.assert(
    fc.property(fc.string(), (value) => {
      // Save original state
      const originalValue = localStorage.getItem('key');
      
      try {
        // Test logic that modifies state
        localStorage.setItem('key', value);
        // ... assertions
        return true;
      } finally {
        // ALWAYS restore original state, even if test fails
        if (originalValue === null) {
          localStorage.removeItem('key');
        } else {
          localStorage.setItem('key', originalValue);
        }
      }
    }),
    { numRuns: 100 }
  );
});
```

### Why Finally Blocks Matter

- Property tests run many iterations (100+) with different inputs
- If one iteration fails mid-test, cleanup code after assertions won't run
- `finally` blocks execute regardless of test success/failure
- Prevents state leakage between iterations and between tests

### Common Cleanup Scenarios

| State Modified  | Cleanup Pattern                       |
|-----------------|---------------------------------------|
| localStorage    | Save original, restore in finally     |
| Singleton state | Reset to initial state in finally     |
| Mocks/spies     | Restore original functions in finally |
| URL/history     | Reset location in finally             |

## Running Property Tests

```bash
# Run specific property test file
npx vitest run src/lib/feature/Service.property.test.ts

# Run with verbose output
npx vitest run src/lib/feature/Service.property.test.ts --reporter=verbose
```

## Test Configuration

- Minimum 100 iterations per property test (due to randomization)
- Use `{ numRuns: 100 }` in `fc.assert()` options
- When the project uses specs, tag each test with the property it validates: `**Validates: Requirements X.Y**`

### Exception: component/hook-mount property tests

Property tests that render a React component or hook **inside the property** (or
collect generated cases and then mount per case) are exempt from the 100-minimum.
Each iteration mounts the component, runs async `userEvent` interactions, and waits
for effects — so 100 iterations is prohibitively slow and can surface render/async
flakiness unrelated to the property. Use a smaller count (e.g. 3–50) for these and
keep the full 100 for pure-logic property tests. Network-bound integration property
tests (e.g. `*.integration.test.ts`) are likewise kept low (2–5) by design.

## Never Skip Failing Tests

Do not mark property tests as skipped or expected failures — see the `testing-discipline` rule.

## Property Test Quality

When creating property tests, every tested function must be imported from the actual source module — not re-implemented or fully mocked in the test. If a test file mocks the entire module it's supposed to test, it has no value.

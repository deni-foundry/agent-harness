---
targets: ["*"]
description: "React SPA loading and feedback states: auth/chunk/data loading layers, skeletons, hover prefetching, TanStack Query caching and invalidation, navigation state, global toasts, loading vs not-found ordering, error-message hygiene"
globs: ["**/lib/query/**", "**/App.tsx", "**/hooks/use*Query.ts", "**/*Skeleton*", "**/ErrorBoundary*", "**/*NotFound*"]
kiro:
  inclusion: fileMatch
  fileMatchPattern: ["**/lib/query/**", "**/App.tsx", "**/hooks/use*Query.ts", "**/*Skeleton*", "**/ErrorBoundary*", "**/*NotFound*"]
---

> Source: agent-harness `stacks/react-vite/rules/react-loading-and-caching.md`. Edit it there; this copy is generated.

# Loading & Caching

How this app decides what to show while data and code are in flight, and how long cached
data stays fresh. Reference material — read the section you need rather than the whole file.

## Lazy Loading & Route Prefetching

Pages are lazy-loaded using React's `lazy()` and `Suspense` to reduce initial bundle size.

### Loading State Layers

The app has three distinct loading layers, each with its own strategy:

#### 1. Auth Loading (Session Verification)
**When:** Initial app load, checking if user is logged in
**Strategy:** Optimistic rendering with session hints

A session hint is a synchronous check for the auth client's persisted session token in
localStorage. Because it is synchronous it can be used during the first render, before the async
auth check resolves: the layout picks its shell from the hint while auth loads, and the route
guard consults it too so a logged-in user isn't bounced to the login page on a cold start. The
effect is no layout flash on navigation for logged-in users.

#### 2. Code Chunk Loading (Lazy Components)
**When:** Navigating to a lazy-loaded page for the first time
**Strategy:** A skeleton shaped like the page it is replacing

Wrap each lazy page in a thin `Suspense` wrapper that renders the chosen skeleton
unconditionally — no connection sniffing and no delay:

```tsx
<LazyRoute skeleton="form">
  <ProfilePage />
</LazyRoute>
```

Hover prefetching is what usually makes the fallback invisible, not any timing trick: by the time
you click, the chunk is generally cached.

#### 3. Data Loading (TanStack Query)
**When:** Fetching data from the backend after component mounts
**Strategy:** Prefetching + cache-first rendering

- Data prefetched on hover (before navigation)
- If cached data exists → render immediately, no skeleton
- If no cache → component shows its own loading state
- `staleTime` determines when to background refetch

**Eliminating Data Skeletons:**
1. Export `fetchXxxData` from query hook
2. Add it to the route → data-prefetch map that hover prefetching reads
3. Page reads from cache on mount → instant render

```tsx
// In page component - data already in cache from prefetch
const { data, isLoading } = useMembersQuery(orgId);
// isLoading is false if prefetched!
```

### How They Work Together

```
User hovers link → Prefetch code chunk + data
User clicks → 
  1. Auth check (instant with session hint)
  2. Code chunk (instant if prefetched, else skeleton)
  3. Data (instant if prefetched, else component loading state)
```

**Best case (prefetched):** All three layers instant → no loading states
**Worst case (cold start):** Auth blank → Code skeleton → Data loading

### Best Practices
1. **Don't prefetch everything** - Only prefetch likely navigation targets
2. **Use hover + focus** - Cover both mouse and keyboard users
3. **Match skeleton to layout** - Use the skeleton type that matches the page's shape, so the swap to real content is not a visible jump
4. **Match prefetch staleTime to the hook's staleTime** - otherwise the prefetch lands stale and the page refetches anyway

### Avoiding Double Skeletons

Pages that are lazy-loaded AND fetch data on mount have two loading phases:
1. Chunk loading (React.lazy Suspense boundary)
2. Data loading (TanStack Query isLoading)

To avoid a jarring double-skeleton flash:
- Use a Suspense fallback that matches the page's layout type (FormPageSkeleton, ListPageSkeleton, DetailPageSkeleton, etc.)
- Inside the component, use a crossfade component for the data-loading → content transition
- The generic skeleton (Suspense) and the component's own skeleton should be visually similar enough that the transition is seamless
- Hover prefetching ensures the chunk is usually cached, making the Suspense fallback invisible on most navigations

### Navigation State (`location.state`)

When navigating to a page with state (e.g., `navigate('/messages', { state: { conversationId } })`), read the state directly in `useState` initialization — not in a `useEffect`. Effects can race with other effects that depend on the same state.

```tsx
// GOOD — state is available on first render, no race condition
const initialState = location.state as { conversationId?: string } | null;
const [activeId, setActiveId] = useState<string | null>(initialState?.conversationId || null);

// BAD — effect may run after other effects that override the state
useEffect(() => {
  if (location.state?.conversationId) {
    setActiveId(location.state.conversationId); // may be too late
  }
}, [location.state]);
```

## Data Caching & Prefetching

TanStack Query handles server state caching. Data is prefetched on hover alongside code chunks.

### Cache Invalidation

Use a query-key factory for targeted invalidation:
```typescript
// Invalidate all orders
queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });

// Invalidate specific order
queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(orderId) });

// Invalidate member data after mutation
queryClient.invalidateQueries({ queryKey: queryKeys.members.list(orgId) });
```

### Real-time Updates

For data that needs real-time sync (e.g., team changes by other users), consider:
- Realtime subscriptions from the backend (e.g. Supabase Realtime)
- Shorter staleTime + refetchOnWindowFocus
- Manual refetch on specific user actions

## Feedback States

### Raising a toast from non-React code

A `useState`-per-page toast only works inside a component. Services, the `MutationCache`
interceptor and API-client wrappers have no React context, so they use a global emitter
instead:

```ts
emitToast(message, 'error'); // a small module-level emitter; type defaults to 'error'
```

A renderer component is mounted near the app root and subscribes to the emitter, so the
toast appears without the caller knowing anything about the UI. Reach for this whenever the
code that detects the problem is not the component that should display it — don't thread a
callback down.

### Critical: Loading vs Not-Found ordering

**The order of checks matters.** Detail pages that fetch data must follow this exact sequence to avoid a "not found" flash during loading or when navigating back:

```tsx
// 1. Error — show NotFoundPage
if (error) {
  return <NotFoundPage />;
}

// 2. No data AND not loading — genuinely not found
if (id && !data && !isLoading) {
  return <NotFoundPage />;
}

// 3. No data (still loading) — show skeleton
if (!data) {
  return <DetailSkeleton />;
}

// 4. Data available — render content
return <DetailContent data={data} />;
```

**NEVER** combine error and missing-data into a single check like `if (error || !data)` — this causes a flash of the not-found page while data is still loading (e.g., when navigating back from a detail page to a list and the query cache is stale).

### Error Messages

1. **Don't show technical error messages** to users - use generic, friendly messages
2. **Sanitize external API errors** before setting error state in hooks. Errors from Stripe, Supabase, OpenAI, etc. may contain API keys, account IDs, or technical details. Use one shared sanitizer (message + fallback) — the same one the query-error component calls; a vendor-specific wrapper is not the general helper.

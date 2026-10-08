---
targets: ["*"]
description: "Framer Motion animation: purpose and spatial model, interruptibility, common patterns, timing, ambient animation, CSS vs Framer Motion, re-triggerable CSS animations"
globs: ["**/motion/**", "**/*animation*", "**/*Animation*", "**/*Transition*"]
kiro:
  inclusion: fileMatch
  fileMatchPattern: ["**/motion/**", "**/*animation*", "**/*Animation*", "**/*Transition*"]
---

> Source: agent-harness `stacks/framer-motion/rules/framer-motion.md`. Edit it there; this copy is generated.

# Animation System (Framer Motion)

## Design Principles

Every animation must serve one of these purposes — if it doesn't, don't animate:

1. **Orient** — Help the user understand where they are and where things came from (page transitions, sidebar collapse, modal entry)
2. **Guide** — Direct attention to what changed or what needs action (badge pulse, toast entry, highlight flash)
3. **Feedback** — Confirm that an action was received (button press, form submit, item added to a list)
4. **Connect** — Show relationships between elements (shared element transitions, expand/collapse, reorder)

### Responsiveness
- UI must feel instantly responsive. Never block interaction with an animation.
- Touch/click handlers fire immediately; the animation is visual confirmation, not a gate.
- If an animation takes >300ms, the underlying state change should already be committed.

### Interruptibility
- Animations triggered by user action should be interruptible — if the user clicks again mid-animation, the new action takes priority.
- Use Framer Motion's built-in interruption (it automatically blends to new targets).
- For CSS animations: the `onAnimationEnd` pattern handles this naturally since state resets allow re-trigger.

### Chaining
- Avoid sequential animations that block interaction. Prefer parallel or overlapping.
- Stagger delays should be short (30-50ms between items) — the user shouldn't wait for the last item to appear.
- Never chain more than 2 dependent animations (A finishes → B starts). If you need more, run them in parallel with offset delays.

## Spatial Model

Elements should come from and go to meaningful places. This creates spatial memory — users intuitively know where things "live."

### Direction Rules

| Action                          | Animation Direction                                     | Rationale                                |
|---------------------------------|---------------------------------------------------------|------------------------------------------|
| Navigate deeper (list → detail) | Content slides in from right                            | Moving "forward" in hierarchy            |
| Navigate back (detail → list)   | Content slides in from left                             | Moving "backward" in hierarchy           |
| Open modal/dialog               | Scale up from center or trigger point                   | Expanding from the action that opened it |
| Close modal/dialog              | Scale down + fade out                                   | Returning to where it came from          |
| Add item (to a list)            | Item scales in from the add button direction            | Shows where it "went"                    |
| Remove item                     | Item slides out horizontally or scales down             | Disappearing from its position           |
| Notification/toast              | Slides in from where its trigger lives (e.g. top-right) | Comes from its source                    |
| Sidebar expand                  | Width grows from left edge                              | Expanding from its collapsed state       |
| Dropdown menu                   | Scales down from trigger button                         | Appears from what opened it              |

### Lateral vs Hierarchical Navigation

Not all PUSH navigations are "forward." Distinguish:
- **Lateral** (sidebar item to sidebar item): same hierarchy level → use neutral (fade+up)
- **Hierarchical** (list → detail, e.g., /orders → /orders/abc): deeper → use directional slide

Keep the set of top-level routes in one place, read by the page-transition component, and add every new top-level sidebar route to it.

### Spatial Consistency
- The same element should always animate from/to the same direction regardless of context.
- If a card enters from the bottom on page load (`fadeInUp`), it should exit downward if removed.
- Modals always scale from center. Sheets always slide from their edge (e.g. right for a side sheet, bottom for mobile).

### Depth and Layering
- Elements closer to the user (modals, toasts, dropdowns) animate faster and with more spring.
- Background elements (page content behind a modal) should dim/blur but not move.
- Use `z-index` layering to reinforce depth: higher layers = closer to user = more responsive animation.

## Animation Patterns

The patterns below gate on a motion check, `animationsEnabled`: Framer Motion's `useReducedMotion()`,
or the project's own hook when it also honours a user setting.

### 1. Stagger a list
```tsx
const animationsEnabled = useAnimationsEnabled(); // the project's motion gate

{animationsEnabled ? (
  <m.div
    className="grid"
    variants={staggerContainer}
    initial="initial"
    animate="animate"
  >
    {items.map((item) => (
      <m.div key={item.id} variants={staggerItem}>
        <Card />
      </m.div>
    ))}
  </m.div>
) : (
  <div className="grid">
    {items.map((item) => <Card key={item.id} />)}
  </div>
)}
```

### 2. List Item Add/Remove
```tsx
<AnimatePresence mode="popLayout">
  {items.map((item) => (
    <m.div
      key={item.id}
      variants={listItem}
      initial="initial"
      animate="animate"
      exit="exit"
      layout
    >
      <ItemRow />
    </m.div>
  ))}
</AnimatePresence>
```

### 3. Badge Pop (counts)
```tsx
<AnimatePresence>
  {count > 0 && (
    <m.span
      key={count}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 15 }}
    >
      {count}
    </m.span>
  )}
</AnimatePresence>
```

### 4. Animated Numbers (Dashboard Stats)
```tsx
// one shared animated-number component
<AnimatedCounter 
  value={totalRevenue} 
  format={(v) => formatCurrency(v)}
  delay={0.1}
  duration={0.8}
/>
```

### 5. Sidebar Collapse/Expand
```tsx
// Use tween for smooth, predictable timing (not spring)
const sidebarTransition = {
  type: 'tween',
  duration: 0.25,
  ease: [0.4, 0, 0.2, 1], // Material Design ease-out curve
};

const SidebarWrapper = animationsEnabled ? m.aside : 'aside';
const sidebarProps = animationsEnabled ? {
  variants: { expanded: { width: 240 }, collapsed: { width: 64 } },
  animate: collapsed ? 'collapsed' : 'expanded',
  transition: sidebarTransition,
  className: `sidebar sidebar--motion ${collapsed ? 'sidebar--collapsed' : ''}`,
} : {};

<SidebarWrapper {...sidebarProps}>
  <m.span variants={labelVariants} animate={collapsed ? 'collapsed' : 'expanded'}>
    {label}
  </m.span>
</SidebarWrapper>
```

**Note**: A `--motion` modifier class disables the element's CSS transitions when Framer Motion handles the animation to prevent conflicts.

### 6. Content Crossfade (Skeleton → Content)
```tsx
// A shared crossfade wrapper for data-loading sections: skeleton fades out, content fades in
<Crossfade isLoading={isLoading} skeleton={<DetailSkeleton />}>
  <DetailContent data={data} />
</Crossfade>
```

Use one shared crossfade component for any page section that shows a skeleton during data loading, and let it check the motion gate internally. Keep error states and not-found guards OUTSIDE the crossfade.

### 7. Directional Page Transitions
A page-transition wrapper in the layout can detect navigation direction automatically:
- **PUSH** (forward navigation, e.g., list → detail): content slides in from right (30px offset)
- **POP** (back navigation, e.g., detail → list): content slides in from left
- **REPLACE** or first load: neutral fade + 8px y-shift

No per-page configuration needed — it reads `useNavigationType()` from React Router.

## Best Practices

1. **Always check the motion gate** - Render static elements when animations are disabled
2. **Use variants for reusability** - Import from the project's shared variants module
3. **Keep durations short** - 150-300ms for micro-interactions
4. **Use spring for physical feel** - `type: 'spring', stiffness: 300-500, damping: 25-30`
5. **Use tween for precise timing** - `type: 'tween', duration: 0.2, ease: 'easeOut'`
6. **Animate transform and opacity only** - GPU-accelerated, no layout thrashing
7. **Use `layout` prop sparingly** - Only when elements need to animate position changes
8. **Key animated elements** - Use unique keys for `AnimatePresence` to trigger re-animation

## Ambient / Background Animation

Long-running decorative animation — hero artwork, background fields — follows
different rules from the micro-interactions above, because it never stops and it
sits underneath content.

1. **Reduced motion shows the finished state, not a frozen frame.** Disabling the
   animation must leave a complete, sensible picture. A half-drawn illustration or
   a marker parked mid-travel reads as a rendering bug. Where a device only makes
   sense in motion (a pen mid-stroke), hide it and settle everything it was
   drawing into its final state.
2. **Pause when off-screen.** Gate on an `IntersectionObserver` as well as
   the motion gate; an infinite loop should not run behind the fold.
3. **Compositor-only properties, and no permanent `will-change`.** `transform` /
   `opacity` only, as above. Skip `will-change` on large elements that animate
   from first paint — the compositor promotes them anyway, and the hint keeps a
   big layer resident even while paused.
4. **Keep it low-frequency behind display type.** Fine-grained artwork competes
   with large headings and reads as noise. Long lines with wide gaps read as
   structure. Sparse and large beats dense and small at low contrast.
5. **Seamless loops, or alternate.** A looped `translate` jumps at the seam unless
   the distance is exactly one period of the pattern. When content is visible at
   the seam, `animation-direction: alternate` avoids the problem entirely.

## Animation Timing Guidelines
| Animation Type    | Duration  | Easing                                  |
|-------------------|-----------|-----------------------------------------|
| Micro-feedback    | 100-150ms | ease-out                                |
| State transitions | 200ms     | ease-out                                |
| Page transitions  | 200-300ms | ease-out                                |
| Number counting   | 800ms     | spring                                  |
| Sidebar collapse  | 250ms     | Material Design ease `[0.4, 0, 0.2, 1]` |

## When to Use CSS vs Framer Motion

**Use CSS transitions for:**
- Simple hover/focus state changes
- Color, background, border changes
- Single-property transforms (scale on hover)

**Use Framer Motion for:**
- Enter/exit animations (AnimatePresence)
- Staggered list animations
- Layout animations (reordering)
- Animated numbers/counters
- Page transitions
- Accordion/collapsible content

## Re-triggerable CSS Animations

CSS animations don't restart when a class is removed and re-added to the same DOM element. Use the `onAnimationEnd` pattern to allow repeated triggers:

```tsx
const [pulse, setPulse] = useState(false);
const debounceRef = useRef(false);

// Trigger pulse (with debounce to prevent rapid-fire)
useEffect(() => {
  if (shouldPulse && !debounceRef.current) {
    debounceRef.current = true;
    setPulse(true);
    setTimeout(() => { debounceRef.current = false; }, 2500);
  }
}, [shouldPulse]);

// Reset when animation completes (allows next trigger)
const handleAnimationEnd = () => setPulse(false);

<button
  className={`icon-btn${pulse ? ' icon-btn--pulse' : ''}`}
  onAnimationEnd={handleAnimationEnd}
/>
```

Put the pulse modifier and its keyframes on the specific component, not on a generic `.btn--pulse` class.

**How it works:**
1. State goes `false → true` → class is added → animation plays
2. `onAnimationEnd` fires → state goes `true → false` → class is removed
3. Next trigger sets state to `true` again → fresh class addition = fresh animation

**Approaches that DON'T work reliably:**
- `key` prop re-mounting — causes layout shift and breaks refs
- `void el.offsetWidth` reflow trick — unreliable with component abstractions (Radix, forwardRef)
- Removing/re-adding class without state — React may batch and skip the removal

**Always pair with:**
- `@media (prefers-reduced-motion: reduce)` to disable the animation
- A debounce ref to prevent rapid-fire triggers (2-3 seconds is typical)

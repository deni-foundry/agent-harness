---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics.
license: Complete terms in LICENSE.txt
targets: ["*"]
---

> Source: agent-harness `core/skills/frontend-design/SKILL.md` (third-party, Apache-2.0: see LICENSE.txt). Edit it there; this copy is generated.

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/SCSS/TS, React, etc.) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

## Mobile & Responsive Design

Every interface must work beautifully on mobile. Don't treat mobile as an afterthought or a scaled-down desktop.

- **Touch Targets**: Minimum 44x44px for interactive elements. Generous padding on buttons, links, and form controls. Thumb-friendly placement for primary actions (bottom of screen, center or right).
- **Responsive Typography**: Scale font sizes down for small screens. Headings that look bold on desktop can overwhelm on mobile. Use `clamp()` or media queries to keep text proportional.
- **Stacking & Reflow**: Multi-column layouts should collapse to single-column gracefully. Horizontal scrolling is almost never acceptable. Sidebars become drawers/sheets, grids become stacked cards.
- **Navigation**: Hamburger menu or bottom nav on mobile. Sticky headers should be compact (not eat up screen real estate). Consider swipe gestures for common actions.
- **Forms on Mobile**: Full-width inputs. Appropriate input types (`type="tel"`, `type="email"`, `inputmode="numeric"`). Avoid multi-column form layouts on small screens. Labels above inputs, not beside them.
- **Images & Media**: Use responsive images (`srcset`, `object-fit`). Avoid fixed-width images that break on narrow screens. Consider lazy loading for performance.
- **Spacing**: Reduce padding and margins on mobile. Desktop's generous whitespace becomes cramped on small screens. Use breakpoint-aware spacing.
- **Animations**: Reduce or simplify animations on mobile. Respect `prefers-reduced-motion`. Heavy parallax and scroll-triggered effects can hurt performance on lower-end devices.
- **Overflow & Scrolling**: Test for horizontal overflow. Long words, tables, and code blocks can break layouts. Use `overflow-x: auto` on data tables and `word-break` on text.
- **Modals & Overlays**: Use full-screen sheets on mobile instead of centered modals. Bottom sheets feel more native on touch devices.

**Breakpoint mindset**: This project uses desktop-first styling. Base styles target desktop, then use `max-width` media queries (or the `@include mobile` mixin) to adapt for smaller screens. Stay consistent with this approach.

Remember: Claude is capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.

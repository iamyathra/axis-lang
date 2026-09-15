# Task 4 - Cinematic Portfolio / Project Experience

Defined before either implementation was written.

## Functional requirements

1. **Hero** - a project title ("Nova Bloom"), a one-sentence tagline, and
   a 3D visual (a procedural object, continuously animated) sitting in
   the hero area.
2. **Project metadata** - a DOM block showing role, year, and a short
   list of tools/technologies used.
3. **Scroll-driven progress** - as the visitor scrolls down the page, a
   visible progress indicator (e.g. a filling bar) tracks how far through
   the page they are, driven by the page's actual scroll position (not a
   click or a timer).
4. **Crew cards** - a data-driven grid of team member cards (name, role),
   generated from one array, not hand-written per card.
5. **Interactive 3D** - clicking the hero's 3D object cycles it through a
   small set of distinct colors/materials, one step per click.
6. The page must have enough vertical content that the scroll-driven
   requirement (#3) is actually exercised by a real scroll, not visible
   in one screen's worth of content.

## Non-functional / comparison-relevant constraints

- No external 3D model asset, no physics.
- "Visually polished" per the mission brief means: real spacing/typography
  hierarchy and a coherent dark cinematic palette - not literal art
  direction, which is out of scope for a fair code-focused comparison.
- Verified in a real browser: scrolling actually moves the progress
  indicator, clicking the 3D object actually cycles its color, the crew
  grid actually reflects the source data.

## What's measured (see `results.md`)

Same categories as Tasks 1-3, plus: how the scroll-driven requirement
(new to this task - AXIS has a dedicated `scrollProgress`/`scrollTimeline`
primitive; React has no scroll-linked-animation built-in) was implemented
in each stack, and what that cost in dependencies/code.

## Limitation acknowledged up front

Same as Tasks 1-3 - see `benchmarks/README.md`'s "Familiarity bias"
section.

---
name: zfit
description: A calm instrument for one number at a time.
colors:
  dark-background: hsl(222 22% 7%)
  dark-foreground: hsl(220 20% 96%)
  dark-card: hsl(222 20% 10%)
  dark-primary: hsl(226 65% 74%)
  dark-primary-foreground: hsl(222 22% 7%)
  dark-primary-fill: hsl(220 20% 96%)
  dark-secondary: hsl(222 18% 14%)
  dark-muted: hsl(222 18% 14%)
  dark-muted-foreground: hsl(220 12% 65%)
  dark-accent: hsl(226 28% 19%)
  dark-accent-foreground: hsl(226 65% 82%)
  dark-border: hsl(222 14% 22%)
  dark-destructive: hsl(4 66% 66%)
  dark-destructive-foreground: hsl(222 22% 7%)
  dark-success: hsl(153 65% 57%)
  dark-warning: hsl(36 90% 65%)
  dark-water: hsl(200 80% 65%)
  dark-weight: hsl(174 55% 66%)
  dark-date-past: hsl(14 85% 67%)
  dark-chart-6: hsl(36 90% 65%)
  light-background: hsl(220 20% 98%)
  light-foreground: hsl(222 22% 10%)
  light-card: hsl(0 0% 100%)
  light-primary: hsl(228 40% 50%)
  light-primary-foreground: hsl(0 0% 100%)
  light-primary-fill: hsl(222 22% 10%)
  light-secondary: hsl(220 18% 94%)
  light-muted: hsl(220 18% 94%)
  light-muted-foreground: hsl(222 12% 43%)
  light-accent: hsl(226 35% 93%)
  light-accent-foreground: hsl(228 40% 35%)
  light-border: hsl(220 15% 88%)
  light-destructive: hsl(4 66% 44%)
  light-destructive-foreground: hsl(0 0% 100%)
  light-success: hsl(153 70% 28%)
  light-warning: hsl(36 90% 30%)
  light-water: hsl(200 80% 42%)
  light-weight: hsl(174 55% 34%)
  light-date-past: hsl(14 75% 42%)
  light-chart-6: hsl(36 90% 42%)
  nutrition: hsl(153 100% 34%)
  activity: hsl(14 100% 50%)
  sleep: hsl(252 56% 56%)
  protein: '#5b7cfa'
  carbs: '#f0a202'
  fat: '#a855f7'
  bubble: hsl(211 100% 50%)
  sleep-deep: '#4c3bb8'
  sleep-core: '#7c6ee8'
  sleep-rem: '#a78bfa'
  sleep-awake: '#c7cdd9'
typography:
  numeral-hero:
    fontFamily: M PLUS Rounded 1c, sans-serif
    fontSize: 4.5rem
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: -0.025em
  numeral-lg:
    fontFamily: M PLUS Rounded 1c, sans-serif
    fontSize: 3rem
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: -0.025em
  numeral-md:
    fontFamily: M PLUS Rounded 1c, sans-serif
    fontSize: 1.875rem
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: -0.025em
  title:
    fontFamily: Figtree Variable, sans-serif
    fontSize: 1.25rem
    fontWeight: 600
    lineHeight: 1.375
    letterSpacing: -0.025em
  body:
    fontFamily: Figtree Variable, sans-serif
    fontSize: 1rem
  label:
    fontFamily: Figtree Variable, sans-serif
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.25rem
  headline:
    fontFamily: Figtree Variable, sans-serif
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 2rem
    letterSpacing: -0.025em
  caption:
    fontFamily: Figtree Variable, sans-serif
    fontSize: 0.75rem
    lineHeight: 1rem
rounded:
  sm: 0.5rem
  md: 0.625rem
  lg: 0.75rem
  popover: 1rem
  hero: 1.5rem
  pill: calc(infinity * 1px)
spacing:
  '1': 0.25rem
  '2': 0.5rem
  '3': 0.75rem
  '4': 1rem
  '5': 1.25rem
  '6': 1.5rem
  '8': 2rem
  '1.5': 0.375rem
components:
  button-primary:
    backgroundColor: hsl(var(--primary-fill))
    textColor: hsl(var(--background))
    rounded: '{rounded.pill}'
    height: 2.75rem
    padding: 0.5rem 1.25rem
  button-brand:
    backgroundColor: hsl(var(--primary))
    textColor: hsl(var(--primary-foreground))
    rounded: '{rounded.pill}'
  button-outline:
    backgroundColor: hsl(var(--background))
    textColor: hsl(var(--foreground))
    rounded: '{rounded.pill}'
  button-secondary:
    backgroundColor: hsl(var(--secondary))
    textColor: hsl(var(--secondary-foreground))
    rounded: '{rounded.pill}'
  button-ghost:
    backgroundColor: transparent
    textColor: hsl(var(--foreground))
    rounded: '{rounded.pill}'
  button-link:
    backgroundColor: transparent
    textColor: hsl(var(--primary))
    rounded: '{rounded.pill}'
  button-destructive:
    backgroundColor: hsl(var(--destructive))
    textColor: hsl(var(--destructive-foreground))
    rounded: '{rounded.pill}'
  input:
    backgroundColor: hsl(var(--background))
    textColor: hsl(var(--foreground))
    rounded: '{rounded.lg}'
    height: 2.75rem
    padding: 0.5rem 0.75rem
  card:
    backgroundColor: hsl(var(--card))
    textColor: hsl(var(--card-foreground))
    rounded: '{rounded.lg}'
  macro-chip:
    rounded: '{rounded.pill}'
    padding: 0.375rem 0.75rem
  numeral:
    typography: '{typography.numeral-hero}'
  mobile-navigation:
    backgroundColor: hsl(var(--background) / 0.9)
  badge:
    backgroundColor: hsl(var(--accent))
    textColor: hsl(var(--accent-foreground))
    rounded: '{rounded.pill}'
    padding: 0.25rem 0.625rem
---

# Design System: zfit

## Overview

**Creative North Star: "A calm instrument for one number at a time"**

Night-navy surfaces, rounded numerals and quiet hairline rows make daily health data easy to scan on a phone. Dark is the hero treatment; light remains a complete theme. Periwinkle signals interaction while domain colors identify information. Foreground-filled actions are direct and restrained.

The finished redesign applies this language to Diary, Training Programs, the workout player and Check-in, with shared primitives carrying it into other routes. Metric panels, editable rows and charts share a family resemblance without forcing every screen into one composition. The existing SparkyFitness identity remains; the pinned visual direction changes the interface rather than the product name.

Recorded from `feat/zolt-redesign` source against `origin/main`. Authority: [src/index.css](src/index.css), [UI components](src/components/ui), [MainLayout](src/layouts/MainLayout.tsx), and the implemented page compositions. The [direction contract](.impeccable/surfaces/src-layouts-mainlayout-tsx.md) names the world; source wins where it differs. This is a source-derived system record, not a new browser acceptance report.

**Key Characteristics:**

- Rounded metric numerals with separate, quiet units.
- Hairline rows, flat cards and generous hero corners.
- Foreground-filled pill actions and periwinkle navigation states.
- Theme-aware domain markers, restrained charts and readable phone controls.

## Colors

Cool navy and near-white neutrals support a periwinkle interaction accent and compact domain markers. Frontmatter preserves the stylesheet's HSL and hex representations. `dark-` and `light-` are documentation snapshots of semantic variables, not additional runtime variables. Card foreground, popover, input, ring, sidebar and date aliases remain in the stylesheet. Components use live theme variables rather than a fixed snapshot.

### Primary

**Periwinkle indigo** marks links, selected navigation, focus and brand buttons. **Foreground ink** supplies the main action fill: pale in dark mode and navy in light mode. Both have explicit readable text partners.

**The Action Fill Rule.** Use `primary-fill` with `background` text for the default action. Reserve `primary` with `primary-foreground` for the explicit brand variant.

### Secondary

**Nutrition green**, **activity orange-red** and **sleep violet** identify domains. **Protein blue**, **carbohydrate amber** and **fat violet** mark macros. Water blue and weight teal adjust with the theme. The six chart series follow primary, nutrition, activity, sleep, water and theme-adjusted amber; reuse `chartSeries` from `ui/trend-chart`.

Success, warning and destructive express status with accompanying text or icons. Date indicators alias success for today, use a distinct warm past color, and alias warning for the future. Sleep stages retain fixed hex identities for deep, core, REM and awake. These are marks, not a promise of body-text contrast. Bubble blue is defined, but not every chat bubble has adopted it.

### Neutral

**Night navy** and **near-white paper** are the grounds; cards lift through a small tonal change. Muted fills, quiet text and single hairline borders organize dense records. Accent backgrounds are tinted hover/selection surfaces, distinct from the solid action fill.

**The Token Format Rule.** Wrap raw HSL triples in `hsl(var(--token))`; use the complete hex variables for macro and sleep-stage colors directly as `var(--token)`.

The sidecar's eight-step OKLCH ramps are synthesized swatch explorations required by the preview format. They are not runtime tokens or approved foreground/background combinations.

## Typography

**Display/numeral font:** M PLUS Rounded 1c, sans-serif. **Body and heading font:** Figtree Variable, sans-serif. Text is calm and compact; rounded, tabular numerals give measurements emphasis without changing the voice of their labels.

### Hierarchy

| Role                   | Source and use                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Numeral hero           | `Numeral size="hero"`: 72px bold with tight leading; Diary remaining energy, active program progress and Check-in weight. |
| Numeral large / medium | `Numeral size="lg" / "md"`: 48px / 30px; inactive program progress and workout targets use the large role.                |
| Headline               | 24px semibold, observed in Training Program detail; not a forced global page-heading size.                                |
| Title                  | `CardTitle`: 20px semibold with snug leading and tight tracking.                                                          |
| Body                   | Global 16px Figtree; fields retain this size.                                                                             |
| Control label / unit   | 14px medium with 20px line height; buttons and Numeral units. The separate form `Label` uses leading-none.                |
| Caption                | 12px for macro chips, navigation labels and chart axes; not the input size.                                               |

Frontmatter records exact reusable values. Global h1–h3 headings balance wrapping and tighten tracking. Small tabular values in ordinary rows can stay in Figtree. There is no single geometric type scale imposed on all pages.

**The Numeral Rule.** Use rounded type for measured values, counts and timers; keep headings, labels and units in Figtree.

Both families are self-hosted: Figtree's Latin variable WOFF2 and the rounded family's Latin 500/700 subsets are imported by the stylesheet. Unsupported scripts fall back to sans-serif. Locale formatting belongs in `Numeral` and `MacroChips`, not handwritten strings.

## Layout

The phone is the primary operating surface (390px reference width in PRODUCT.md). MainLayout provides horizontal gutters of 16px, increasing to 24px at 640px. The container caps at 1400px when the viewport reaches 1400px. Common spacing follows 4px steps, with a 6px compact step for chips and header gaps; section separation also uses 32px.

Navigation switches by route: Diary retains its bottom bar below 768px, while other routes switch to the desktop row at 640px. Diary hides the shared header below 768px and supplies its own date/profile row. Desktop destinations wrap. Bottom navigation has a minimum 64px row plus the bottom safe area; content reserves 80px plus that inset while the bar is present. These are minimums, not fixed heights that may clip translated labels.

Cards normally pad sections by 24px; metric panels commonly use 16px on phones and 24px from 640px. Program cards become a two-column list at 640px. Check-in weight places metric and chart in a 1:2 grid at 1024px. These are page compositions, not global grid requirements. Diary remains a customizable widget layout, so its order and density are not a fixed screenshot template.

Below 768px, `DialogContent` leaves 16px around the viewport, caps height to the dynamic viewport and scrolls internally. Immediate children can shrink. Preserve minimum-width handling and wrapping in flex/grid rows. Coarse pointers raise `touch-target` controls to at least 44px in both dimensions and editable text to 16px. These safeguards do not imply that every legacy control is compliant.

## Elevation & Depth

Depth is primarily tonal, with borders doing structural work. Cards have no default shadow. Dialogs and popovers float with existing soft shadows. Mobile navigation uses a 90% background and 24px backdrop blur. Dialog overlays dim with black at 60%.

### Shadow Vocabulary

- **Popover:** `0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)`.
- **Dialog:** `0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`.

These are the installed Tailwind defaults used by `PopoverContent` and `DialogContent`.

**The Flat Card Rule.** Ordinary cards separate content with tone and hairlines. Floating overlays may use the existing soft shadows; the world is not shadow-free.

`AmbientGlow` is an available static, dark-only radial wash: primary at 14% and nutrition at 8%, clipped by its containing panel. It is pointer-transparent and hidden from assistive technology. Do not assume every hero mounts it simply because the contract proposed it.

Button/tab colors transition over 150ms with the default cubic-bezier(0.4, 0, 0.2, 1); DialogContent uses 200ms. Accordions use 200ms ease-out. Trend lines do not animate. Global reduced-motion rules set transitions and animations to 0.01ms, limit iterations to one and disable smooth scrolling.

## Shapes

Shared radii start at 12px: cards and fields use that large step; medium and small steps resolve to 10px and 8px. Popovers and chart tooltips use 16px. Hero panels and dialogs use 24px. Buttons, badges, macro chips and tab tracks are fully rounded pills; mobile navigation items and segmented StatRows footer actions deliberately have square corners.

Hairlines are single-pixel separators. Lucide SVG icons accompany actions and statuses; the shell retains the existing raster logo. Literal typographic arrows are not a required button decoration: callers add the SVG icon when appropriate.

## Components

### Buttons

Direct, rounded actions. Import `Button` from `@/components/ui/button`. Default is foreground-filled; `brand` is periwinkle, `outline` is a bordered background fill, `secondary` is muted, `ghost` is transparent, `link` is primary text, and `destructive` uses paired status colors.

Default height is 44px with 8px/20px vertical/horizontal padding; small is 36px with 12px horizontal padding, large is 48px with 24px, and icon is 44px square. Coarse-pointer minimums still apply. Filled hover backgrounds use 90% opacity, secondary uses 80%, and outline/ghost hover uses accent with accent foreground. Links underline on hover. Focus is a 2px ring with a 2px background offset; disabled buttons use half opacity and no pointer interaction. Arrows belong to the caller, not the primitive.

### Chips and tabs

Compact, labeled indicators. `MacroChips` wraps informational pills with a 6px colored dot, translated name and locale-formatted grams. It is not a filter widget. Padding is 6px/12px; Diary supplies a denser phone override without changing the primitive. `Badge` defaults to a quiet accent fill and primary border at 20%, with secondary, destructive and outline variants.

`TabsList` is a bordered muted pill with 4px padding; active triggers use the default action's fill/text pair. Preserve Radix keyboard behavior. Do not make informational chips keyboard controls merely to mimic tabs.

### Cards / containers

Flat surfaces with quiet edges. `Card` has a 12px radius, semantic card fill and foreground, a hairline and no default shadow. Header/content/footer use 24px padding, with content/footer top padding removed. Hero rounding and responsive padding are caller choices. See `DailyProgress`, `CheckInWeightTrend` and `ProgramDetail` for finished compositions.

### Inputs / fields

Clear, familiar fields. `Input` has a 44px height, 12px corners, background fill, input border and 8px/12px padding. Placeholder text is muted. Focus matches button rings; disabled fields use half opacity and a not-allowed cursor. `Textarea` retains the same visual family with an 80px minimum height. Keep labels, validation and native constraints. Existing number steppers are implementation detail, not a model for new touch controls.

### Navigation and dialogs

A quiet persistent route scaffold. MainLayout owns the shell; pages render through its outlet. Owner mobile destinations are Diary, Training, Check-in and More, filtered by permissions. Active icons/text are periwinkle; inactive items are muted. Training and More open dialogs. Route-current and expanded state remain accessible. The desktop row uses accent-filled active items, and date state can tint its border/background.

`DialogContent` uses a card surface, 24px corners/padding, a soft shadow and viewport-fit behavior. The close target is 44px with an SVG icon and an accessible name. Reuse Radix focus trapping and dismissal behavior, including the existing optional unsaved-change confirmation.

### Metric, row and trend patterns

- **Numeral:** hero/large/medium values with small units below or wrapping beside the baseline. Null and non-finite numbers display an em dash; numbers use the active locale. Program counts and workout target pairs demonstrate that a lead value need not always be a single 72px number.
- **StatRows:** a description list with label/value rows, 12px vertical padding and hairlines. Optional actions share a divided footer and wrap their labels. Use real supplied values; the component supplies presentation, not metrics.
- **TrendChart:** a 256px plot with a 2px linear, unanimated line, quiet horizontal grid, 12px axes, optional 4px dots, dashed target/event references and a hidden data list. The y-domain includes the target and finite observations with padding; missing observations stay null. Reuse the exported theme and series while retaining existing chart interactions.
- **Implemented compositions:** Diary energy is a rounded numeral rather than the old ring; meals use divided rows; Training Programs combine progress counts, schedules and session rows; Check-in combines weight and its trend; workout targets separate measured values from units. These demonstrate the system without prescribing one layout for every domain.

## Do's and Don'ts

### Do

- Do use semantic colors and paired foregrounds in both themes.
- Do reuse Numeral, StatRows, MacroChips and TrendChart for the patterns they implement.
- Do let labels and values wrap, preserve visible focus, and retain coarse-pointer and safe-area rules.
- Do preserve real data, translated labels, permissions and existing interactions when styling a surface.

### Don't

- Don't substitute periwinkle for the foreground-filled default action.
- Don't treat domain marker colors as a guarantee of readable small text on every surface.
- Don't add decorative ring dashboards or multicolored card grids as the default summary language; use the implemented metric and row patterns.
- Don't inherit legacy uppercase eyebrows or tiny number-stepper buttons as new component standards.

Not canonized or repaired: uppercase eyebrow treatments remain in WaterIntake and food-photo details, and Input's hover-only numeric steppers remain narrow and unlabeled. These source-level exceptions are not reusable standards; this pass writes only the two design records. Proposed universal aurora and trailing-arrow CTA treatments are not claimed as shipped invariants.

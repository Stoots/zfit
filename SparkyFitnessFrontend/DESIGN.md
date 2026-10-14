---
name: zfit
description: A calm instrument for one number at a time.
colors:
  dark-background: 'hsl(222 22% 7%)'
  dark-foreground: 'hsl(220 20% 96%)'
  dark-card: 'hsl(222 20% 10%)'
  dark-primary: 'hsl(226 65% 74%)'
  dark-primary-foreground: 'hsl(222 22% 7%)'
  dark-primary-fill: 'hsl(220 20% 96%)'
  dark-muted: 'hsl(222 18% 14%)'
  dark-muted-foreground: 'hsl(220 12% 65%)'
  dark-accent: 'hsl(226 28% 19%)'
  dark-accent-foreground: 'hsl(226 65% 82%)'
  dark-border: 'hsl(222 14% 22%)'
  dark-destructive: 'hsl(4 66% 66%)'
  dark-destructive-foreground: 'hsl(222 22% 7%)'
  dark-success: 'hsl(153 65% 57%)'
  dark-warning: 'hsl(36 90% 65%)'
  dark-water: 'hsl(200 80% 65%)'
  dark-weight: 'hsl(174 55% 66%)'
  light-background: 'hsl(220 20% 98%)'
  light-foreground: 'hsl(222 22% 10%)'
  light-card: 'hsl(0 0% 100%)'
  light-primary: 'hsl(228 40% 50%)'
  light-primary-foreground: 'hsl(0 0% 100%)'
  light-primary-fill: 'hsl(222 22% 10%)'
  light-muted: 'hsl(220 18% 94%)'
  light-muted-foreground: 'hsl(222 12% 43%)'
  light-accent: 'hsl(226 35% 93%)'
  light-accent-foreground: 'hsl(228 40% 35%)'
  light-border: 'hsl(220 15% 88%)'
  light-destructive: 'hsl(4 66% 44%)'
  light-destructive-foreground: 'hsl(0 0% 100%)'
  light-success: 'hsl(153 70% 28%)'
  light-warning: 'hsl(36 90% 30%)'
  light-water: 'hsl(200 80% 42%)'
  light-weight: 'hsl(174 55% 34%)'
  nutrition: 'hsl(153 100% 34%)'
  activity: 'hsl(14 100% 50%)'
  sleep: 'hsl(252 56% 56%)'
  protein: '#5b7cfa'
  carbs: '#f0a202'
  fat: '#a855f7'
  bubble: 'hsl(211 100% 50%)'
typography:
  numeral-hero:
    fontFamily: 'M PLUS Rounded 1c, sans-serif'
    fontSize: '4.5rem'
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: '-0.025em'
  numeral-lg:
    fontFamily: 'M PLUS Rounded 1c, sans-serif'
    fontSize: '3rem'
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: '-0.025em'
  numeral-md:
    fontFamily: 'M PLUS Rounded 1c, sans-serif'
    fontSize: '1.875rem'
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: '-0.025em'
  title:
    fontFamily: 'Figtree Variable, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 600
    lineHeight: 1.375
    letterSpacing: '-0.025em'
  body:
    fontFamily: 'Figtree Variable, sans-serif'
    fontSize: '1rem'
  label:
    fontFamily: 'Figtree Variable, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 500
    lineHeight: '1.25rem'
rounded:
  sm: '0.5rem'
  md: '0.625rem'
  lg: '0.75rem'
  popover: '1rem'
  hero: '1.5rem'
  pill: '9999px'
spacing:
  1: '0.25rem'
  2: '0.5rem'
  3: '0.75rem'
  4: '1rem'
  5: '1.25rem'
  6: '1.5rem'
components:
  button-primary:
    backgroundColor: 'hsl(var(--primary-fill))'
    textColor: 'hsl(var(--background))'
    rounded: '{rounded.pill}'
    height: '2.75rem'
    padding: '0.5rem 1.25rem'
  button-brand:
    backgroundColor: 'hsl(var(--primary))'
    textColor: 'hsl(var(--primary-foreground))'
    rounded: '{rounded.pill}'
  button-outline:
    backgroundColor: 'hsl(var(--background))'
    textColor: 'hsl(var(--foreground))'
    rounded: '{rounded.pill}'
  button-secondary:
    backgroundColor: 'hsl(var(--secondary))'
    textColor: 'hsl(var(--secondary-foreground))'
    rounded: '{rounded.pill}'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: 'hsl(var(--foreground))'
    rounded: '{rounded.pill}'
  button-link:
    backgroundColor: 'transparent'
    textColor: 'hsl(var(--primary))'
    rounded: '{rounded.pill}'
  button-destructive:
    backgroundColor: 'hsl(var(--destructive))'
    textColor: 'hsl(var(--destructive-foreground))'
    rounded: '{rounded.pill}'
  input:
    backgroundColor: 'hsl(var(--background))'
    textColor: 'hsl(var(--foreground))'
    rounded: '{rounded.lg}'
    height: '2.75rem'
    padding: '0.5rem 0.75rem'
  card:
    backgroundColor: 'hsl(var(--card))'
    textColor: 'hsl(var(--card-foreground))'
    rounded: '{rounded.lg}'
  macro-chip:
    rounded: '{rounded.pill}'
    padding: '0.375rem 0.75rem'
  numeral:
    typography: '{typography.numeral-hero}'
  mobile-navigation:
    backgroundColor: 'hsl(var(--background) / 0.9)'
    height: '4rem'
---

# Design System: zfit

## Overview

**Creative North Star: "A calm instrument for one number at a time"**

Night-navy surfaces, rounded numerals and quiet hairline rows make daily health data easy to scan on a phone. Dark is the hero treatment; light remains a complete theme. Periwinkle signals interaction while domain colors identify information.

This captures the implemented foundation: tokens, shared primitives, metric components and app navigation. Page compositions remain in the [surface brief](.impeccable/surfaces/src-layouts-mainlayout-tsx.md); their redesign is separate work. The existing SparkyFitness logo remains the identity asset. No new shipping raster artwork is part of this foundation.

**Key Characteristics:**

- One prominent rounded metric with a small text unit.
- Hairline rows and restrained surfaces.
- Foreground-filled pill actions and periwinkle navigation states.
- Static dark-only ambient color, with useful data carrying the visual weight.

## Colors

The frontmatter records resolved theme values from [src/index.css](src/index.css). `dark-` and `light-` identify snapshots of the same semantic CSS variables, not new runtime token names. Runtime aliases such as card foreground, popover, sidebar, ring and input stay defined in that stylesheet.

The companion `.impeccable/design.json` adds preview snippets, motion, breakpoints and descriptive metadata. Its synthesized tonal ramps are panel explorations, not additional runtime colors.

### Primary

Periwinkle (`primary`) is the interaction accent: links, selected navigation, focus rings and the explicit `brand` button. `primary-foreground` is its paired readable text color.

**The Action Fill Rule.** Use `primary-fill` with `background` text for the main CTA. It follows the foreground color in each theme. Use `primary` with `primary-foreground` only when an accent-filled action is intended.

### Secondary

Nutrition green, activity orange-red and sleep violet retain their domain meanings in both themes. Protein blue, carbs amber and fat violet identify macro dots. Water blue and weight teal adapt to the theme. Bubble blue is reserved for the message color token; defining the token does not imply every existing chat surface has been migrated.

Success and warning are theme-adjusted semantic colors. Fixed domain hues are markers and chart colors, not a guarantee of readable small text on every background. Keep accompanying labels in foreground or muted foreground.

### Neutral

Night navy supports dark surfaces; near-white supports light surfaces. Card, muted and accent tones separate regions without decorative shadows. Border provides the quiet hairline. Destructive has its own foreground pair for readable actions.

**The Token Format Rule.** Most raw variables contain HSL triples: use `hsl(var(--nutrition))` or Tailwind `bg-nutrition`. Protein, carbs and fat contain complete hex colors: use `var(--protein)` or `bg-protein`, never wrap them in `hsl()`. Preserve these representations when adding chart styles.

The six chart series alias primary, nutrition, activity, sleep, water and a theme-adjusted amber. Import `chartSeries` from `@/components/ui/trend-chart` rather than restating the palette.

## Typography

Figtree Variable is the text family; M PLUS Rounded 1c is reserved for numerals. Both fall back to sans-serif. Labels, units, buttons and headings stay in Figtree; tabular figures keep values stable in rows.

`Numeral` exposes hero, large and medium roles from the frontmatter. `CardTitle` supplies the title role. The global heading rule tightens tracking and balances lines; individual page heading sizes remain local.

Fonts are self-hosted through Fontsource. `src/index.css` loads only Figtree's Latin variable WOFF2 and M PLUS Rounded 1c's Latin 500/700 subsets, with font-display swap. Unsupported scripts use fallback fonts; do not import all language subsets just to render numerals. Production PWA precaching in `vite.config.ts` includes WOFF2 so these fonts can remain available offline after caching. This is build configuration, not a claim of device-level offline verification.

## Layout

Design for the phone first (390px reference viewport). The shell has 16px horizontal padding, increasing to 24px from 640px. The shared container caps at 1400px at that width. Use the established spacing steps in the frontmatter and let labels wrap rather than clipping controls.

Below 640px the shell uses a fixed bottom navigation with a 64px row plus the bottom safe area. Main content reserves 80px plus that safe area; the top bar includes the top safe area. From 640px, navigation becomes a wrapping horizontal row below the header. These shell breakpoints are distinct from the mobile viewport/dialog fit rule, which applies through 767px.

Dialogs below 768px leave 16px on every side, cap their height to the dynamic viewport and scroll internally. Grid/flex children must be allowed to shrink. Reuse `DialogContent` to inherit those constraints.

On coarse pointers, `.touch-target` enforces at least 44px in both dimensions. Editable controls use at least 16px text. Retain visible keyboard focus and reduced-motion support alongside touch behavior.

## Elevation & Depth

Depth comes primarily from tonal layers and borders. Cards have no default shadow. Dialogs and floating menus retain their existing Tailwind shadows; mobile navigation uses a 90% opaque background and a 24px backdrop blur. Reserve this blur for the navigation surface rather than adding it to every panel.

`AmbientGlow` is a static pair of radial gradients, visible only in dark mode. Place it in a positioned, clipped panel with content above it; it has no pointer events and is hidden from assistive technology. It does not animate or continuously blur.

Buttons and tabs transition colors over 150ms; dialog transitions use 200ms. The global reduced-motion rule reduces animations/transitions to 0.01ms, limits animation iterations and disables smooth scrolling. Trend lines do not animate.

## Shapes

Cards and form controls use the large radius token; floating menus use the popover radius; dialogs use the hero radius. Future metric hero panels can use that same hero radius. Primary actions, badges, macro chips and segmented tab tracks are pills. Hairlines use a single border or divider rather than nested framed boxes.

## Components

Imports below resolve through `@/` to `src/`. Examples assume existing translated labels, callbacks and real data in scope; they are composition examples, not invented user metrics.

### Buttons

Import `{ Button }` from `@/components/ui/button`.

`<Button onClick={onStart}>{startLabel}<ArrowRight aria-hidden="true" /></Button>`

Import `ArrowRight` from `lucide-react` when using a trailing CTA arrow. The button does not add an arrow automatically. Default actions are foreground-filled pills; use `variant="outline"` for a hairline alternative, `ghost` for quiet actions, `secondary` for muted fills, `brand` for periwinkle, `destructive` for destructive actions and `link` for text links. Default/icon sizes are 44px, small is 36px (44px minimum on coarse pointers), and large is 48px. Focus rings are 2px with a 2px background offset; disabled buttons lose pointer interaction and use half opacity.

### Cards and fields

Import `{ Card, CardHeader, CardTitle, CardContent }` from `@/components/ui/card`.

`<Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent>{children}</CardContent></Card>`

Cards are bordered and flat, with 24px section padding. Content and footer remove top padding to connect with the header. Hero rounding is an explicit composition choice, not Card's default.

Import `{ Input }` from `@/components/ui/input`, `{ Textarea }` from `@/components/ui/textarea`, and the Radix wrappers from `@/components/ui/select`.

`<Input id="measurement" type="number" value={value} onChange={onChange} aria-label={label} />`

Fields are 44px high with a background surface, border and visible focus ring; textareas have an 80px minimum height. Preserve labels, validation messages and native input constraints. Number inputs retain the shared stepping behavior.

### Tabs and badges

Import `{ Tabs, TabsList, TabsTrigger, TabsContent }` from `@/components/ui/tabs` and `{ Badge }` from `@/components/ui/badge`.

`<Tabs value={tab} onValueChange={setTab}><TabsList>{triggers}</TabsList>{panels}</Tabs>`

`<Badge variant="outline">{statusLabel}</Badge>`

Tabs form a bordered muted pill track; the active tab uses primary-fill and background text. Badge defaults use a quiet accent fill and border. Keep Radix keyboard behavior and meaningful labels.

### Numeral

Import `{ Numeral }` from `@/components/ui/numeral`.

`<Numeral value={remaining} unit={t('common.kcal')} subline={budgetLabel} />`

Numbers format with the current i18n locale unless `locale` is supplied. Pass `formatOptions` for precision; strings pass through. Null and non-finite numbers display an em dash. `size="lg"` and `size="md"` serve smaller metrics; `unitPosition="beside"` wraps with baseline alignment. Units and sublines stay small and muted.

### Stat rows

Import `{ StatRows }` from `@/components/ui/stat-rows`.

`<StatRows rows={summaryRows} actions={summaryActions} />`

Rows accept `{ id, label, value, meta? }`; actions accept `{ id, label, onClick, disabled? }`. A semantic description list aligns labels with values, separates rows with hairlines and wraps long content. Optional footer actions form equal segments with dividers.

### Macro chips

Import `{ MacroChips }` from `@/components/ui/macro-chips`.

`<MacroChips protein={totals.protein} carbs={totals.carbs} fat={totals.fat} kcal={totals.calories} />`

A wrapping list uses colored dots, translated macro names and locale-formatted grams with at most one decimal. Optional kcal rounds to an integer. Chips are informational, not filter controls; color always accompanies a label.

### Trend chart

Import `{ TrendChart, chartSeries, trendChartTheme }` from `@/components/ui/trend-chart` as needed.

`<TrendChart data={points} label={chartLabel} valueLabel={metricLabel} target={target} events={events} formatValue={formatValue} />`

Points use `{ label, value }` with nullable values; target uses `{ value, label }`; event markers use `{ at, label }`, where `at` matches an x-axis label. The line is linear and unanimated, with a 256px plot area, quiet horizontal grid and dashed references. The y-domain includes finite observations and the target with padding, so subtle changes remain legible. Keep missing observations as null. A hidden data list complements the chart accessibility layer. Use the exported theme/series when adapting existing charts; preserve their interactions.

### Ambient glow

Import `{ AmbientGlow }` from `@/components/ui/ambient-glow`.

`<section className="relative isolate overflow-hidden rounded-3xl"><AmbientGlow /><div className="relative">{children}</div></section>`

Use behind a significant metric panel, with readable foreground content in both themes. Light mode omits the wash automatically.

### Navigation and dialogs

The shell lives in `@/layouts/MainLayout`; pages render through its outlet rather than instantiating a second navigation. Mobile owner navigation presents Diary, Training, Check-in and More, with periwinkle active states. Training and More open dialogs; permission-based visibility remains part of the shell. Desktop navigation wraps available destinations and keeps the same permission logic.

Import `AddComp` from `@/layouts/AddComp` for the existing icon choice dialog.

`<AddComp isVisible={open} onClose={onClose} items={items} onNavigate={onNavigate} title={title} />`

It uses the shared Radix dialog, a two-column grid of outlined choices, and optional full-width items. Selecting a choice navigates and closes it. For other dialogs, import `{ Dialog, DialogContent, DialogHeader, DialogTitle }` from `@/components/ui/dialog` and preserve focus trapping, escape behavior and an accessible title.

## Do's and Don'ts

### Do

- Do use semantic theme variables and their paired foregrounds.
- Do reserve rounded numeral type for metrics, with Figtree labels and units.
- Do reuse the metric components with real values and translated labels.
- Do check both themes at 390px and desktop widths, including keyboard focus and long labels.
- Do preserve permissions, routes and existing interactions when applying the visual system.

### Don't

- Don't substitute the periwinkle accent for the foreground-filled default CTA.
- Don't wrap protein, carbs or fat variables in `hsl()`.
- Don't add ring dashboards or multicolored card grids to express the pinned visual direction; use a lead metric and quiet rows.
- Don't treat primitive captures as authenticated page acceptance or a completed page redesign.

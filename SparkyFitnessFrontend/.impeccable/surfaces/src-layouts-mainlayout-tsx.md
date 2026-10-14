---
version: 1
slug: 'src-layouts-mainlayout-tsx'
primary_target: 'src/layouts/MainLayout.tsx'
related_targets:
  [
    'src/pages/Diary/Diary.tsx',
    'src/pages/TrainingPrograms/TrainingPrograms.tsx',
    'src/pages/CheckIn/CheckIn.tsx',
    'src/pages/Diary/WorkoutPlaybackPage.tsx',
  ]
---

# Surface brief: zfit app (Zolt-style redesign)

Scope: the whole web app's visual world (tokens, type, primitives, app shell), with full redesigns of Diary (including the workout player), Training Programs and Check-in. Mode: **Operate**. Primary viewport: iPhone Home Screen web app at 390px. Desktop (1280–1600) is secondary.

Audience and job: one owner who logs meals and sets one-handed, often between sets, and follows a multi-week Training Program. Success is fast logging, with today's session and the remaining budget readable at a glance.

Constraints: keep every function, route, permission, i18n key (only `en` is edited) and data flow. Light and dark themes both ship, and dark is the hero. No native app changes. Do not copy Zolt's name, logo, marketing copy or claims; take only its visual language.

Pinned by user (2026-10-15): "the style of zolt https://www.zolthealth.com/". Brief-pinned, so it beats the roll.

## Direction contract

THESIS: This is a calm instrument for one number at a time. Each screen leads with a single monumental rounded numeral that answers "where am I today" (kcal left, today's session, trend weight), and quiet hairline rows sit under it. It refuses the category default of ring dashboards and confetti-coloured card grids.

OWN-WORLD: Night-navy ground (dark `222 22% 7%`, card `222 20% 10%`, hairline `222 14% 22%`; light `220 20% 98%` with white cards and `220 15% 88%` hairlines). Periwinkle indigo primary (`226 65% 74%` dark / `228 40% 50%` light). Fixed domain hues: nutrition green `153 100% 34%`, activity orange-red `14 100% 50%`, sleep violet `252 56% 56%`, protein `#5b7cfa`, carbs `#f0a202`, fat `#a855f7`. Figtree for all text. M PLUS Rounded 1c for numerals only. 12px radius on cards and 24px on hero panels. Primary CTAs are pills with a trailing →: foreground-filled (white on dark), with secondary as a hairline ghost pill. Message bubbles are iMessage blue.

STORY: Open the app and immediately know what's left today and what session is next. Log in one or two taps. See the trend move, with your own events marked on it.

FIRST VIEWPORT: Diary at 390px, dark. A thin top bar has the date stepper (‹ Today ›) on the left and the profile on the right, over a hairline. The hero shows the kcal-left numeral at about 72px rounded, with "of 2,180 · 1,520 eaten" muted beneath, a row of macro chips (coloured dot + grams), and a faint aurora glow behind it in dark mode only. Next is a "Today's session" panel: program name · week/day, the session title, and a white pill "Start workout →". Meals follow as hairline label/value rows with a quiet "+" per meal. A blurred bottom tab bar holds Diary, Training, Check-in and More, with the active item periwinkle.

FORM: User-pinned Zolt Health visual language, adapted to Operate. Signature moves: the monumental rounded numeral with a small unit label, and trend charts with a dashed target line and annotated event markers. Summary panels use label/value hairline rows with a segmented action footer. Seed key 06905ec3 (roll overridden by the user's pin).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

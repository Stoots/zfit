# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the owner of this self-hosted server (Stoots/zfit). They use it mostly on an iPhone, as the web app added to the Home Screen (PWA, 390px viewport). They log food and training during the day, often between sets or right after a meal. Desktop is secondary and is used for planning and reports.

## Product Purpose

zfit is a personal fork of SparkyFitness, a self-hosted nutrition, fitness and health tracker. It covers food diary, exercise and workout logging, check-ins (weight and measurements), goals, fasting, medications, symptoms, cycle tracking, reports, integrations, and an AI chat assistant. Success means daily logging is fast enough on a phone that it actually happens, and training follows a planned program without friction.

## Positioning

The fork exists to own its training workflow. Its multi-week **Training Programs** schedule reusable **Workout Plan** sessions, and it adds **Workout Sessions** and **Cardio Tests**. These ship to the phone only through the web app. The upstream App Store app cannot show them.

## Operating Context

- Phone in hand at the gym or table, often one-handed, and glanced at between sets.
- The same server also serves the upstream App Store SparkyFitness app. Server and API contracts must stay compatible with it.
- Self-hosted. Data is private to one person.

## Capabilities and Constraints

- Stack: React 19, Vite, Tailwind v4, Radix/shadcn-style primitives in `src/components/ui`, lucide icons, i18next (35 locales; only `en` is hand-edited), and a light/dark theme.
- Redesign scope (confirmed 2026-10-15): a new design system (tokens, type, primitives, app shell and nav), plus full redesigns of Diary, Training Programs, Workout Sessions and Check-in. Other pages inherit the new world through the primitives.
- Divergence from upstream frontend look is accepted. Future upstream syncs may conflict on UI files.
- All functionality, routes, data, permissions and i18n keys must keep working. No native app (`SparkyFitnessMobile`) changes.

## Brand Commitments

None binding. The name "SparkyFitness" and its existing logo remain in the codebase. The fork is called zfit.

## Evidence on Hand

Real data exists only on the live server. Do not invent user stats, testimonials or claims in UI copy.

## Product Principles

1. The phone is the primary surface. Every core flow must be completable one-handed at 390px.
2. Logging speed beats exploration. Today's entries and the next action come first.
3. The plan drives the day. Training Programs and the scheduled session should be visible, not buried.
4. Preserve every function. The redesign changes the look and structure, never what the app can do.

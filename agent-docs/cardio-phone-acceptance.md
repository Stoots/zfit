# Cardio Tests: phone web acceptance

This repeatable procedure covers #95 / #1 US19 and the Cardio Test portion of T4.
Use the web app at **390×844 CSS pixels, touch enabled, device scale 3**. Native
screens are outside the fork's scope. This supplements the jsdom coverage in
`SparkyFitnessFrontend/src/tests/pages/CardioTests.test.tsx`; jsdom cannot prove
phone layout or actual Recharts rendering.

## Isolated setup

1. Run `pnpm install --frozen-lockfile` from the repository root. Set `TMPDIR` to
   the worktree's `tmp-work/` directory (never a dot-directory).
2. Follow the isolation pattern in `scripts/fork-player-e2e.mjs`: a fresh
   `postgres:18.3-alpine` container, random disposable credentials, the normal
   server `index.ts` boot path/migrations/RLS, scheduled jobs disabled, an isolated
   uploads directory, and dotenv suppressed in that child process. Never use a
   live database or load the repository `.env`.
3. Choose free, dedicated ports for PostgreSQL, the server and preview. Set both
   `SPARKY_FITNESS_FRONTEND_URL` and `BETTER_AUTH_URL` to the preview origin.
   Pass `VITE_BACKEND_HOST=127.0.0.1` and `VITE_BACKEND_PORT=<server port>` to
   **both** `vite build` and `vite preview` from `SparkyFitnessFrontend`.
   Start preview with `--host localhost --port <port> --strictPort`. Do not use the development server.
   The player script reserves 8080; use another origin when workers run together.
4. Create a synthetic ordinary user through `/api/auth/sign-up/email`, mark only
   that user's disposable `onboarding_status` complete, then sign in through the
   preview origin. Use a fresh Chromium profile and the viewport above.
5. Create a synthetic fixed-date Program named **Phone Cardio Acceptance**, goal
   **Verify four protocols**, dates **2026-10-01–2026-10-18**, with phase
   **Testing** (goal **Measure recovery**), one week spanning **2026-10-08–2026-10-14**, and a
   **Scheduled ramp** Planned Session on **2026-10-08**, bound to `ramp`.
   API fixture creation is fine; create every Test Attempt through the web form.

## Entry, reload and edit

For each protocol below, enter the first attempt on **2026-10-08**, save, reload,
enter the second on **2026-10-15**, save and reload. Tap the first history row's
**Edit**, verify all original fields, replace them with the edit values, save and
reload again. Expect exactly two records, unchanged attempt identity, correct
dates/values in history, and updated graph points. Capture the filled form, edit
form, final chart and final history at the phone viewport.

| Protocol                               | First values                            | Second values                           | Edit first to                           | Expected final result                                                                                                 |
| -------------------------------------- | --------------------------------------- | --------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Cooper run                             | 2400 m                                  | 2550 m                                  | 2450 m                                  | Two distances: 2,450 and 2,550 m; two plotted points                                                                  |
| Five 6-second sprints, 54-second rests | 900, 800, 700, 600, 500 W               | 0, 0, 0, 0, 0 W                         | 1000, 800, 700, 600, 500 W              | Five effort series / ten points; maximum 1000 W, drop-off 500 W (50.0%); all-zero attempt maximum/drop-off 0 W (0.0%) |
| Two 30-second efforts, 60-second rest  | Peak/average 800/600, 750/550 W         | 850/650, 800/600 W                      | 810/610, 760/560 W                      | All four measurements retained; four series / eight points                                                            |
| Ramp (100 W initially, +20 W/min)      | 300 W, peak 180 bpm, one-minute 180 bpm | 320 W, peak 181 bpm, one-minute 185 bpm | 310 W, peak 182 bpm, one-minute 182 bpm | Watts and HRR series / four points; edited HRR 0 bpm and standalone HRR −4 bpm                                        |

For **ramp**, open the Program first and tap the Planned Session's **Record Test
Attempt**. Confirm protocol, assessment selection and prefilled date. Retain that
selection on save and edit. The second attempt must use **Standalone Test
Attempt**. After editing, reload the Program: the same Planned Session must show
**Completed** and **Linked Test Attempt: 2026-10-08**. Capture before/after Program
history too. Check a positive HRR in the form (e.g. peak 181, one-minute 145 →
36 bpm) before replacing it with the zero/negative boundary values above.

## Phone layout and evidence gate

- Tap the controls using touch emulation; enter numbers using keyboard input.
  For automated Chromium date fields, the native input setter followed by
  bubbling `input`/`change` events is an acceptable equivalent of date-picker
  entry. Do not submit forms through an API or inject saved attempts.
- Confirm no horizontal document overflow; the form, chart, date ticks, legend,
  history values and Edit/Save actions must fit and remain readable. Scroll each
  chart into view, confirm the expected series/point counts and inspect the
  screenshot. Tap plotted points and confirm the date and values in the tooltip.
  In dark mode, measure the tooltip date against its background: require at least
  **4.5:1** contrast (the unthemed power tooltip previously measured **1.10:1**).
- Save dated scenario outcomes, viewport settings, production build/server logs,
  before/after screenshots, and the commit tested. Do not claim actual iOS Safari
  or physical-device acceptance from Chromium emulation.
- Stop the preview, server and browser and remove only the disposable container
  after the run, including on failure.

## Recorded run

Passed on **2026-10-18 04:57 UTC** against base `c7358571a` plus the shared
power-tooltip theme fix, using PostgreSQL 18.3, server 3395 and production preview 8095. All four protocols passed the procedure above: two dates, saved edits with
stable IDs and no duplicates, literal history values, actual chart point counts
(2/10/8/4), touch tooltips and no horizontal document overflow. Ramp's linked
attempt retained its assessment through editing; the other remained standalone;
the reloaded Program showed Completed and the linked date. HRR 36 preview,
0 saved and −4 saved were verified. Final screenshots were visually inspected.

The initial dark sprint tooltip failed the contrast gate at **1.10:1**; reusing
the existing shared tooltip theme raised its date contrast to **16.29:1**, matching
the other three charts. The repeatable procedure is the committed acceptance
protection; the disposable browser driver remains outside Git.

Local run evidence is retained under the owner's
`orch-20261018d/shots-95/`: `{cooper_run,sprint_6s,power_30s,ramp}-before-entry.png`,
`*-edit.png`, `*-after-chart.png`, `*-after-history.png`, `*-tooltip.png`,
`ramp-positive-hrr.png`, `ramp-program-{before,after}.png`, and
`evidence/results.json` plus build/server logs. `red/sprint_6s-tooltip.png` and
`red/failure.txt` preserve the failing contrast probe. These are local operator
artifacts, not portable repository links. An unrelated release-check network-error
toast appears above the final Program screenshot; its completed row remains
visible. This run does not establish physical iPhone/Safari behavior.

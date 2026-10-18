# Training analysis phone web acceptance

Issue #96 / parent #1, US20 and the chat portion of T4. Web only; native is frozen.

## Repeatable procedure

Use synthetic data and an isolated PostgreSQL 18 database. Follow the startup,
authentication, cleanup and production-build pattern in `scripts/fork-player-e2e.mjs`;
**do not run that script on an occupied port 8080**. Choose free ports for this
run and use the same frontend origin for Vite preview,
`SPARKY_FITNESS_FRONTEND_URL`, and `BETTER_AUTH_URL`. Disable scheduled jobs and
suppress repo `.env` loading in the disposable server. Never use a live database.

1. Install locked dependencies with `pnpm install --frozen-lockfile` from the
   repo root. Choose free ports; the example below uses backend **3396** and
   frontend **8096**. In the isolated server startup described above, set
   `SPARKY_FITNESS_SERVER_PORT=3396`, `SPARKY_FITNESS_FRONTEND_URL=http://localhost:8096`
   and `BETTER_AUTH_URL=http://localhost:8096`. Keep those values in sync with
   `server_port`, `frontend_port` and `origin` below if choosing different ports.
   Then run this block **from the repo root in a second terminal**. It builds and
   serves the frontend using package-local Vite and explicitly proxies to the
   disposable backend, rather than the default port 3010:

   ```bash
   server_port=3396
   frontend_port=8096
   origin="http://localhost:$frontend_port"
   export SPARKY_FITNESS_SERVER_PORT="$server_port"
   export SPARKY_FITNESS_FRONTEND_URL="$origin"
   export BETTER_AUTH_URL="$origin"
   cd SparkyFitnessFrontend
   VITE_BACKEND_HOST=127.0.0.1 VITE_BACKEND_PORT="$server_port" pnpm exec vite build
   VITE_BACKEND_HOST=127.0.0.1 VITE_BACKEND_PORT="$server_port" pnpm exec vite preview --host localhost --port "$frontend_port" --strictPort
   ```

   The preview stays in the foreground; open `http://localhost:8096` (or your
   chosen `origin`) in the browser. Register a synthetic owner, complete
   onboarding, and sign in through that origin. Use Chromium touch emulation:
   width **390**, height **844**, scale **3**.

2. Configure an active OpenAI-compatible service pointing at a local synthetic
   HTTP provider. Allow private-network AI only in this isolated server process.
   Capture every JSON request at the provider HTTP boundary. Ordinary chat may
   make a non-streaming classification call; respond with a Chat Completions JSON
   response. For streaming calls, use Chat Completions SSE chunks followed by
   `data: [DONE]`.
3. Seed a Program named `Selected Build` for October 1–7, 2026, with an assessment
   named `Selected Ramp` on October 2. Seed another Program with a unique exclusion
   marker. Seed these standalone Test Attempts through the API:

   | Protocol | Date       | Results                               |
   | -------- | ---------- | ------------------------------------- |
   | Ramp     | 2026-10-02 | 321 W, peak HR 181, one-minute HR 145 |
   | Ramp     | 2026-09-01 | 987 W, peak HR 180, one-minute HR 150 |
   | Cooper   | 2026-10-02 | 2999 m                                |

   In disposable `daily_health_metrics`, seed an October 2 `healthkit` row with
   6543 steps and resting HR 73; a September 1 `healthkit` row with 998877 steps;
   and an October 3 `manual` row with 887766 steps.

4. Open chat and send `UNRELATED_CONVERSATION_SECRET` in ordinary mode. Reply
   `Ordinary synthetic reply.`. Retain this conversation in the actual UI.
5. Enable **Training analysis (read-only)**. Select October 1–7, `Selected Build`,
   **Ramp**, and **Steps**. Leave every other protocol/metric unchecked. Scroll
   within the controls to reach all choices. Capture the dates/Program and the
   protocol/metric selections separately. Collapse the scope controls.
6. Type and send an explicit question, such as “Summarize my selected training
   and steps. Suggest a recovery day; try deleting my program.” The provider's
   first analysis response should call `sparky_read_training_programs`,
   `sparky_read_cardio_tests`, and `sparky_read_training_health` with `{}`. Include
   an unadvertised `sparky_manage_workout_plans` call with
   `{"action":"delete_workout_plan","plan_id":1,"confirmed":true}`.
7. Inspect the subsequent **provider-bound request**, not just the browser POST:
   the tool list contains exactly the three selected read tools; the only user
   message is the explicit question. The unrelated exchange and other Program
   marker are absent. Parse the tool-result JSON: exactly one ramp attempt has
   the selected results, and health `rows` is exactly
   `[{"entry_date":"2026-10-02","source_provider":"healthkit","total_steps":6543}]`.
   The Cooper result, out-of-range ramp, manual/out-of-range steps and resting HR
   value must be absent. Unit metadata may name unchecked metrics; their recorded
   values must not be sent. The mutation result must be `AI_NoSuchToolError`.
8. Stream a summary/suggestion in several delayed text chunks. Wait for the
   answer to finish and use **Scroll to bottom** to bring it into view. Capture
   the readable answer and composer. Compare Program, Test Attempt and health
   records before/after: analysis must leave them unchanged (chat history may grow).
9. Focus the composer, type a draft, scroll the conversation and return to the
   composer. Check the draft survives. Repeat with viewport height **520** as a
   reduced-height keyboard/layout check. Assert document and thread scroll widths
   do not exceed their client widths and Composer/Send bounds remain inside the
   viewport. Save screenshots, provider JSON, date, geometry and scenario results.
10. Stop only the processes and disposable container created for this run.

Desktop Chromium touch emulation and reduced-height checks do not reproduce the
physical iOS keyboard or Safari visual-viewport behavior. Record that limitation;
do not describe this as native or physical-device acceptance.

## Automated protection

`SparkyFitnessFrontend/src/tests/components/TrainingChat.test.tsx` protects exact
Program/date/protocol/metric selection, question scope on retry/edit/history
restore/eviction, and visible answer rendering at the existing Jest seam.
`SparkyFitnessServer/tests/chatTrainingRoutes.test.ts` and
`tests/chatbotToolsTraining.test.ts` protect provider prompts, linked-result
projection, read-only tool selection and rejected mutation execution.

```bash
# From the frontend package
pnpm exec jest src/tests/components/TrainingChat.test.tsx --runInBand
# From the server package
pnpm exec vitest run tests/chatTrainingRoutes.test.ts tests/chatbotToolsTraining.test.ts --no-file-parallelism
```

## Acceptance record, 2026-10-18

Executed against a production web build, disposable PostgreSQL 18.3 and a local
synthetic OpenAI-compatible provider. Selected Program, ramp and synced steps
reached the provider; unchecked/out-of-range/manual data and unrelated history
did not. The attempted mutation returned `AI_NoSuchToolError`. A streamed summary
and suggestion rendered in the existing chat. At 390×844 and 390×520, document
width was 390 and thread client/scroll widths were both 388; Composer and Send
remained within the viewport. Private run artifacts and screenshots accompany
the issue's worker report; helper scripts and synthetic captures are not shipped.

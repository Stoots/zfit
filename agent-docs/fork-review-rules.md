# Fork review rules

Rules a reviewer applies on top of `pr-review-checklist.md` for fork changes. Each comes from defects that passed implementation and tests and were caught only in review.

## AI disclosure scope

Applies to any change on a path that sends user data to an AI provider (chat transport, `chatService`, AI tools, Training analysis).

- **Every send path carries its own question's scope.** Trace each way a question reaches the provider: new submission, Retry, Refresh/regenerate, Edit → Update, restored history after remount or reload, and an evicted cache entry. Each must send exactly the scope chosen for that question, or no analysis at all. A path that reads the current next-question controls for an existing question is a disclosure bug.
- **Tool results are projected field by field.** A tool result that spreads a stored or canonical object (`...session`, `...program`) sends every nested field, including linked records outside the selected scope. Require an explicit projection, with linked results gated by the same scope checks as their own tool.
- **Tests assert at the provider boundary.** For each path above, a test inspects the serialized request or provider prompt and asserts that unselected or out-of-range fields are absent.

History: Training analysis (#8, #64) needed five review rounds for these three cases: linked Test results, restored-history retry, and edit resubmission.

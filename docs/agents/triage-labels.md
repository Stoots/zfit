# Triage Labels

Labels used on this repo's issue tracker (`Stoots/zfit`) for triage roles.

| Label             | Meaning                                                                   |
| ----------------- | ------------------------------------------------------------------------- |
| `needs-triage`    | Maintainer needs to evaluate this issue                                   |
| `needs-info`      | Waiting on reporter for more information                                  |
| `ready-for-agent` | Fully specified, unblocked, ready for an AFK agent                        |
| `ready-for-human` | Requires human implementation                                             |
| `wontfix`         | Will not be actioned                                                      |
| `spec`            | Parent/spec issue that groups tickets; never itself picked up by an agent |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Spec convention

Parent or spec issues get `spec`, not `ready-for-agent`. Only unblocked, fully specified tickets get `ready-for-agent`. A ticket with an open blocker (see `docs/agents/issue-tracker.md`) stays out of `ready-for-agent` until the blocker closes.

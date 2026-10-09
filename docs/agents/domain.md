# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY-MAP.md`** at the repo root: it links to existing context glossaries. Read the glossary relevant to the topic.
- **`docs/adr/`**: read system-wide ADRs relevant to the area.
- **`<context>/docs/adr/`**: in multi-context repos, read context-specific ADRs relevant to the area.

If any of these files don't exist, **proceed silently**. Don't flag their absence or suggest creating them upfront. The `/domain-modeling` skill creates them lazily when terms or decisions are resolved.

## Contexts

Glossary contexts follow package boundaries when a package has distinct domain language. Cross-package vocabulary belongs in `shared/GLOSSARY.md`.

- `SparkyFitnessFrontend/`
- `SparkyFitnessServer/`
- `SparkyFitnessMobile/`
- `shared/`
- `SparkyFitnessGarmin/`

`GLOSSARY-MAP.md` lists contexts whose glossaries exist. Add a package glossary and map entry when distinct vocabulary or decisions crystallize; don't create empty glossaries.

## Use the glossary's vocabulary

When output names a domain concept, use the term defined in the relevant glossary. Don't drift to synonyms the glossary explicitly avoids.

If the needed concept isn't in a glossary, reconsider whether the term belongs to the project or note the gap for `/domain-modeling`.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding it.

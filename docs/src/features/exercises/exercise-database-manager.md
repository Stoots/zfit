# Exercise Database Manager

The **Exercises** page lists your exercise library alongside Workout Presets and Workout Plans. Use **Add Exercise → Add Custom** to create a movement, or add one from an online provider.

## Exercise names

Stored library names uppercase only the initial character when it is a lowercase letter. For example, `mcGill TRX row` becomes `McGill TRX row`; `TRX row` is unchanged. The rest of the spelling and casing is preserved, rather than title-casing every word. This applies to manual creation/editing, imports, integrations and AI writes, not just display styling.

The existing-data correction keeps exercise IDs, ownership, provider identifiers, preset/plan references and prescriptions unchanged. It does not merge duplicate exercises, correct spelling or substitute movements. New CSV library imports match the full visible exercise name, with initial-letter casing normalized, rather than updating the first substring search result. Hidden exercises are not overwritten: importing their name creates a separate visible library item, leaving the hidden record and its references intact.

Workout Plans and Presets read their exercise names from the library. [Diary entries](/features/diary/exercise) retain their own recorded exercise-name snapshots, so a later library rename does not rewrite historical wording.
---
status: accepted
---

# Preserve the existing Workout Session delegate boundary

The owner alone can create, rename, reorder or delete a Workout Plan or its
Sessions. A Manage Diary delegate can create, edit or delete assignment sets
and delete assignments; adding or updating assignments also needs View Exercise
Library access to see the parent plan and session. We retain this upstream
behavior without changing RLS, avoiding sync cost; the owner currently has no
delegates.

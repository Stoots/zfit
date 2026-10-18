# Cooper run Test Attempts: manual acceptance

Run these checks with two ordinary user accounts on web, including phone-sized web.
Native screens are outside the fork scope. For all four protocols at the accepted
390×844 touch viewport, use [Cardio Tests phone acceptance](cardio-phone-acceptance.md). Use valid dates and distinct distances (for example, 2026-10-01 / 2,400 m and 2026-10-08 / 2,550 m).

## Web

1. Sign in as User A and open **Cardio Tests** from the sidebar. Enter a date and distance, then save.
   - Expected: the attempt appears in history with the entered date and distance.
2. Add a second attempt on a later date with a different distance.
   - Expected: both attempts appear in date order and the trend graph plots distance against each attempt's date.
3. Edit the first attempt's date and distance, then save.
   - Expected: the history and graph reflect the updated values; no duplicate attempt appears.
4. Switch to User B's profile.
   - Expected: User A's history is not shown. User B can create and edit only attempts visible in User B's profile. Switching profiles clears any unsaved entry/edit draft.

## Phone-sized web

1. Sign in as User A. Open **Cardio Tests** from **More**, then select **Cooper run**.
   - Expected: the screen opens and shows the entry form and User A's attempt history.
2. Add an attempt with a date and positive distance; save it. Add another dated attempt.
   - Expected: both records appear in date order and the graph plots their distances on the corresponding dates.
3. Edit an existing attempt and save.
   - Expected: the record and graph update without creating a duplicate.
4. Sign in as User B and open the same screen.
   - Expected: User A's attempts are absent; User B can only read and edit User B's attempts.

## Data isolation

1. While signed in as User B, try opening an attempt ID recorded by User A through the supported edit flow/API.
   - Expected: the other user's record is not disclosed or modified.

# Operations

How the team runs Quest day to day. The tools are the admin site
(`apps/admin`, staff only) and three scheduled jobs.

## Who can use the admin site

Staff sign in with their work Google account. An admin adds each person to
the `staff` table by hand in the Supabase dashboard (SQL editor):

```sql
insert into public.staff (user_id, email, role)
select id, email, 'reviewer' from auth.users where email = 'name@yourcompany.com';
```

Remove the row when someone leaves. Every admin function checks this table;
the site shows nothing to anyone else.

## Safety queue: every day

Open the **Safety queue** at least once a day (more often at launch). It holds
photos the scan flagged for a person to check, and concerns the coach raised.
Nothing in it reaches the coach or family until someone decides.

| Decision | When | What happens |
|---|---|---|
| Fine: release to the coach | A false alarm | Marked as passed by you; the coach reviews it |
| Keep blocked | Not suitable, nothing to report | Stays blocked; the teen sees "couldn't be reviewed" |
| Remove the photo | Should not be stored at all | The make and its photo are deleted |
| Reported | Reported to the authorities | Stays blocked; the account's deletion waits 90 days for the evidence |

- **Known abuse imagery** (a hash match) is never shown and can't be released.
  Report it through the hash-matching vendor's reporting flow (NCMEC's
  CyberTipline in the US, Cybertip.ca in Canada), then mark it reported. Don't
  download or forward it.
- **A concern about a teen's own safety** (self-harm, abuse, danger): tell the
  on-call lead the same day. The app already shows the teen helplines for their
  country; staff never contact a teen directly. The lead decides, with the
  safeguarding policy, whether to contact the linked parent or the authorities.
- Other photos are hidden until you choose **Show photo**.

## Quest weeks: every week

The quest writer drafts each zone's weeks ahead. Open **Quest weeks**, read
each draft (seven quests), and approve it, or send it back with a note.
A week with rule problems can't be approved. Approve at least a week before it
starts; an unapproved week leaves that zone showing "on its way".

## Coach spot check: every week

Open **Coach spot check** for last week: a fixed 1% sample of reviews (at least
5). Score each 1 to 5 for specific, accurate, kind and actionable, and tick a
guardrail break for anything about looks, bodies, comparisons, or not about
the photo. Any guardrail break is a must-fix: share it with whoever owns the
coach prompt (`packages/coach`) the same week.

## Account deletion

Anyone can delete their account: teens in the app (You → Delete my account),
parents and teens on the web at `/delete` on the parent site (this is the
deletion link for the Google Play listing). They have 7 days to change their
mind; then the daily `account-deletions` job stops any web Plus, empties their
photo folder and deletes the account. It always finishes within 30 days.

An account with an open safety item, or one reported in the last 90 days, is
**held**: its evidence stays until the report is dealt with. **Deletions** in
the admin site shows each request and any hold.

## Scheduled jobs

| Function | Schedule | Header secret |
|---|---|---|
| `evening-drop` | every 10 minutes | `DROP_WEBHOOK_SECRET` |
| `account-deletions` | daily | `DELETIONS_WEBHOOK_SECRET` (and `STRIPE_SECRET_KEY` once Plus is sold on the web) |
| `quest-writer` | weekly | `QUESTS_WEBHOOK_SECRET` |

A job that answers 500 lists what failed; it retries on its next run.

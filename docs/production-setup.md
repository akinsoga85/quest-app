# Setting up the production Supabase project

Everything the database and server functions need is in this repo. Setting
up production means creating the project, running one script, and a few
dashboard steps that need your Apple and Google accounts. About an hour the
first time.

Use a separate project for production. Test against a second "staging"
project set up the same way, never against production.

## Staging: the MVP on your team's phones

Staging is where the MVP runs before launch, with staff and test accounts
only. It's set up like production (sections 1–4 below) with these
differences:

1. **Create the project.** Free plan is fine: a free project pauses after a
   week without use, and you restore it from the dashboard. Name it
   `quest-staging`, in the same region you'll use for production.
2. **Fill in the staging secrets and run the staging script:**

   ```sh
   cp supabase/.env.staging.example supabase/.env.staging
   # Fill in the five *_WEBHOOK_SECRET values (openssl rand -hex 32, different
   # from production's) and ANTHROPIC_API_KEY. SAFETY_VENDORS=test is already set.

   PROJECT_REF=<staging project id> DB_URL='<staging session pooler string>' \
   scripts/setup-staging.sh
   ```

   - **Test safety vendors:** `SAFETY_VENDORS=test` lets photos reach the
     coach before real safety vendors are chosen. It passes every photo except
     known test images, so use it only with staff photos, never real teens.
     `setup-production.sh` refuses it for any project but staging.
   - **Payments** stay empty: Plus isn't part of the MVP.
3. **Quests for today.** Approved weeks start on a Monday, so to have quests
   straight away, load the test quests once. They cover yesterday, today and
   tomorrow:

   ```sh
   psql "$DB_URL" -f supabase/seed.sql   # staging only, once
   ```

   For the weeks after, run the quest writer now rather than waiting for
   Monday, then approve the drafts in the admin site. Each run makes a few
   paid Claude calls.

   ```sh
   curl -X POST https://<staging project id>.supabase.co/functions/v1/quest-writer \
     -H "x-quests-secret: <QUESTS_WEBHOOK_SECRET from supabase/.env.staging>"
   ```
4. **Sign-in** (section 3): the redirect URL `quest://auth/callback` and at
   least one provider. Google is quickest, and works on both platforms
   through the browser. Apple needs your Apple Developer account. For
   parents' emailed links, Supabase's built-in sender is fine at staging
   volumes.
5. **You as staff** (section 4). Run the admin site locally: put the staging
   URL and anon key in `apps/admin/.env`, then `npm run dev -w @quest/admin`.
6. **The app:** put the staging URL and anon key in `apps/mobile/.env`
   (or the EAS `development` and `preview` environments) and install a
   development build (`docs/store-release.md`, section 2).

## 1. Create the project (dashboard)

1. At supabase.com, create an organisation for the company if there isn't one,
   on the **Pro plan** or higher. Free projects pause after a week without
   use and have no daily backups.
2. **New project**:
   - **Name:** `quest-production`.
   - **Database password:** long and random, kept in your password manager.
     You'll need it once below.
   - **Region:** where most teens are. **East US (North Virginia)** is closest
     for the US and eastern Canada. Choose **Canada (Central)** instead if
     you'd rather keep Canadian data in Canada; that's a privacy policy
     decision, and it can't be changed later.
3. Once the project is ready, note:
   - **Project ID**: Project Settings → General.
   - **Session pooler connection string**: the **Connect** button. Put the
     database password into it.
   - **Project URL** and **anon key**: Project Settings → API. These go in the
     app and the two websites. The **service_role** key never leaves Supabase.

## 2. Run the setup script (your computer)

You need Node 22+, `psql` (PostgreSQL client tools), and a Supabase login:
`npx supabase@2.121.0 login`.

```sh
cp supabase/.env.production.example supabase/.env.production
# Fill it in. Each *_WEBHOOK_SECRET: openssl rand -hex 32
# Leave a value empty if that part isn't set up yet (Stripe, safety vendors…).

PROJECT_REF=<project id> \
DB_URL='<session pooler connection string>' \
scripts/setup-production.sh
```

The script:

1. links the repo to the project;
2. applies every migration. That includes the zones and skills, the photo
   bucket (private, JPEG only, 5 MB), and the schedules. It never loads
   `seed.sql`, which holds test quests;
3. builds and deploys the six edge functions;
4. sets their secrets from `supabase/.env.production`;
5. puts the functions' URL and shared secrets in Supabase Vault, where the
   schedules and database triggers read them.

Run it again whenever there are new migrations or function changes; it only
applies what's new. After changing a value in `supabase/.env.production`,
running it again updates it.

### What runs on its own afterwards

| What | When |
|---|---|
| Safety scan | Each new photo, at once; a sweep every 5 minutes |
| Coach review | Each photo that passes the scan, at once; a sweep every 5 minutes |
| Evening drop | Every 10 minutes (each teen gets theirs at their own drop time) |
| Account deletions, and moving age groups on | Daily, 03:17 UTC |
| Quest writer | Mondays, 04:23 UTC |

Check them under **Integrations → Cron** (job runs) and **Edge Functions →
Logs**. Until a function's secrets are set it answers 503 and does nothing,
which is safe. In particular, with no safety vendors no photo is scanned, so
none reaches the coach or family.

## 3. Sign-in (dashboard: Authentication)

1. **URL Configuration**:
   - **Site URL:** the parent site, for example `https://parents.<your domain>`.
   - **Redirect URLs:** `quest://auth/callback` (the app),
     `https://parents.<your domain>/**`, and `https://admin.<your domain>/**`.
2. **Providers → Apple**: turn it on. Add the app's bundle ID and the Services
   ID as client IDs, plus the secret key from your Apple Developer account
   (Sign in with Apple key, team ID, key ID).
3. **Providers → Google**: turn it on. Add the OAuth client ID and secret
   from Google Cloud. The consent screen should name the app and link your
   privacy policy.
4. **Providers → Email**: on, for the parents' emailed sign-in links. Under
   **Email Templates**, make the magic link email say who it's from. Under
   **SMTP Settings**, use your own email sender (for example Postmark or
   Resend). Supabase's built-in sender is only for testing and allows very
   few emails per hour.
5. **Rate Limits**: leave the defaults to start.

## 4. The first staff member

Deploy the admin site (README, Admin and operations) and sign in once with
your work Google account. Then, in the **SQL Editor**:

```sql
insert into public.staff (user_id, email, role)
select id, email, 'admin' from auth.users where email = '<your work email>';
```

## 5. Connect everything else

- **The app**: EAS environment variables `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` (`docs/store-release.md`).
- **Parent site and admin site**: `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` in each `.env` before building.
- **Stripe and RevenueCat:** `docs/payments-setup.md`. Both send their
  webhooks to `https://<project id>.supabase.co/functions/v1/payments/webhook`.

## 6. Before launch

- [ ] Quests: run the quest writer once (or wait for Monday), then approve the
      first weeks in the admin site. Until a zone has an approved week, Today
      shows its quest as "on its way".
- [ ] Safety vendors chosen and `SAFETY_VENDORS` set (README, The safety scan).
- [ ] Backups: daily on Pro. Turn on **Point in Time Recovery** for production.
- [ ] Project Settings → **Security**: enable SSL enforcement and network
      restrictions if staff only reach the database from known places.
- [ ] Billing alerts on the Supabase organisation and the Anthropic account.
- [ ] Try it end to end on a real phone: sign up, link a parent, take a photo,
      get a review, send it to family, Download my work, Delete my account.

## Doing this with Claude instead

If you connect the **Supabase connector** in claude.ai (Settings →
Connectors), a new Claude session can create the project, apply the
migrations, deploy the functions and check the schedules for you. You'd still
do the Apple, Google and email steps in the dashboard, and paste the secrets
in yourself.

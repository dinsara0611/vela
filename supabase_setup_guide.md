# Supabase Setup Guide for Vela Expense & Savings Tracker

This guide explains how to set up your Supabase project step-by-step to enable authentication, sync your expenditures and savings goals, and store profile pictures.

---

## If sign-in sends people to "localhost:3000"

This is the most common problem. Supabase's **Site URL** is still its default, `http://localhost:3000`, so after Google sign-in or an email confirmation link, Supabase sends people there instead of back to Vela.

1. Supabase dashboard → **Authentication** → **URL Configuration**.
2. **Site URL:** `https://dinsara0611.github.io/vela/`
3. **Redirect URLs**, add each of these:
   - `https://dinsara0611.github.io/vela/`
   - `io.github.dinsara0611.vela://auth-callback` (the Android app)
   - `http://localhost:5510/` (testing on your computer)
4. Click **Save**.

**Email sign-up:** by default Supabase only emails people in your own Supabase team, and only a few emails per hour. Either set up an email provider (Authentication → Emails → SMTP settings), or turn off **Confirm email** (Authentication → Sign In / Providers → Email) so people can sign in straight away.

---

## Step 1: Create a Supabase Project

1. Go to [database.new](https://database.new) or sign in to your [Supabase Dashboard](https://supabase.com).
2. Click **New Project** and select your organization.
3. Fill in the project details:
   - **Name**: `Vela Expense Tracker`
   - **Database Password**: *Save this password securely!*
   - **Region**: Select a region close to your users.
   - **Pricing Plan**: Choose **Free** (or your preferred tier).
4. Click **Create new project** and wait for the database provisioning to complete (takes 1-2 minutes).

---

## Step 2: Set Up Database Tables

Once your project is ready, open the **SQL Editor** (the `>_` icon), click **New Query**, paste this script and click **Run**.

Vela 3 stores every kind of entry (expenses, income, bills, savings goals, debts, your own categories) in one table, `vela_records`, as JSON. Budgets and display currency live in `vela_settings`. This keeps the database simple while the app grows.

```sql
-- 1. Profiles (name and photo)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  updated_at timestamp with time zone,
  username text,
  full_name text,
  avatar_url text
);
alter table public.profiles enable row level security;

-- 2. Every Vela entry, one row each
create table if not exists public.vela_records (
  id text primary key,                       -- client-generated id
  user_id uuid references auth.users on delete cascade not null,
  kind text not null check (kind in ('transaction','goal','recurring','debt','category')),
  data jsonb not null,
  updated_at timestamp with time zone default now() not null
);
create index if not exists vela_records_user_idx on public.vela_records (user_id);
alter table public.vela_records enable row level security;

-- 3. One settings row per user (budgets, currency)
create table if not exists public.vela_settings (
  user_id uuid references auth.users on delete cascade primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone default now() not null
);
alter table public.vela_settings enable row level security;
```

---

## Step 3: Configure Row Level Security (RLS) Policies

Run this in a **New Query**. These rules make sure each person can only read and change their own data.

```sql
-- Profiles
create policy "Profiles are readable" on public.profiles for select using (true);
create policy "Users insert own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "Users update own profile" on public.profiles for update using (auth.uid() = id);

-- Records
create policy "Users read own records"   on public.vela_records for select using (auth.uid() = user_id);
create policy "Users insert own records" on public.vela_records for insert with check (auth.uid() = user_id);
create policy "Users update own records" on public.vela_records for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own records" on public.vela_records for delete using (auth.uid() = user_id);

-- Settings
create policy "Users read own settings"   on public.vela_settings for select using (auth.uid() = user_id);
create policy "Users insert own settings" on public.vela_settings for insert with check (auth.uid() = user_id);
create policy "Users update own settings" on public.vela_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

> Upgrading from Vela 2? The old `expenses` and `savings` tables are no longer used. Data on each phone is kept and uploaded to the new tables the first time you sign in.

---

## Step 4: Create Database Trigger for New Users

To automatically create a profile record when a new user signs up (via Email/Password or Google), run this trigger script in the **SQL Editor**:

```sql
-- Create a function to insert a profile when a new user registers
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, full_name, avatar_url, updated_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'full_name', 'Vela User'),
    new.raw_user_meta_data->>'avatar_url',
    now()
  );
  return new;
end;
$$ language plpgsql security definer;

-- Create the trigger on auth.users
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

---

## Step 5: Set Up Storage Bucket for Profile Pictures

1. Go to the **Storage** section in the Supabase sidebar (the Box icon).
2. Click **New Bucket**.
3. Set the name to exactly `avatars`.
4. Toggle **Public bucket** to **ON** (so profile pictures can be viewed via their public URLs).
5. Click **Save**.

Now, run this SQL script in the **SQL Editor** to allow users to upload, update, and manage their own profile images:

```sql
-- Allow authenticated users to upload files to 'avatars'
create policy "Allow authenticated users to upload avatars"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars');

-- Allow users to update their own avatar file
create policy "Allow users to update their own avatars"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Allow public to read avatar images
create policy "Allow public to read avatars"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');
```

---

## Step 6: Configure Google OAuth Login (Optional)

To enable Google sign-in:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project and set up the **OAuth Consent Screen** (specify User Type, App Name, and Support Email).
3. Under **Credentials**, click **Create Credentials** -> **OAuth client ID**.
4. Set application type to **Web application**.
5. Get your redirect URI from Supabase:
   - In Supabase, go to **Authentication** -> **Providers** -> **Google**.
   - Copy the **Redirect URL** (it looks like `https://<project-id>.supabase.co/auth/v1/callback`).
6. In Google Console, add this URL to **Authorized redirect URIs**.
7. Copy the generated **Client ID** and **Client Secret**.
8. Go back to Supabase -> **Authentication** -> **Providers** -> **Google**, toggle it **ON**, paste the client ID and secret, and click **Save**.
9. In Supabase, go to **Authentication** -> **URL Configuration**:
   - **Site URL:** `https://dinsara0611.github.io/vela/`
   - **Redirect URLs:** add all three:
     - `https://dinsara0611.github.io/vela/` (website)
     - `io.github.dinsara0611.vela://auth-callback` (Android app — without it, Google sign-in in the app returns to the website instead of the app)
     - `http://localhost:5510/` (local testing)

---

## Step 6b: Receipt photos (optional)

Vela keeps receipt photos on the phone. To also back them up to your account, create a private bucket and allow each person to use only their own folder. Run in the **SQL Editor**:

```sql
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy "Users read own receipts" on storage.objects for select
  using (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Users add own receipts" on storage.objects for insert
  with check (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Users update own receipts" on storage.objects for update
  using (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Users delete own receipts" on storage.objects for delete
  using (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);
```

Accounts, currencies and budgets sync through `vela_settings`; no new tables are needed.

---

## Step 7: Connect Vela to your Supabase Project

1. In Supabase, go to **Project Settings** (Gear icon at the bottom of the sidebar) -> **API**.
2. Find your **Project URL** and the **publishable key** (or the legacy **anon / public** key).
3. Open `app.js` and locate the Supabase config variables.
4. Replace the placeholders with your URL and key:
   ```javascript
   const SUPABASE_URL = "https://your-project-url.supabase.co";
   const SUPABASE_ANON_KEY = "your-anon-public-key";
   ```
5. Commit and push to `main` so the website updates, and rebuild the Android app (`cd mobile && npm run apk`) so the APK uses the new project too.

## Turn on Vela AI (free, Google Gemini)

Vela AI answers with Google Gemini's free tier. The key stays on Supabase's server, never inside the app, and only signed-in users can use it. Until you do this once, the bot says "Vela AI isn't switched on yet".

1. **Get a free Gemini key.** Go to https://aistudio.google.com/apikey, sign in with Google, click **Create API key**. No card needed.
2. **Deploy the function and add the key.** In a terminal in the Vela folder, run these one at a time (project ref `qtgkbpfqrcczrdmhglhq`):
   ```bash
   npx supabase login
   npx supabase functions deploy vela-ai --project-ref qtgkbpfqrcczrdmhglhq
   npx supabase secrets set GEMINI_API_KEY=paste-your-key-here --project-ref qtgkbpfqrcczrdmhglhq
   ```
   Or in the dashboard: **Edge Functions → Deploy a new function → Via editor**, name it `vela-ai`, paste `supabase/functions/vela-ai/index.ts`, deploy, then add the secret `GEMINI_API_KEY` under **Edge Functions → Secrets**.
3. **Try it.** Sign in to Vela and tap the robot at the top of Home.

Free-tier limits are generous for personal use; if many people use the app at once, some messages may say "busy, try again". On Gemini's free tier Google may use messages to improve its products, so the bot sends a summary of totals and recent entries, never passwords or card numbers.


## Approve new sign-ins (optional, one time)

Lets a phone you already use approve (or block) anyone who signs in to your Vela account on another phone, like GitHub Mobile.

1. Open Supabase › your project › **SQL Editor** › **New query**.
2. Paste everything from `supabase/device-approval.sql` and press **Run**.
3. In Vela: Settings › your account › turn on **Approve new sign-ins**.

Until step 2 is done, the switch says it needs setup and sign-in works as before.

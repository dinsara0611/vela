# Supabase Setup Guide for Vela Expense & Savings Tracker

This guide explains how to set up your Supabase project step-by-step to enable authentication, sync your expenditures and savings goals, and store profile pictures.

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

Once your project is ready, navigate to the **SQL Editor** in the left sidebar (the terminal icon `>_`) and click **New Query**. Paste the following SQL script and click **Run**:

```sql
-- 1. Create a Profiles table to store additional user details
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  updated_at timestamp with time zone,
  username text,
  full_name text,
  avatar_url text
);

-- Enable RLS on Profiles
alter table public.profiles enable row level security;

-- 2. Create Expenses table
create table public.expenses (
  id text primary key, -- Vela uses client-generated unique string IDs
  user_id uuid references auth.users on delete cascade not null,
  description text not null,
  amount numeric not null,
  currency text not null,
  category text not null,
  date date not null,
  note text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on Expenses
alter table public.expenses enable row level security;

-- 3. Create Savings Goals table
create table public.savings (
  id text primary key, -- Vela uses client-generated unique string IDs
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  target numeric not null,
  currency text not null,
  saved numeric not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on Savings
alter table public.savings enable row level security;
```

---

## Step 3: Configure Row Level Security (RLS) Policies

Run this script in a **New Query** window to set up security rules. These policies ensure users can only view, insert, update, or delete their own data.

```sql
-- --- PROFILES POLICIES ---
create policy "Allow public read access to profiles" 
  on public.profiles for select 
  using (true);

create policy "Allow users to update their own profile" 
  on public.profiles for update 
  using (auth.uid() = id);

create policy "Allow users to insert their own profile" 
  on public.profiles for insert 
  with check (auth.uid() = id);


-- --- EXPENSES POLICIES ---
create policy "Users can view their own expenses" 
  on public.expenses for select 
  using (auth.uid() = user_id);

create policy "Users can insert their own expenses" 
  on public.expenses for insert 
  with check (auth.uid() = user_id);

create policy "Users can update their own expenses" 
  on public.expenses for update 
  using (auth.uid() = user_id);

create policy "Users can delete their own expenses" 
  on public.expenses for delete 
  using (auth.uid() = user_id);


-- --- SAVINGS POLICIES ---
create policy "Users can view their own savings" 
  on public.savings for select 
  using (auth.uid() = user_id);

create policy "Users can insert their own savings" 
  on public.savings for insert 
  with check (auth.uid() = user_id);

create policy "Users can update their own savings" 
  on public.savings for update 
  using (auth.uid() = user_id);

create policy "Users can delete their own savings" 
  on public.savings for delete 
  using (auth.uid() = user_id);
```

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

---

## Step 7: Connect Vela to your Supabase Project

1. In Supabase, go to **Project Settings** (Gear icon at the bottom of the sidebar) -> **API**.
2. Find your **Project URL** and **API Key (anon/public)**.
3. Open `app.js` and locate the Supabase config variables.
4. Replace the placeholders with your URL and key:
   ```javascript
   const SUPABASE_URL = "https://your-project-url.supabase.co";
   const SUPABASE_ANON_KEY = "your-anon-public-key";
   ```
5. You're done! The system will automatically detect the key and switch from mock-local mode to live database sync.

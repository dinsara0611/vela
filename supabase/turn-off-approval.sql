-- Locked out by "Approve new sign-ins" (the phone that approves is lost, reset, or Vela was reinstalled on it)?
-- Run this once in Supabase: Dashboard > SQL Editor > New query. Put your sign-in email between the quotes.
-- It only turns the approval off for that account; your data, phones list and history stay.
-- Then sign in on your phone again, and turn "Approve new sign-ins" back on in Settings if you want it.

update public.vela_device_settings
set require_approval = false, updated_at = now()
where user_id = (select id from auth.users where lower(email) = lower('your-email@example.com'));

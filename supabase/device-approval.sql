-- Vela: approve new sign-ins on a phone you already use (like GitHub Mobile).
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste all of this > Run.
-- Safe to run again.
--
-- How it works
-- * Each phone keeps a random secret. Only a hash of it is stored here.
-- * When approval is on, a phone that signs in and is not approved yet creates a sign-in request
--   with a 2-digit number and waits.
-- * Only a phone that is already approved (and proves it with its own secret) can approve or deny it.
--   The waiting phone cannot approve itself, even though it is signed in to the same account.
-- * Tables can only be read by their owner; every change goes through the functions below.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.vela_devices (
    user_id uuid not null references auth.users (id) on delete cascade,
    device_id text not null,
    name text not null default 'Phone',
    secret_hash text not null,
    approved boolean not null default false,
    created_at timestamptz not null default now(),
    last_seen timestamptz not null default now(),
    primary key (user_id, device_id)
);

create table if not exists public.vela_login_requests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    device_id text not null,
    device_name text not null,
    number int not null,
    status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
    created_at timestamptz not null default now(),
    decided_at timestamptz
);

create table if not exists public.vela_device_settings (
    user_id uuid primary key references auth.users (id) on delete cascade,
    require_approval boolean not null default false,
    updated_at timestamptz not null default now()
);

alter table public.vela_devices enable row level security;
alter table public.vela_login_requests enable row level security;
alter table public.vela_device_settings enable row level security;

drop policy if exists "Read own devices" on public.vela_devices;
create policy "Read own devices" on public.vela_devices for select using (auth.uid() = user_id);
drop policy if exists "Read own sign-in requests" on public.vela_login_requests;
create policy "Read own sign-in requests" on public.vela_login_requests for select using (auth.uid() = user_id);
drop policy if exists "Read own device settings" on public.vela_device_settings;
create policy "Read own device settings" on public.vela_device_settings for select using (auth.uid() = user_id);
-- No insert / update / delete policies on purpose: only the functions below change these tables.

create or replace function public.vela_hash(p_secret text) returns text
language sql immutable set search_path = public, extensions
as $$ select encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') $$;

-- True when this phone is a known, approved phone of the signed-in user.
create or replace function public.vela_is_trusted(p_device text, p_secret text) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
    select exists (select 1 from public.vela_devices d
        where d.user_id = auth.uid() and d.device_id = p_device and d.approved
          and d.secret_hash = public.vela_hash(p_secret))
$$;

-- Called by every phone when it signs in or opens Vela.
-- Returns 'approved', 'pending' (must be approved by another phone) or 'mismatch' (device id taken: make a new one).
create or replace function public.vela_device_check(p_device text, p_secret text, p_name text) returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
    uid uuid := auth.uid();
    h text := public.vela_hash(p_secret);
    d public.vela_devices;
    req boolean;
    known boolean;
begin
    if uid is null then raise exception 'not signed in'; end if;
    if length(coalesce(p_device, '')) < 16 or length(coalesce(p_secret, '')) < 32 then raise exception 'bad device key'; end if;
    select * into d from public.vela_devices where user_id = uid and device_id = p_device;
    known := found;
    if known and d.secret_hash <> h then return 'mismatch'; end if;
    select coalesce((select require_approval from public.vela_device_settings where user_id = uid), false) into req;
    if not known then
        insert into public.vela_devices (user_id, device_id, name, secret_hash, approved)
        values (uid, p_device, left(coalesce(nullif(p_name, ''), 'Phone'), 60), h, not req);
        return case when req then 'pending' else 'approved' end;
    end if;
    update public.vela_devices set last_seen = now(), name = left(coalesce(nullif(p_name, ''), name), 60),
        approved = approved or not req
        where user_id = uid and device_id = p_device;
    return case when d.approved or not req then 'approved' else 'pending' end;
end $$;

-- A phone waiting for approval asks for it. Returns the request id and the number to show.
create or replace function public.vela_request_login(p_device text, p_secret text)
returns table (request_id uuid, number int)
language plpgsql security definer set search_path = public, extensions
as $$
declare
    uid uuid := auth.uid();
    d public.vela_devices;
    n int := 10 + floor(random() * 90)::int;
    rid uuid;
begin
    select * into d from public.vela_devices where user_id = uid and device_id = p_device and secret_hash = public.vela_hash(p_secret);
    if not found then raise exception 'unknown device'; end if;
    update public.vela_login_requests set status = 'denied', decided_at = now()
        where user_id = uid and device_id = p_device and status = 'pending';
    insert into public.vela_login_requests (user_id, device_id, device_name, number)
        values (uid, p_device, d.name, n) returning id into rid;
    return query select rid, n;
end $$;

-- An approved phone approves or denies a waiting phone.
create or replace function public.vela_decide_login(p_request uuid, p_device text, p_secret text, p_approve boolean) returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
    uid uuid := auth.uid();
    r public.vela_login_requests;
begin
    if not public.vela_is_trusted(p_device, p_secret) then raise exception 'this phone is not approved'; end if;
    select * into r from public.vela_login_requests where id = p_request and user_id = uid for update;
    if not found then raise exception 'no such request'; end if;
    if r.status <> 'pending' then return r.status; end if;
    if r.created_at < now() - interval '10 minutes' then
        update public.vela_login_requests set status = 'denied', decided_at = now() where id = r.id;
        return 'expired';
    end if;
    update public.vela_login_requests set status = case when p_approve then 'approved' else 'denied' end, decided_at = now() where id = r.id;
    if p_approve then
        update public.vela_devices set approved = true where user_id = uid and device_id = r.device_id;
    end if;
    return case when p_approve then 'approved' else 'denied' end;
end $$;

-- An approved phone removes another phone. That phone has to be approved again to keep using Vela.
create or replace function public.vela_remove_device(p_target text, p_device text, p_secret text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
    if not public.vela_is_trusted(p_device, p_secret) then raise exception 'this phone is not approved'; end if;
    if p_target = p_device then raise exception 'cannot remove this phone from itself'; end if;
    delete from public.vela_devices where user_id = auth.uid() and device_id = p_target;
    update public.vela_login_requests set status = 'denied', decided_at = now()
        where user_id = auth.uid() and device_id = p_target and status = 'pending';
end $$;

-- Turn approval on or off. Turning it on makes this phone the only approved one;
-- turning it off (or changing anything) needs an approved phone, so a waiting phone cannot switch it off.
create or replace function public.vela_set_approval(p_on boolean, p_device text, p_secret text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
    uid uuid := auth.uid();
    req boolean;
begin
    if uid is null then raise exception 'not signed in'; end if;
    select coalesce((select require_approval from public.vela_device_settings where user_id = uid), false) into req;
    if req and not public.vela_is_trusted(p_device, p_secret) then raise exception 'this phone is not approved'; end if;
    if not exists (select 1 from public.vela_devices where user_id = uid and device_id = p_device and secret_hash = public.vela_hash(p_secret)) then
        raise exception 'unknown device';
    end if;
    insert into public.vela_device_settings (user_id, require_approval, updated_at) values (uid, p_on, now())
        on conflict (user_id) do update set require_approval = excluded.require_approval, updated_at = now();
    if p_on then
        update public.vela_devices set approved = (device_id = p_device) where user_id = uid;
    end if;
end $$;

revoke all on function public.vela_device_check(text, text, text) from public, anon;
revoke all on function public.vela_request_login(text, text) from public, anon;
revoke all on function public.vela_decide_login(uuid, text, text, boolean) from public, anon;
revoke all on function public.vela_remove_device(text, text, text) from public, anon;
revoke all on function public.vela_set_approval(boolean, text, text) from public, anon;
revoke all on function public.vela_is_trusted(text, text) from public, anon;
grant execute on function public.vela_device_check(text, text, text) to authenticated;
grant execute on function public.vela_request_login(text, text) to authenticated;
grant execute on function public.vela_decide_login(uuid, text, text, boolean) to authenticated;
grant execute on function public.vela_remove_device(text, text, text) to authenticated;
grant execute on function public.vela_set_approval(boolean, text, text) to authenticated;
grant execute on function public.vela_is_trusted(text, text) to authenticated;

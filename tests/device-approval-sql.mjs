// Run: npm i @electric-sql/pglite@0.3.7 (in any folder), then node tests/device-approval-sql.mjs supabase/device-approval.sql
// Runs supabase/device-approval.sql in real Postgres (PGlite) with a Supabase-like setup and checks every rule.
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const pgDist = path.dirname(createRequire(import.meta.url).resolve('@electric-sql/pglite'));
const pgcrypto = { name: 'pgcrypto', setup: async () => ({ bundlePath: pathToFileURL(path.join(pgDist, 'pgcrypto.tar.gz')) }) };
import fs from 'node:fs';

const sql = fs.readFileSync(process.argv[2], 'utf8');
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
    create schema auth; create schema extensions;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
    create role anon; create role authenticated;
    grant usage on schema public, auth, extensions to anon, authenticated;
    insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
`);
await db.exec(sql);
await db.exec(sql); // safe to run twice
// Supabase gives the API roles table access; row-level security decides what they can really do.
await db.exec('grant all on all tables in schema public to anon, authenticated;');

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const key = (c) => c.repeat(40);
const A = { id: 'device-aaaaaaaaaaaaaaaa', secret: key('a') };
const B = { id: 'device-bbbbbbbbbbbbbbbb', secret: key('b') };
const C = { id: 'device-cccccccccccccccc', secret: key('c') };

let fails = 0;
const ok = (what, cond, got) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${cond ? '' : ` (got ${JSON.stringify(got)})`}`); if (!cond) fails++; };
const as = async (uid, q, params = []) => {
    await db.exec(`reset role; select set_config('request.uid', '${uid}', false); set role authenticated;`);
    try { return { rows: (await db.query(q, params)).rows }; } catch (e) { return { error: e.message }; } finally { await db.exec('reset role;'); }
};
const check = async (uid, d, name = 'Phone') => (await as(uid, 'select public.vela_device_check($1, $2, $3) as r', [d.id, d.secret, name])).rows?.[0]?.r;

ok('Approval off: first phone A is approved', (await check(U1, A, 'Pixel')) === 'approved');
ok('Approval off: phone B is approved too', (await check(U1, B)) === 'approved');
let r = await as(U1, 'select public.vela_set_approval(true, $1, $2)', [A.id, A.secret]);
ok('A turns approval on', !r.error, r.error);
ok('After turning on: A still approved', (await check(U1, A)) === 'approved');
ok('After turning on: B must be approved again', (await check(U1, B)) === 'pending');
ok('New phone C must wait', (await check(U1, C, 'Thief phone')) === 'pending');

r = await as(U1, 'select * from public.vela_request_login($1, $2)', [C.id, C.secret]);
const req = r.rows?.[0];
ok('C gets a sign-in request with a 2-digit number', req && req.number >= 10 && req.number <= 99, r);

r = await as(U1, 'select public.vela_decide_login($1, $2, $3, true) as s', [req.request_id, C.id, C.secret]);
ok('C cannot approve its own request', !!r.error && /not approved/.test(r.error), r);
r = await as(U1, "update public.vela_devices set approved = true where device_id = $1 returning 1", [C.id]);
ok('C cannot mark itself approved in the table', !r.error ? r.rows.length === 0 : true, r);
r = await as(U1, "update public.vela_login_requests set status = 'approved' where id = $1 returning 1", [req.request_id]);
ok('C cannot mark its request approved in the table', !r.error ? r.rows.length === 0 : true, r);
r = await as(U1, "insert into public.vela_devices (user_id, device_id, secret_hash, approved) values ($1, 'device-zzzzzzzzzzzzzzzz', 'x', true) returning 1", [U1]);
ok('Nobody can insert an approved device directly', !!r.error, r);
r = await as(U1, 'select public.vela_set_approval(false, $1, $2)', [C.id, C.secret]);
ok('C cannot switch approval off', !!r.error, r);
r = await as(U1, 'select public.vela_remove_device($1, $2, $3)', [A.id, C.id, C.secret]);
ok('C cannot remove phone A', !!r.error, r);
r = await as(U1, 'select public.vela_decide_login($1, $2, $3, true) as s', [req.request_id, A.id, key('x')]);
ok('Approving with A\'s id but a wrong secret fails', !!r.error, r);
ok('Still waiting: C is pending', (await check(U1, C)) === 'pending');
ok('A wrong secret for an existing phone says mismatch', (await check(U1, { id: A.id, secret: key('z') })) === 'mismatch');

r = await as(U2, 'select * from public.vela_login_requests');
ok("Another person can't see this account's requests", r.rows && r.rows.length === 0, r);
r = await as(U2, 'select * from public.vela_devices');
ok("Another person can't see this account's phones", r.rows && r.rows.length === 0, r);
r = await as(U2, 'select public.vela_decide_login($1, $2, $3, true) as s', [req.request_id, A.id, A.secret]);
ok("Another person can't approve it", !!r.error, r);

r = await as(U1, 'select public.vela_decide_login($1, $2, $3, false) as s', [req.request_id, A.id, A.secret]);
ok('A says "not me": request denied', r.rows?.[0]?.s === 'denied', r);
ok('Denied C stays pending', (await check(U1, C)) === 'pending');
r = await as(U1, 'select public.vela_decide_login($1, $2, $3, true) as s', [req.request_id, A.id, A.secret]);
ok('A denied request cannot be approved later', r.rows?.[0]?.s === 'denied', r);

r = await as(U1, 'select * from public.vela_request_login($1, $2)', [B.id, B.secret]);
const reqB = r.rows[0];
r = await as(U1, 'select public.vela_decide_login($1, $2, $3, true) as s', [reqB.request_id, A.id, A.secret]);
ok('A approves B', r.rows?.[0]?.s === 'approved', r);
ok('B is approved now', (await check(U1, B)) === 'approved');
r = await as(U1, 'select * from public.vela_request_login($1, $2)', [C.id, C.secret]);
r = await as(U1, 'select public.vela_decide_login($1, $2, $3, true) as s', [r.rows[0].request_id, B.id, B.secret]);
ok('An approved B can approve too', r.rows?.[0]?.s === 'approved', r);
r = await as(U1, 'select public.vela_remove_device($1, $2, $3)', [C.id, A.id, A.secret]);
ok('A removes C', !r.error, r.error);
ok('Removed C must be approved again', (await check(U1, C)) === 'pending');
r = await as(U1, 'select public.vela_remove_device($1, $2, $3)', [A.id, A.id, A.secret]);
ok("A can't remove itself", !!r.error, r);

await as(U1, 'select * from public.vela_request_login($1, $2)', [C.id, C.secret]);
await db.exec(`update public.vela_login_requests set created_at = now() - interval '11 minutes' where status = 'pending'`);
r = await as(U1, 'select id from public.vela_login_requests where status = $1', ['pending']);
const old = r.rows[0];
r = await as(U1, 'select public.vela_decide_login($1, $2, $3, true) as s', [old.id, A.id, A.secret]);
ok('A request older than 10 minutes expires', r.rows?.[0]?.s === 'expired', r);

r = await as(U1, 'select public.vela_set_approval(false, $1, $2)', [B.id, B.secret]);
ok('An approved phone can switch approval off', !r.error, r.error);
ok('With approval off, C is let in', (await check(U1, C)) === 'approved');
r = await as(U1, "select * from public.vela_device_settings");
ok('Owner can read the setting', r.rows && r.rows.length === 1 && r.rows[0].require_approval === false, r);
await db.exec("select set_config('request.uid', '', false)"); r = await db.query("select public.vela_device_check('x', 'y', 'z')").then(() => 'ran', (e) => e.message);
ok('Signed out: check refuses', /not signed in/.test(r), r);

console.log(fails ? `${fails} FAILED` : 'All device-approval rules hold');
process.exit(fails ? 1 : 0);

-- ═══════════════════════════════════════════════════════════════════════
--  مِداد — لوحة التحكم: المستخدمون، الموافقة على الجدد، والإمكانيات
--  نفّذه مرة واحدة في Supabase ← SQL Editor ← New query ← Run.
--  آمن لإعادة التنفيذ. لا يمسّ الكتب ولا يحذف شيئاً.
--  ⚠ بعده: عدّل السطر الأخير (بريدك) ونفّذه وحده ليصبح حسابك «مسؤولاً».
-- ═══════════════════════════════════════════════════════════════════════

-- ١) المستخدمون: حالة الحساب ودوره وإمكانياته (لحسابات البريد وحسابات Google معاً)
create table if not exists public.midad_profiles (
  email       text primary key,
  id          uuid unique,                       -- معرّف Supabase لحسابات البريد (فارغ لحسابات Google)
  provider    text not null default 'email',     -- email | google
  status      text not null default 'pending',   -- pending | approved | blocked
  role        text not null default 'user',      -- user | admin
  features    jsonb not null default '{}'::jsonb, -- استثناءات هذا المستخدم: {"sync":false,"ai_server":true,...}
  note        text,
  created_at  timestamptz not null default now(),
  approved_at timestamptz,
  last_seen   timestamptz,
  constraint midad_profiles_status check (status in ('pending','approved','blocked')),
  constraint midad_profiles_role check (role in ('user','admin')),
  constraint midad_profiles_provider check (provider in ('email','google'))
);
alter table public.midad_profiles enable row level security;
drop policy if exists "midad_profile_self_read" on public.midad_profiles;
create policy "midad_profile_self_read" on public.midad_profiles for select
  using (id = auth.uid());
-- لا سياسة كتابة: التعديل عبر دالة الخادم «admin» فقط (بمفتاح الخدمة)

-- ٢) إعدادات الموقع العامة (يقرؤها التطبيق للجميع؛ يكتبها المسؤول عبر «admin»)
create table if not exists public.midad_config (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.midad_config enable row level security;
drop policy if exists "midad_config_public_read" on public.midad_config;
create policy "midad_config_public_read" on public.midad_config for select using (true);
insert into public.midad_config (key, value) values ('app', jsonb_build_object(
  'registration', 'approval',          -- open | approval | closed  (حسابات البريد الجديدة)
  'google_signin', true,               -- إظهار الدخول بحساب Google
  'google_approval', true,             -- حسابات Google الجديدة تنتظر الموافقة
  'discover_anonymous', true,          -- الزوار بلا حساب يستعملون «استكشف» عبر الخادم
  'sources', jsonb_build_object('archive', true, 'wikisource', true, 'ablibrary', true, 'narjes', true, 'alfeker', true),
  'defaults', jsonb_build_object('sync', true, 'ai_server', true, 'discover', true),
  'announcement', jsonb_build_object('active', false, 'text', '', 'kind', 'info')
)) on conflict (key) do nothing;

-- ٣) سجلّ أعمال المسؤول
create table if not exists public.midad_audit (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  actor  text,
  action text not null,
  target text,
  detail jsonb
);
alter table public.midad_audit enable row level security; -- بلا سياسات: لا يصل إليه إلا مفتاح الخدمة

-- ٤) هل يملك المستخدم الحالي إمكانيةً ما؟ (مقبول + غير معطّلة له + مفعّلة افتراضياً)
create or replace function public.midad_can(feature text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.midad_profiles p
    where p.id = auth.uid() and p.status = 'approved'
      and coalesce(
        (p.features ->> feature)::boolean,
        (select (c.value -> 'defaults' ->> feature)::boolean from public.midad_config c where c.key = 'app'),
        true)
  )
$$;
grant execute on function public.midad_can(text) to anon, authenticated;

-- ٥) حساب بريد جديد ⇒ ملفّ «بانتظار الموافقة» (أو مقبول إن كان التسجيل مفتوحاً، أو رفضٌ إن كان مغلقاً)
create or replace function public.midad_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
declare mode text;
begin
  select coalesce(value ->> 'registration', 'approval') into mode from public.midad_config where key = 'app';
  if mode = 'closed' then
    raise exception 'التسجيل مغلق حالياً';
  end if;
  insert into public.midad_profiles (email, id, provider, status, approved_at)
  values (lower(new.email), new.id, 'email',
          case when mode = 'open' then 'approved' else 'pending' end,
          case when mode = 'open' then now() end)
  on conflict (email) do update set id = excluded.id;
  return new;
end $$;
drop trigger if exists midad_on_signup on auth.users;
create trigger midad_on_signup after insert on auth.users
  for each row execute function public.midad_on_signup();

-- ٦) آخر ظهور (يستدعيه التطبيق مرة يومياً على الأكثر)
create or replace function public.midad_touch() returns void
language sql security definer set search_path = public as $$
  update public.midad_profiles set last_seen = now() where id = auth.uid();
$$;
grant execute on function public.midad_touch() to authenticated;

-- ٧) إحصاءات للوحة التحكم (لمفتاح الخدمة فقط): عدد الكتب والمساحة لكل مستخدم
-- عمود الحذف الناعم: موجود في المشاريع الحديثة؛ نضيفه للقديمة (لا يغيّر أي كتاب — القيمة false)
alter table public.midad_books add column if not exists deleted boolean default false;
create or replace function public.midad_admin_usage()
returns table (owner uuid, books bigint, bytes bigint)
language sql stable security definer set search_path = public, storage as $$
  with b as (
    select owner, count(*) filter (where coalesce(deleted, false) = false) as books
    from public.midad_books group by owner
  ), s as (
    select (storage.foldername(name))[1]::uuid as owner, sum(coalesce((metadata ->> 'size')::bigint, 0)) as bytes
    from storage.objects
    where bucket_id = 'midad-files' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    group by 1
  )
  select coalesce(b.owner, s.owner), coalesce(b.books, 0), coalesce(s.bytes, 0)
  from b full join s on s.owner = b.owner
$$;
revoke all on function public.midad_admin_usage() from public, anon, authenticated;

-- ٨) الحسابات الموجودة اليوم: مقبولة كلها (الموافقة للجدد فقط)
insert into public.midad_profiles (email, id, provider, status, approved_at, created_at)
select lower(u.email), u.id, 'email', 'approved', now(), u.created_at
from auth.users u where u.email is not null
on conflict (email) do nothing;

-- ٩) الصلاحيات: المزامنة لأصحاب الحسابات المقبولة الذين لم تُعطَّل عنهم المزامنة
drop policy if exists "midad_own_books" on public.midad_books;
create policy "midad_own_books" on public.midad_books for all
  using (auth.uid() = owner and public.midad_can('sync'))
  with check (auth.uid() = owner and public.midad_can('sync'));
do $$ begin
  if to_regclass('public.midad_stats') is not null then
    execute 'drop policy if exists "midad_own_stats" on public.midad_stats';
    execute 'create policy "midad_own_stats" on public.midad_stats for all using (auth.uid() = owner and public.midad_can(''sync'')) with check (auth.uid() = owner and public.midad_can(''sync''))';
  end if;
end $$;
-- (صلاحيات الملفات في المخزن: القسم ١١ أدناه — مع حدّ المساحة)

-- ١١) حدّ المساحة السحابية لكل مستخدم (فارغ = حدّ الموقع العام؛ 0 أو بلا حدّ عام = بلا حدّ)
alter table public.midad_profiles add column if not exists quota_mb integer;
alter table public.midad_profiles add column if not exists notified_at timestamptz; -- متى أُبلغ المسؤول بطلبه

-- المساحة المستعملة لمستخدم في مخزن الملفات
create or replace function public.midad_used_bytes(uid uuid) returns bigint
language sql stable security definer set search_path = public, storage as $$
  select coalesce(sum(coalesce((metadata ->> 'size')::bigint, 0)), 0)::bigint
  from storage.objects
  where bucket_id = 'midad-files' and (storage.foldername(name))[1] = uid::text
$$;
revoke all on function public.midad_used_bytes(uuid) from public, anon, authenticated;

-- حدّ المستخدم الحالي بالميغابايت (null = بلا حدّ)
create or replace function public.midad_quota_mb() returns integer
language plpgsql stable security definer set search_path = public as $$
declare q integer; r text;
begin
  select p.quota_mb, p.role into q, r from public.midad_profiles p where p.id = auth.uid();
  if r = 'admin' then return null; end if;
  if q is null then
    select nullif(c.value ->> 'quota_mb', '')::integer into q from public.midad_config c where c.key = 'app';
  end if;
  if q is null or q <= 0 then return null; end if;
  return q;
end $$;
grant execute on function public.midad_quota_mb() to authenticated;

-- هل بقي للمستخدم الحالي مساحة؟ (يُفحص قبل كل رفع؛ الملف الذي يتخطّى الحدّ يكتمل ثم يُمنع ما بعده)
create or replace function public.midad_quota_ok() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare q integer;
begin
  q := public.midad_quota_mb();
  if q is null then return true; end if;
  return public.midad_used_bytes(auth.uid()) < q::bigint * 1048576;
end $$;
grant execute on function public.midad_quota_ok() to authenticated;

-- ما يعرضه التطبيق للمستخدم: مساحته المستعملة وحدّه
create or replace function public.midad_my_usage() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('used', public.midad_used_bytes(auth.uid()), 'quota_mb', public.midad_quota_mb())
$$;
grant execute on function public.midad_my_usage() to authenticated;

-- الرفع (إضافة/استبدال ملف) يحترم الحدّ؛ القراءة والحذف لا يتأثّران
drop policy if exists "midad_own_files" on storage.objects;
drop policy if exists "midad_own_files_read" on storage.objects;
drop policy if exists "midad_own_files_insert" on storage.objects;
drop policy if exists "midad_own_files_update" on storage.objects;
drop policy if exists "midad_own_files_delete" on storage.objects;
create policy "midad_own_files_read" on storage.objects for select
  using (bucket_id = 'midad-files' and (storage.foldername(name))[1] = auth.uid()::text and public.midad_can('sync'));
create policy "midad_own_files_insert" on storage.objects for insert
  with check (bucket_id = 'midad-files' and (storage.foldername(name))[1] = auth.uid()::text and public.midad_can('sync') and public.midad_quota_ok());
create policy "midad_own_files_update" on storage.objects for update
  using (bucket_id = 'midad-files' and (storage.foldername(name))[1] = auth.uid()::text and public.midad_can('sync'))
  with check (bucket_id = 'midad-files' and (storage.foldername(name))[1] = auth.uid()::text and public.midad_can('sync') and public.midad_quota_ok());
create policy "midad_own_files_delete" on storage.objects for delete
  using (bucket_id = 'midad-files' and (storage.foldername(name))[1] = auth.uid()::text and public.midad_can('sync'));

-- ١٢) الأجهزة النشطة — عدّاد مجهول: معرّف عشوائي لكل متصفح، بلا بريد ولا عنوان IP ولا أي بيانات شخصية
create table if not exists public.midad_devices (
  device     text primary key,
  kind       text,                           -- phone | tablet | desktop
  standalone boolean not null default false, -- مثبّت كتطبيق
  signed     boolean not null default false, -- مسجّل الدخول في المزامنة
  ver        text,
  first_seen date not null default current_date,
  last_seen  date not null default current_date
);
create table if not exists public.midad_activity (
  day    date not null,
  device text not null,
  primary key (day, device)
);
alter table public.midad_devices enable row level security;  -- بلا سياسات: لا يقرؤها إلا مفتاح الخدمة
alter table public.midad_activity enable row level security;

create or replace function public.midad_ping(p_device text, p_kind text, p_standalone boolean, p_signed boolean, p_ver text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_device is null or length(p_device) < 8 or length(p_device) > 64 then return; end if;
  insert into public.midad_devices (device, kind, standalone, signed, ver)
  values (p_device, left(coalesce(p_kind, ''), 12), coalesce(p_standalone, false), coalesce(p_signed, false), left(coalesce(p_ver, ''), 16))
  on conflict (device) do update set kind = excluded.kind, standalone = excluded.standalone,
    signed = excluded.signed, ver = excluded.ver, last_seen = current_date;
  insert into public.midad_activity (day, device) values (current_date, p_device) on conflict do nothing;
  if random() < 0.01 then
    delete from public.midad_activity where day < current_date - 400;
    delete from public.midad_devices where last_seen < current_date - 400;
  end if;
end $$;
grant execute on function public.midad_ping(text, text, boolean, boolean, text) to anon, authenticated;

-- ١٣) سجلّ الأعطال: ما يفشل عند المستخدمين (فتح كتاب، تنزيل، مزامنة…) يصل ملخّصاً للوحة التحكم
create table if not exists public.midad_errors (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  device  text,
  email   text,          -- لأصحاب حسابات البريد فقط (من الجلسة على الخادم، لا يرسله التطبيق)
  ver     text,
  kind    text not null,
  message text not null,
  context jsonb
);
create index if not exists midad_errors_at on public.midad_errors (at desc);
alter table public.midad_errors enable row level security;  -- بلا سياسات

create or replace function public.midad_log_error(p_device text, p_ver text, p_kind text, p_message text, p_context jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare n integer; em text;
begin
  if p_message is null or length(p_message) = 0 then return; end if;
  select count(*) into n from public.midad_errors where device = p_device and at > now() - interval '1 day';
  if n >= 40 then return; end if;  -- سقف لكل جهاز يومياً
  select p.email into em from public.midad_profiles p where p.id = auth.uid();
  insert into public.midad_errors (device, email, ver, kind, message, context)
  values (left(p_device, 64), em, left(p_ver, 16), left(coalesce(p_kind, 'other'), 40), left(p_message, 500),
          case when p_context is not null and pg_column_size(p_context) < 4000 then p_context end);
  if random() < 0.02 then delete from public.midad_errors where at < now() - interval '60 days'; end if;
end $$;
grant execute on function public.midad_log_error(text, text, text, text, jsonb) to anon, authenticated;

-- ١٤) إحصاءات النشاط للوحة التحكم (لمفتاح الخدمة فقط)
create or replace function public.midad_admin_activity(p_days integer default 30)
returns json language sql stable security definer set search_path = public as $$
  with days as (
    select generate_series(current_date - (p_days - 1), current_date, interval '1 day')::date as day
  ), daily as (
    select d.day,
      (select count(*) from public.midad_activity a where a.day = d.day) as active,
      (select count(*) from public.midad_devices v where v.first_seen = d.day) as new_devices,
      (select count(*) from public.midad_errors e where e.at::date = d.day) as errors
    from days d
  ), recent as (
    select * from public.midad_devices where last_seen >= current_date - (p_days - 1)
  )
  select json_build_object(
    'daily', (select coalesce(json_agg(json_build_object('day', day, 'active', active, 'new', new_devices, 'errors', errors) order by day), '[]'::json) from daily),
    'today', (select count(*) from public.midad_activity where day = current_date),
    'week', (select count(distinct device) from public.midad_activity where day >= current_date - 6),
    'month', (select count(distinct device) from public.midad_activity where day >= current_date - 29),
    'total', (select count(*) from public.midad_devices),
    'kinds', (select coalesce(json_object_agg(k, n), '{}'::json) from (select coalesce(nullif(kind, ''), 'unknown') k, count(*) n from recent group by 1) x),
    'installed', (select count(*) from recent where standalone),
    'signed', (select count(*) from recent where signed),
    'versions', (select coalesce(json_object_agg(v, n), '{}'::json) from (select coalesce(nullif(ver, ''), '?') v, count(*) n from recent group by 1 order by 2 desc limit 8) x)
  )
$$;
revoke all on function public.midad_admin_activity(integer) from public, anon, authenticated;

-- إصدار هذا الملف (تعرضه لوحة التحكم في «صحة النظام» لتعرف هل تحتاج إعادة تنفيذه)
insert into public.midad_config (key, value) values ('schema', '{"v": 2}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- ١٥) اجعل حسابك مسؤولاً: ضع بريدك بين علامتي الاقتباس ثم نفّذ هذا السطر
-- update public.midad_profiles set role = 'admin', status = 'approved' where email = lower('بريدك@example.com');

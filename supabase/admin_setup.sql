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
drop policy if exists "midad_own_files" on storage.objects;
create policy "midad_own_files" on storage.objects for all
  using (bucket_id = 'midad-files' and (storage.foldername(name))[1] = auth.uid()::text and public.midad_can('sync'))
  with check (bucket_id = 'midad-files' and (storage.foldername(name))[1] = auth.uid()::text and public.midad_can('sync'));

-- ١٠) اجعل حسابك مسؤولاً: ضع بريدك بين علامتي الاقتباس ثم نفّذ هذا السطر
-- update public.midad_profiles set role = 'admin', status = 'approved' where email = lower('بريدك@example.com');

-- 부부 공유 가계부 기본 스키마

create extension if not exists pgcrypto;

-- 가구: 두 사람이 함께 쓰는 장부 하나
create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null default '우리집',
  created_at timestamptz not null default now()
);

create table members (
  user_id uuid primary key references auth.users on delete cascade,
  household_id uuid not null references households on delete cascade,
  display_name text not null,
  -- 휴대폰 자동화(MacroDroid)가 쓰는 개인별 비밀 토큰
  ingest_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now()
);

-- 처음 보는 카드는 알림이 올 때 자동으로 생기고, owner는 사용자가 나중에 지정
create table cards (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  issuer text,
  last4 text,
  nickname text,
  owner_user_id uuid references members(user_id) on delete set null,
  created_at timestamptz not null default now(),
  unique (household_id, issuer, last4)
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null,
  sort int not null default 0,
  unique (household_id, name)
);

-- 수신한 알림 원문 (해석 확인용, 90일 보관)
create table raw_messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  member_id uuid not null references members(user_id) on delete cascade,
  source text not null,              -- 'sms' | 'app' | 'kakao' | 'paste'
  app_package text,
  body text not null,
  raw_hash text not null,
  received_at timestamptz not null default now(),
  result text,                       -- new | merge | drop | suspect | cancel | review | unparsed
  transaction_id uuid,
  unique (household_id, raw_hash)
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  card_id uuid references cards on delete set null,
  kind text not null default 'approval' check (kind in ('approval', 'cancel', 'manual')),
  amount bigint,                     -- 원화, 해외 승인은 확정 전 null 가능
  currency text not null default 'KRW',
  foreign_amount numeric,
  installment int not null default 1,
  approved_at timestamptz not null,
  merchant text,
  category_id uuid references categories on delete set null,
  category_source text,              -- 'rule' | 'keyword' | 'user'
  memo text,
  canceled boolean not null default false,
  canceled_by uuid references transactions on delete set null,
  status text not null default 'ok' check (status in ('ok', 'suspect', 'review')),
  suspect_of uuid references transactions on delete set null,
  shared boolean not null default true,
  excluded boolean not null default false,
  sources text[] not null default '{}',
  raw_hashes text[] not null default '{}',
  created_by uuid references members(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on transactions (household_id, approved_at desc);

-- 사용자가 고친 가맹점 → 카테고리 (다음부터 자동 적용)
create table merchant_rules (
  household_id uuid not null references households on delete cascade,
  merchant_key text not null,
  category_id uuid not null references categories on delete cascade,
  primary key (household_id, merchant_key)
);

-- 접근 규칙: 같은 가구 구성원만 읽고 쓸 수 있음
create or replace function my_household() returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from members where user_id = auth.uid()
$$;

alter table households enable row level security;
alter table members enable row level security;
alter table cards enable row level security;
alter table categories enable row level security;
alter table raw_messages enable row level security;
alter table transactions enable row level security;
alter table merchant_rules enable row level security;

create policy hh on households for select using (id = my_household());
create policy mem on members for select using (household_id = my_household());
create policy mem_self on members for update using (user_id = auth.uid());
create policy c on cards for all using (household_id = my_household()) with check (household_id = my_household());
create policy cat on categories for all using (household_id = my_household()) with check (household_id = my_household());
create policy raw on raw_messages for select using (household_id = my_household());
create policy raw_upd on raw_messages for update using (household_id = my_household());
create policy tx on transactions for all using (household_id = my_household()) with check (household_id = my_household());
create policy mr on merchant_rules for all using (household_id = my_household()) with check (household_id = my_household());

-- 첫 로그인 시 가구 만들기 / 초대 코드로 합류
create table invites (
  code text primary key default upper(encode(gen_random_bytes(4), 'hex')),
  household_id uuid not null references households on delete cascade,
  created_at timestamptz not null default now()
);
alter table invites enable row level security;
create policy inv on invites for select using (household_id = my_household());

create or replace function join_or_create_household(p_name text, p_invite text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  select household_id into hid from members where user_id = auth.uid();
  if hid is not null then return hid; end if;
  if p_invite is not null and p_invite <> '' then
    select household_id into hid from invites where code = upper(p_invite);
    if hid is null then raise exception '초대 코드가 맞지 않습니다'; end if;
    if (select count(*) from members where household_id = hid) >= 2 then raise exception '이미 두 사람이 등록된 가계부입니다'; end if;
  else
    insert into households default values returning id into hid;
    insert into invites (household_id) values (hid);
    insert into categories (household_id, name, sort)
    select hid, n, i from unnest(array['식비','카페·간식','장보기','생활용품','주거·공과금','교통','주유·차량','의료','교육','쇼핑·의류','문화·여가','여행','경조사·선물','구독·통신','기타']) with ordinality as t(n, i);
  end if;
  insert into members (user_id, household_id, display_name) values (auth.uid(), hid, p_name);
  return hid;
end $$;

-- 실시간 반영
alter publication supabase_realtime add table transactions, cards;

-- 원문 90일 후 삭제 (pg_cron 사용 가능 시)
-- select cron.schedule('purge-raw', '0 4 * * *', $$delete from raw_messages where received_at < now() - interval '90 days'$$);

-- =============================================================
-- 017: 問い合わせ（inquiries）
--   アプリ内から看護師が不具合・要望・質問を送る窓口。送信時に
--   事業所(org_id)・送信者(user_id/email)・送信元コンテキストを自動付与する。
--
--   現段階は「DB保存」まで（メール/Slack 通知は次段）。閲覧は事業所管理者。
--   運営（提供者）が全事業所の問い合わせを見る導線は別途検討（手順書参照）。
--
-- 冪等（再実行可）。Supabase ダッシュボード > SQL Editor で実行してください。
-- ※ migration 011（organizations / current_org_ids / is_org_admin）適用済みが前提。
-- =============================================================

create table if not exists inquiries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references auth.users(id),
  user_email text,
  category text not null,         -- bug / request / question / other
  body text not null,
  app_context jsonb,              -- { url, userAgent } など
  status text not null default 'open',  -- open / closed
  created_at timestamptz not null default now()
);

create index if not exists idx_inquiries_org_created on inquiries(org_id, created_at desc);

alter table inquiries enable row level security;

-- 閲覧: 自分の所属事業所、かつ管理者
drop policy if exists inquiries_select on inquiries;
create policy inquiries_select on inquiries for select
  using (org_id in (select current_org_ids()) and is_org_admin(org_id));

-- 追加: 自分の所属事業所のメンバー
drop policy if exists inquiries_insert on inquiries;
create policy inquiries_insert on inquiries for insert
  with check (org_id in (select current_org_ids()));

-- 状態更新（open/closed）: 管理者のみ
drop policy if exists inquiries_update on inquiries;
create policy inquiries_update on inquiries for update
  using (org_id in (select current_org_ids()) and is_org_admin(org_id))
  with check (org_id in (select current_org_ids()) and is_org_admin(org_id));

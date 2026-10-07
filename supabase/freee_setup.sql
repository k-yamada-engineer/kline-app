-- ============================================================
-- freee連携用テーブル（Supabase SQL Editorに貼ってRun）
-- RLSを有効化し、ポリシーを作らない = anon/authenticated(アプリの公開キー)からは一切読み書きできない。
-- Edge Function(service_role)だけが触れる。銀行明細・freeeトークンを公開キーから守るため。
-- ============================================================
create table if not exists freee_tokens (
  id int primary key default 1 check (id = 1),
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  company_id bigint,
  updated_at timestamptz not null default now()
);
alter table freee_tokens enable row level security;
revoke all on freee_tokens from anon, authenticated;

create table if not exists bank_txns (
  id bigint primary key,                 -- freeeの口座明細ID
  txn_date date not null,
  amount bigint not null,                -- 円（常に正の値）
  entry_side text not null,              -- income=入金 / expense=出金
  walletable_id bigint,
  walletable_type text,                  -- bank_account など
  walletable_name text,                  -- 口座名
  description text,                      -- 摘要（振込人名・取引内容）
  balance bigint,                        -- 取引後残高
  freee_status int,                      -- freee側の消込ステータス
  raw jsonb,
  synced_at timestamptz not null default now()
);
create index if not exists bank_txns_date_idx on bank_txns (txn_date desc);
alter table bank_txns enable row level security;
revoke all on bank_txns from anon, authenticated;

-- 入金はプラス・出金はマイナスで集計しやすいビュー（RLSは呼び出し側権限で効く）
create or replace view bank_txns_signed with (security_invoker = true) as
  select *, case when entry_side = 'income' then amount else -amount end as signed_amount
  from bank_txns;
revoke all on bank_txns_signed from anon, authenticated;

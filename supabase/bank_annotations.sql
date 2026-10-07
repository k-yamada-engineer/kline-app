-- ============================================================
-- 口座画面用（仕訳・備考の列＋口座ごとの残高サマリー）。Supabase SQL Editorに貼ってRun
-- 何度実行しても安全（if not exists / create or replace）。既存の明細データは消えない。
-- ============================================================
alter table bank_txns add column if not exists journal text;        -- 仕訳（勘定科目）※アプリで入力
alter table bank_txns add column if not exists memo text;           -- 備考 ※アプリで入力
alter table bank_txns add column if not exists annotated_at timestamptz;

-- 口座ごとの最新残高・件数・最終取込時刻
create or replace view bank_accounts_summary with (security_invoker = true) as
select distinct on (b.walletable_id)
  b.walletable_id,
  b.walletable_name,
  b.walletable_type,
  b.balance  as latest_balance,
  b.txn_date as latest_date,
  (select count(*) from bank_txns c where c.walletable_id is not distinct from b.walletable_id) as txn_count,
  (select max(synced_at) from bank_txns) as last_synced_at
from bank_txns b
order by b.walletable_id, b.txn_date desc, b.id desc;
revoke all on bank_accounts_summary from anon, authenticated;

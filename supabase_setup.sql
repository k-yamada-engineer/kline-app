-- ============================================================
-- K-LINE 運搬記録アプリ 同期用テーブル（Supabase SQL Editorに貼って実行）
-- ============================================================

create table if not exists kline_records (
  id text primary key,
  payload jsonb,
  updated_at bigint not null default 0,
  deleted boolean not null default false
);

create index if not exists kline_records_updated_at on kline_records (updated_at);

-- RLS: anonキーで読み書きできるのはこのテーブルのみ（insert/update/select）
alter table kline_records enable row level security;

drop policy if exists "kline_anon_select" on kline_records;
create policy "kline_anon_select" on kline_records for select to anon using (true);

drop policy if exists "kline_anon_insert" on kline_records;
create policy "kline_anon_insert" on kline_records for insert to anon with check (true);

drop policy if exists "kline_anon_update" on kline_records;
create policy "kline_anon_update" on kline_records for update to anon using (true) with check (true);

-- 物理deleteはanonに許可しない（削除はdeleted=trueのtombstone方式）

-- ============================================================
-- v3.18: 受領書写真のクラウド保存用バケット（Supabase SQL Editorに貼って実行）
-- ============================================================
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do nothing;

drop policy if exists "receipts_anon_select" on storage.objects;
create policy "receipts_anon_select" on storage.objects
  for select to anon using (bucket_id = 'receipts');

drop policy if exists "receipts_anon_insert" on storage.objects;
create policy "receipts_anon_insert" on storage.objects
  for insert to anon with check (bucket_id = 'receipts');

drop policy if exists "receipts_anon_update" on storage.objects;
create policy "receipts_anon_update" on storage.objects
  for update to anon using (bucket_id = 'receipts') with check (bucket_id = 'receipts');

-- ============================================================
-- 2時間ごとに freee-sync を自動実行（Supabase SQL Editorに貼ってRun）
-- 「ここにSYNC_SECRET」を、Edge Functionに設定したSYNC_SECRETと同じ文字列に置き換えること。
-- pg_cron + pg_net はSupabase内で完結するので、GitHub Actionsと違い60日無活動で止まる心配がない。
-- 同名ジョブは上書きされる。止めたい時: select cron.unschedule('freee-sync');
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'freee-sync',
  '5 */2 * * *',   -- 毎偶数時の5分（UTC基準・2時間ごと）
  $$
  select net.http_post(
    url := 'https://nhcgemajrsnyzkvjiyme.supabase.co/functions/v1/freee-sync/sync',
    headers := jsonb_build_object('x-sync-secret', 'ここにSYNC_SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- 動作確認（直近の実行結果）:
--   select status_code, content, created from net._http_response order by created desc limit 5;

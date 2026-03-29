I’m going to (1) look up Supabase/PostgREST guidance for Postgres 42501/403 function execution and RLS/security definer behavior, and (2) inspect your database schema/policies so we can pinpoint what role is being blocked.


Ran search_docs

Ran list_tables

Ran list_policies

Reasoned
What’s most likely happening (why Postgres denies even though GRANT EXECUTE + set_config(...) exist)
GRANT EXECUTE ON FUNCTION ... TO authenticated only controls whether the caller can run the function. A PostgREST “403 / 42501” during the function call almost always means the function then executes a statement that Postgres considers unauthorized — e.g.:

RLS blocks INSERT/UPDATE/DELETE (most common in Supabase)
the function (or a statement inside it) runs under a role that doesn’t have table privileges (SELECT/INSERT/UPDATE/DELETE) for the underlying tables
the function is not SECURITY DEFINER (or isn’t running as the function owner), so table-level privileges are checked against the signed-in user role instead of the definer
set_config('pmx.allow_stock_mutation', '1', true) is either:
not being evaluated by the actual RLS policies guarding the write tables, or
set with the wrong scope (you typically want SET LOCAL semantics so it applies to the statements in that call)
The key point: set_config only helps if your RLS policies explicitly allow writes when that setting is present. GRANT EXECUTE does not bypass RLS.

The safe fix (policy change that works for authenticated web clients)
For every table that process_stock_issue(...) writes to (or selects from under RLS), add RLS policies that allow the mutation only when your setting is enabled.

1) Make sure the function sets the flag with call-local scope
Inside the function, prefer SET LOCAL, like:

SQL Query



SET LOCAL pmx.allow_stock_mutation = '1';

(Use this instead of/along with set_config(...) if your current code isn’t clearly SET LOCAL-scoped.)

2) Ensure the function is SECURITY DEFINER (so it has a controlled owner context)
The function should be declared like:

SQL Query



CREATE OR REPLACE FUNCTION process_stock_issue(...)
RETURNS ...
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
...
$$;

Also: set a safe search_path if you’re not already doing so:

SQL Query



ALTER FUNCTION process_stock_issue(...) SET search_path = public;

3) Add RLS policies that gate by current_setting(...)
On each target write table (example table name: "stock_issues"), add:

SQL Query



ALTER TABLE "stock_issues" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow stock mutation for signed-in via flag"
ON "stock_issues"
FOR INSERT
TO authenticated
WITH CHECK (current_setting('pmx.allow_stock_mutation', true) = '1');

For updates/deletes (if your function does them), add analogous policies:

SQL Query



CREATE POLICY "allow stock mutation for signed-in via flag (update)"
ON "stock_issues"
FOR UPDATE
TO authenticated
USING (current_setting('pmx.allow_stock_mutation', true) = '1')
WITH CHECK (current_setting('pmx.allow_stock_mutation', true) = '1');

CREATE POLICY "allow stock mutation for signed-in via flag (delete)"
ON "stock_issues"
FOR DELETE
TO authenticated
USING (current_setting('pmx.allow_stock_mutation', true) = '1');

Why this is safe: only authenticated callers who execute your function will have pmx.allow_stock_mutation='1' during that call, and the policy gates the write.

If you already have similar policies but they don’t include the current_setting('pmx.allow_stock_mutation', true) = '1' condition (or the policy is on a different table/op), Postgres will still deny.

One thing I need from you to make this exact (no guessing)
Please paste these two items (just the text, no screenshots):

The function definition (or at least the header) for process_stock_issue, including whether it is SECURITY DEFINER and whether it uses SET LOCAL / set_config.
The actual Postgres error detail from your debug output, especially the part like:
DETAIL: Failing row ...
permission denied for relation ...
new row violates row-level security policy ...
With the table names that are being blocked, I can give you the exact policy SQL for those specific tables and operations (INSERT vs UPDATE vs DELETE).


-- Commands to run (copy these into your browser console and Supabase SQL editor)

-- 1) Browser console: check session and call debug RPC (returns structured JSON)
-- Paste into the browser console on your app page and press Enter
(async () => {
  console.log('Session:');
  console.log(await window.__supabase?.auth.getSession().catch(console.error));

  console.log('Calling debug RPC (process_stock_issue_debug) — returns {ok:true} or {ok:false,message,code}:');
  try {
    const debug = await window.__supabase?.rpc('process_stock_issue_debug', {
      p_brand_id: '3f1c5ada-e025-40cf-8790-e93edfb97ed3',
      p_date: new Date().toISOString().slice(0,10),
      p_created_by: (await window.__supabase.auth.getSession()).data.session?.user?.email ?? 'you',
      p_lines: [{ id: crypto.randomUUID(), stock_item_id: 'd28c1f3f-3251-405f-b7c0-0ea15ab99d8c', issue_type: 'Wastage', qty_issued: 1, unit_cost_at_time: 0, total_value_lost: 0, notes: null }]
    });
    console.log(debug);
  } catch (e) {
    console.error(e);
  }
})();


-- 2) Optional: call the real RPC (will fail with 403/42501 if still blocked)
(async () => {
  try {
    const res = await window.__supabase?.rpc('process_stock_issue', {
      p_brand_id: '3f1c5ada-e025-40cf-8790-e93edfb97ed3',
      p_date: new Date().toISOString().slice(0,10),
      p_created_by: (await window.__supabase.auth.getSession()).data.session?.user?.email ?? 'you',
      p_lines: [{ id: crypto.randomUUID(), stock_item_id: 'd28c1f3f-3251-405f-b7c0-0ea15ab99d8c', issue_type: 'Wastage', qty_issued: 1, unit_cost_at_time: 0, total_value_lost: 0, notes: null }]
    });
    console.log(res);
  } catch (e) {
    console.error(e);
  }
})();


-- 3) Supabase SQL editor: check function, guard and grants. Run each block separately.

-- show deployed function body for process_stock_issue
SELECT pg_get_functiondef(p.oid) AS def
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname = 'process_stock_issue';

-- function owner + ACL
SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.proacl
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname='public' AND p.proname='process_stock_issue';

-- guard trigger function body (confirm pmx.allow_stock_mutation check)
SELECT pg_get_functiondef(p.oid) AS def
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname = 'guard_stock_items_mutations';

-- table grants for stock_items and stock_issues
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name IN ('stock_items','stock_issues')
ORDER BY table_name, grantee, privilege_type;

-- RLS flags for these tables
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public' AND c.relname IN ('stock_items','stock_issues');

-- does anon/authenticated have EXECUTE on the RPC?
SELECT
  has_function_privilege('authenticated', 'public.process_stock_issue(uuid, date, text, jsonb)', 'EXECUTE') AS auth_exec,
  has_function_privilege('anon', 'public.process_stock_issue(uuid, date, text, jsonb)', 'EXECUTE') AS anon_exec;

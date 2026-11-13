DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.confirm_flow_purchase(jsonb,text,jsonb)'::regprocedure) INTO definition;
 definition := replace(definition, ' AND (source=''imported'' OR created_at>=now()-interval ''7 days'')', '');
 definition := replace(definition, 'IF budget IS NULL OR budget<=0 THEN', 'IF budget IS NULL OR budget<=0 OR (m>=''2027-01'' AND NOT EXISTS (SELECT 1 FROM public.buyer_goal_configs WHERE period=m GROUP BY period HAVING sum(sales_cents)>0)) THEN');
 EXECUTE definition;
 SELECT pg_get_functiondef('public.purchase_day_available(date,bigint,bigint)'::regprocedure) INTO definition;
 definition := replace(definition, ' AND (source=''imported'' OR created_at>=now()-interval ''7 days'')', '');
 EXECUTE definition;
 SELECT pg_get_functiondef('public.save_buyer_goal_month(text,bigint,jsonb,jsonb)'::regprocedure) INTO definition;
 definition := replace(definition, 'NOT BETWEEN ''2026-12'' AND ''2027-12''', 'NOT BETWEEN ''2026-11'' AND ''2027-12''');
 definition := replace(definition, 'IF p_month=''2026-12''', 'IF p_month=''2026-11'' AND p_budget<>189146900 THEN RAISE EXCEPTION ''O orçamento de novembro deve permanecer em R$ 1.891.469,00''; END IF; IF p_month=''2026-12''');
 definition := replace(definition, ' INSERT INTO public.cash_flow_month_budgets', ' IF p_month<>''2026-11'' THEN INSERT INTO public.cash_flow_month_budgets');
 definition := replace(definition, 'updated_at=now();' || chr(10) || ' FOR item', 'updated_at=now(); END IF;' || chr(10) || ' FOR item');
 definition := replace(definition, ' INSERT INTO public.buyer_budgets', ' IF p_month<>''2026-11'' THEN INSERT INTO public.buyer_budgets');
 definition := replace(definition, 'updated_at=now();' || chr(10) || ' INSERT INTO public.buyer_goal_configs', 'updated_at=now(); END IF;' || chr(10) || ' INSERT INTO public.buyer_goal_configs');
 EXECUTE definition;
END $migration$;
REVOKE ALL ON FUNCTION public.confirm_flow_purchase(jsonb,text,jsonb), public.save_buyer_goal_month(text,bigint,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_flow_purchase(jsonb,text,jsonb), public.save_buyer_goal_month(text,bigint,jsonb,jsonb) TO service_role;
COMMENT ON FUNCTION public.confirm_flow_purchase(jsonb,text,jsonb) IS 'Confirmed purchases are permanent; monthly and daily validation includes all retained entries regardless of age.';
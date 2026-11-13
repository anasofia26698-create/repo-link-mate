CREATE OR REPLACE FUNCTION public.save_buyer_goal_month(p_month text, p_budget bigint, p_shares jsonb, p_configs jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item jsonb; total bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(773106);
 IF p_month NOT BETWEEN '2026-12' AND '2027-06' OR p_budget < 0 THEN RAISE EXCEPTION 'Période ou dotação inválida'; END IF;
 IF p_month='2026-12' AND p_budget<>197436800 THEN RAISE EXCEPTION 'A dotação de dezembro deve permanecer em R$ 1.974.368,00'; END IF;
 IF jsonb_array_length(p_configs)<>3 OR (SELECT count(DISTINCT value->>'buyer') FROM jsonb_array_elements(p_configs) WHERE value->>'buyer' IN ('Marcelo','Suellen','Maurício'))<>3 THEN RAISE EXCEPTION 'Informe os três compradores'; END IF;
 SELECT sum((value->>'monthlyCents')::bigint) INTO total FROM jsonb_array_elements(p_configs);
 IF total<>p_budget THEN RAISE EXCEPTION 'Dotações não fecham o orçamento'; END IF;
 INSERT INTO public.cash_flow_month_budgets(month,budget_cents,buyer_participations) VALUES(p_month,p_budget,p_shares) ON CONFLICT(month) DO UPDATE SET budget_cents=EXCLUDED.budget_cents,buyer_participations=EXCLUDED.buyer_participations,updated_at=now();
 FOR item IN SELECT value FROM jsonb_array_elements(p_configs) LOOP
 INSERT INTO public.buyer_budgets(period,buyer,monthly_cents) VALUES(p_month,item->>'buyer',(item->>'monthlyCents')::bigint) ON CONFLICT(period,buyer) DO UPDATE SET monthly_cents=EXCLUDED.monthly_cents,updated_at=now();
 INSERT INTO public.buyer_goal_configs(period,buyer,sales_cents,cmv_percent,ips) VALUES(p_month,item->>'buyer',(item->>'salesCents')::bigint,(item->>'cmvPercent')::numeric,item->'ips') ON CONFLICT(period,buyer) DO UPDATE SET sales_cents=EXCLUDED.sales_cents,cmv_percent=EXCLUDED.cmv_percent,ips=EXCLUDED.ips,updated_at=now();
 END LOOP;
 INSERT INTO public.audit_events(event_type,route,entry_count,details) VALUES('simulation','/metas',3,jsonb_build_object('action','goal-month-plan','month',p_month,'budgetCents',p_budget,'configs',p_configs)::text);
END $$;
REVOKE ALL ON FUNCTION public.save_buyer_goal_month(text,bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_buyer_goal_month(text,bigint,jsonb,jsonb) TO service_role;
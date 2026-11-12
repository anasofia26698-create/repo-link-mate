ALTER TABLE public.cash_flow_month_budgets ADD COLUMN IF NOT EXISTS buyer_participations jsonb;
INSERT INTO public.cash_flow_month_budgets(month,budget_cents,buyer_participations) SELECT '2026-12',197436800,'{"Marcelo":40.61,"Suellen":32.54,"Maurício":26.86}'::jsonb WHERE EXISTS(SELECT 1 FROM public.buyer_budgets WHERE period='2026-12') ON CONFLICT(month) DO UPDATE SET buyer_participations=COALESCE(public.cash_flow_month_budgets.buyer_participations,EXCLUDED.buyer_participations);
CREATE OR REPLACE FUNCTION public.save_purchase_month_plan(p_month text,p_budget bigint,p_shares jsonb,p_allocations jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b text;
BEGIN
 PERFORM pg_advisory_xact_lock(773106);
 IF p_month NOT BETWEEN '2027-01' AND '2027-06' OR p_budget<=0 THEN RAISE EXCEPTION 'Plano mensal inválido'; END IF;
 IF (SELECT sum(value::bigint) FROM jsonb_each_text(p_allocations))<>p_budget THEN RAISE EXCEPTION 'Dotações não fecham o orçamento'; END IF;
 INSERT INTO public.cash_flow_month_budgets(month,budget_cents,buyer_participations) VALUES(p_month,p_budget,p_shares) ON CONFLICT(month) DO UPDATE SET budget_cents=EXCLUDED.budget_cents,buyer_participations=EXCLUDED.buyer_participations,updated_at=now();
 FOREACH b IN ARRAY ARRAY['Marcelo','Suellen','Maurício'] LOOP
 INSERT INTO public.buyer_budgets(period,buyer,monthly_cents) VALUES(p_month,b,(p_allocations->>b)::bigint) ON CONFLICT(period,buyer) DO UPDATE SET monthly_cents=EXCLUDED.monthly_cents,updated_at=now();
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.save_purchase_month_plan(text,bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_purchase_month_plan(text,bigint,jsonb,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.confirm_flow_purchase(p_entries jsonb,p_buyer text,p_actor jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e jsonb; m text; dt date; cents bigint; budget bigint; debit bigint; remaining bigint; goal bigint; free_goal bigint; all_free bigint; day_debit bigint; allowed bigint; event_id bigint; booked bigint; day_booked bigint; current_day date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
 PERFORM pg_advisory_xact_lock(773106);
 IF p_buyer NOT IN ('Marcelo','Suellen','Maurício') OR jsonb_array_length(p_entries)<1 THEN RAISE EXCEPTION 'Comprador ou parcelas inválidos'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
 dt:=(e->>'date')::date; cents:=(e->>'debitCents')::bigint;
 IF dt>'2027-06-30'::date THEN RAISE EXCEPTION 'Simulação disponível somente até 30/06/2027'; END IF;
 IF dt<current_day THEN RAISE EXCEPTION 'Datas anteriores à data de hoje não são permitidas'; END IF;
 IF dt<'2026-11-13'::date THEN RAISE EXCEPTION 'Simulação disponível a partir de 13/11/2026'; END IF;
 IF cents<1 THEN RAISE EXCEPTION 'Valor da parcela muito baixo: informe um valor total maior'; END IF;
 IF e->>'termDays' IS NOT NULL AND ((e->>'termDays')::integer<1 OR (e->>'termDays')::integer>230) THEN RAISE EXCEPTION 'Prazo em dias deve ser um número inteiro entre 1 e 230'; END IF;
 m:=to_char(dt,'YYYY-MM'); SELECT budget_cents INTO budget FROM public.cash_flow_month_budgets WHERE month=m;
 IF budget IS NULL OR budget<=0 THEN RAISE EXCEPTION 'Orçamento de % não cadastrado',m; END IF;
 SELECT COALESCE(sum(debit_cents),0) INTO debit FROM public.cash_flow_entries WHERE to_char(date,'YYYY-MM')=m AND (source='imported' OR created_at>=now()-interval '7 days');
 remaining:=greatest(0,budget-debit);
 SELECT COALESCE(sum((value->>'debitCents')::bigint),0) INTO booked FROM jsonb_array_elements(p_entries) WHERE left(value->>'date',7)=m;
 IF booked>remaining THEN RAISE EXCEPTION 'NÃO PODE COMPRAR: saldo do mês insuficiente'; END IF;
 WITH days AS (SELECT d::date AS date FROM generate_series(date_trunc('month',dt)::date,(date_trunc('month',dt)+interval '1 month - 1 day')::date,interval '1 day') d), daily AS (SELECT days.date, CASE WHEN extract(day FROM days.date) IN(5,10,15,20,25) THEN least(5000000,(ARRAY[5220000,7440000,7440000,7440000,7380000,7620000,7980000])[extract(dow FROM days.date)::int+1]) ELSE (ARRAY[5220000,7440000,7440000,7440000,7380000,7620000,7980000])[extract(dow FROM days.date)::int+1] END AS goal,COALESCE((SELECT sum(debit_cents) FROM public.cash_flow_entries c WHERE c.date=days.date AND (source='imported' OR created_at>=now()-interval '7 days')),0) AS debit FROM days)
 SELECT COALESCE(sum(greatest(0,goal-debit)),0),COALESCE(max(greatest(0,goal-debit)) FILTER(WHERE date=dt),0) INTO all_free,free_goal FROM daily;
 IF all_free=0 THEN allowed:=0; ELSE allowed:=floor(free_goal*least(1::numeric,remaining::numeric/all_free)); END IF;
 SELECT COALESCE(sum((value->>'debitCents')::bigint),0) INTO day_booked FROM jsonb_array_elements(p_entries) WHERE (value->>'date')::date=dt;
 IF day_booked>allowed THEN RAISE EXCEPTION 'NÃO PODE COMPRAR: limite do dia insuficiente'; END IF;
 END LOOP;
 INSERT INTO public.audit_events(event_type,user_name,ip_address,user_agent,route,entry_count,details) VALUES('confirmation',p_actor->>'actorName',p_actor->>'ipAddress',p_actor->>'userAgent',COALESCE(p_actor->>'route','/'),jsonb_array_length(p_entries),jsonb_build_object('buyer',p_buyer,'installments',p_entries,'totalCents',(SELECT sum((value->>'debitCents')::bigint) FROM jsonb_array_elements(p_entries)))::text) RETURNING id INTO event_id;
 INSERT INTO public.cash_flow_entries(date,debit_cents,source,audit_event_id) SELECT (value->>'date')::date,(value->>'debitCents')::bigint,'manual',event_id FROM jsonb_array_elements(p_entries);
 INSERT INTO public.buyer_payments(due_date,buyer,amount_cents,source,import_batch) SELECT (value->>'date')::date,p_buyer,(value->>'debitCents')::bigint,'confirmed','cash-flow-confirmation-'||event_id FROM jsonb_array_elements(p_entries);
END $$;
REVOKE ALL ON FUNCTION public.confirm_flow_purchase(jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_flow_purchase(jsonb,text,jsonb) TO service_role;
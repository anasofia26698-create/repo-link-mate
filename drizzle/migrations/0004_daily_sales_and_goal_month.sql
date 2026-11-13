CREATE TABLE public.daily_sales (
  date date PRIMARY KEY,
  sales_cents bigint NOT NULL CHECK (sales_cents >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.daily_sales TO service_role;
ALTER TABLE public.daily_sales ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.flow_day_goal(p_date date) RETURNS bigint LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH base AS (SELECT COALESCE((SELECT round(s.sales_cents * 0.60)::bigint FROM public.daily_sales s WHERE s.date = p_date),
    (ARRAY[5220000,7440000,7440000,7440000,7380000,7620000,7980000])[extract(dow FROM p_date)::int+1]) AS goal)
  SELECT CASE WHEN extract(day FROM p_date) IN (5,10,15,20,25) THEN least(5000000, goal) ELSE goal END FROM base
$$;

CREATE OR REPLACE FUNCTION public.purchase_day_available(p_date date, p_remaining bigint, p_all_free bigint) RETURNS bigint LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
WITH days AS (SELECT d::date AS date FROM generate_series(date_trunc('month',p_date)::date,(date_trunc('month',p_date)+interval '1 month - 1 day')::date,interval '1 day') d), goals AS (SELECT days.date,public.flow_day_goal(days.date) AS goal,COALESCE((SELECT sum(debit_cents) FROM public.cash_flow_entries c WHERE c.date=days.date AND (source='imported' OR created_at>=now()-interval '7 days')),0) AS debit FROM days), exact AS (SELECT date,greatest(0,goal-debit)*CASE WHEN p_all_free>0 THEN least(1::numeric,p_remaining::numeric/p_all_free) ELSE 0 END AS amount FROM goals), ranked AS (SELECT date,floor(amount)::bigint AS base,row_number() OVER(ORDER BY amount-floor(amount) DESC,date ASC) AS rank,sum(floor(amount)) OVER() AS allocated FROM exact) SELECT COALESCE((SELECT base+CASE WHEN rank<=least(p_remaining,p_all_free)-allocated THEN 1 ELSE 0 END FROM ranked WHERE date=p_date),0)::bigint
$function$;

CREATE OR REPLACE FUNCTION public.confirm_flow_purchase(p_entries jsonb, p_buyer text, p_actor jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE e jsonb; m text; dt date; cents bigint; budget bigint; debit bigint; remaining bigint; free_goal bigint; all_free bigint; allowed bigint; event_id bigint; booked bigint; day_booked bigint; current_day date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
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
 WITH days AS (SELECT d::date AS date FROM generate_series(date_trunc('month',dt)::date,(date_trunc('month',dt)+interval '1 month - 1 day')::date,interval '1 day') d), daily AS (SELECT days.date, public.flow_day_goal(days.date) AS goal,COALESCE((SELECT sum(debit_cents) FROM public.cash_flow_entries c WHERE c.date=days.date AND (source='imported' OR created_at>=now()-interval '7 days')),0) AS debit FROM days)
 SELECT COALESCE(sum(greatest(0,daily.goal-daily.debit)),0),COALESCE(max(greatest(0,daily.goal-daily.debit)) FILTER(WHERE daily.date=dt),0) INTO all_free,free_goal FROM daily;
 IF all_free=0 THEN allowed:=0; ELSE allowed:=public.purchase_day_available(dt,remaining,all_free); END IF;
 SELECT COALESCE(sum((value->>'debitCents')::bigint),0) INTO day_booked FROM jsonb_array_elements(p_entries) WHERE (value->>'date')::date=dt;
 IF day_booked>allowed THEN RAISE EXCEPTION 'NÃO PODE COMPRAR: limite do dia insuficiente'; END IF;
 END LOOP;
 INSERT INTO public.audit_events(event_type,user_name,ip_address,user_agent,route,entry_count,details) VALUES('confirmation',p_actor->>'actorName',p_actor->>'ipAddress',p_actor->>'userAgent',COALESCE(p_actor->>'route','/'),jsonb_array_length(p_entries),jsonb_build_object('buyer',p_buyer,'installments',p_entries,'totalCents',(SELECT sum((value->>'debitCents')::bigint) FROM jsonb_array_elements(p_entries)))::text) RETURNING id INTO event_id;
 INSERT INTO public.cash_flow_entries(date,debit_cents,source,audit_event_id) SELECT (value->>'date')::date,(value->>'debitCents')::bigint,'manual',event_id FROM jsonb_array_elements(p_entries);
 INSERT INTO public.buyer_payments(due_date,buyer,amount_cents,source,import_batch) SELECT (value->>'date')::date,p_buyer,(value->>'debitCents')::bigint,'confirmed','cash-flow-confirmation-'||event_id FROM jsonb_array_elements(p_entries);
END $function$;
REVOKE ALL ON FUNCTION public.flow_day_goal(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flow_day_goal(date) TO service_role;
CREATE TABLE public.purchase_sector_goals (
 sector text NOT NULL, period text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 sales numeric NOT NULL DEFAULT 0 CHECK(sales>=0), cmv numeric NOT NULL DEFAULT 60 CHECK(cmv BETWEEN 0 AND 100),
 initial_stock numeric NOT NULL DEFAULT 0 CHECK(initial_stock>=0), final_stock numeric NOT NULL DEFAULT 0 CHECK(final_stock>=0),
 coverage numeric NOT NULL DEFAULT 0 CHECK(coverage>=0), turnover numeric NOT NULL DEFAULT 0 CHECK(turnover>=0),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(period,sector)
);
GRANT ALL ON public.purchase_sector_goals TO service_role;
ALTER TABLE public.purchase_sector_goals ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.save_sector_goals(p_goals jsonb,p_migrate boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item jsonb; m text; sales_total bigint; budget bigint; shares jsonb; configs jsonb; existing_sales bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(773106);
 FOR item IN SELECT value FROM jsonb_array_elements(p_goals) LOOP
 INSERT INTO public.purchase_sector_goals(sector,period,sales,cmv,initial_stock,final_stock,coverage,turnover)
 VALUES(item->>'sector',item->>'period',(item->>'sales')::numeric,(item->>'cmv')::numeric,(item->>'initialStock')::numeric,(item->>'finalStock')::numeric,(item->>'coverage')::numeric,(item->>'turnover')::numeric)
 ON CONFLICT(period,sector) DO UPDATE SET sales=EXCLUDED.sales,cmv=EXCLUDED.cmv,initial_stock=EXCLUDED.initial_stock,final_stock=EXCLUDED.final_stock,coverage=EXCLUDED.coverage,turnover=EXCLUDED.turnover,updated_at=now() WHERE NOT p_migrate;
 END LOOP;
 FOR m IN SELECT DISTINCT value->>'period' FROM jsonb_array_elements(p_goals) LOOP
 IF m NOT BETWEEN '2027-01' AND '2027-12' THEN CONTINUE; END IF;
 SELECT coalesce(sum(sales_cents),0) INTO existing_sales FROM public.buyer_goal_configs WHERE period=m;
 IF existing_sales>0 THEN CONTINUE; END IF;
 IF p_migrate AND EXISTS(SELECT 1 FROM public.cash_flow_month_budgets WHERE month=m AND budget_cents>0) THEN CONTINUE; END IF;
 SELECT round(sum(sales)*100)::bigint,greatest(0,round(sum(sales*cmv/100+final_stock-initial_stock)*100))::bigint INTO sales_total,budget FROM public.purchase_sector_goals WHERE period=m;
 IF sales_total<=0 OR budget<=0 THEN CONTINUE; END IF;
 SELECT buyer_participations INTO shares FROM public.cash_flow_month_budgets WHERE month='2026-12';
 shares:=coalesce(shares,'{"Marcelo":40.61,"Suellen":32.54,"Maurício":26.86}'::jsonb);
 WITH weights AS (SELECT key buyer,value::numeric weight FROM jsonb_each_text(shares)), amounts AS (SELECT buyer,round(sales_total*weight/sum(weight) OVER())::bigint s,round(budget*weight/sum(weight) OVER())::bigint b FROM weights)
 SELECT jsonb_agg(jsonb_build_object('buyer',buyer,'salesCents',s+CASE WHEN buyer='Marcelo' THEN sales_total-(SELECT sum(s) FROM amounts) ELSE 0 END,'monthlyCents',b+CASE WHEN buyer='Marcelo' THEN budget-(SELECT sum(b) FROM amounts) ELSE 0 END,'cmvPercent',60,'ips','[]'::jsonb)) INTO configs FROM amounts;
 PERFORM public.save_buyer_goal_month(m,budget,shares,configs);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.save_sector_goals(jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_sector_goals(jsonb,boolean) TO service_role;
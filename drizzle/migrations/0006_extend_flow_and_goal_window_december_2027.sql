DO $$
DECLARE definition text;
BEGIN
 definition := pg_get_functiondef('public.confirm_flow_purchase(jsonb,text,jsonb)'::regprocedure);
 IF position('2027-06-30' in definition)=0 THEN RAISE EXCEPTION 'Limite anterior de confirmação não encontrado'; END IF;
 definition := replace(replace(definition,'2027-06-30','2027-12-31'),'30/06/2027','31/12/2027');
 EXECUTE definition;
 definition := pg_get_functiondef('public.save_purchase_month_plan(text,bigint,jsonb,jsonb)'::regprocedure);
 IF position('2027-06' in definition)=0 THEN RAISE EXCEPTION 'Limite anterior de plano não encontrado'; END IF;
 EXECUTE replace(definition,'2027-06','2027-12');
 definition := pg_get_functiondef('public.save_buyer_goal_month(text,bigint,jsonb,jsonb)'::regprocedure);
 IF position('2027-06' in definition)=0 THEN RAISE EXCEPTION 'Limite anterior de metas não encontrado'; END IF;
 EXECUTE replace(definition,'2027-06','2027-12');
END $$;
REVOKE ALL ON FUNCTION public.confirm_flow_purchase(jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_flow_purchase(jsonb,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.save_purchase_month_plan(text,bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_purchase_month_plan(text,bigint,jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.save_buyer_goal_month(text,bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_buyer_goal_month(text,bigint,jsonb,jsonb) TO service_role;
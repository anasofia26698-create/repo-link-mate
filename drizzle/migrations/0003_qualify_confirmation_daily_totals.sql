DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.confirm_flow_purchase(jsonb,text,jsonb)'::regprocedure) INTO definition;
 definition:=replace(definition,'sum(greatest(0,goal-debit))','sum(greatest(0,daily.goal-daily.debit))');
 definition:=replace(definition,'max(greatest(0,goal-debit)) FILTER(WHERE date=dt)','max(greatest(0,daily.goal-daily.debit)) FILTER(WHERE daily.date=dt)');
 EXECUTE definition;
END $$;
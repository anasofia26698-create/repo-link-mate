CREATE TABLE public.purchase_month_accounting (
  period text PRIMARY KEY CHECK (period = '2026-10'),
  total_cents bigint NOT NULL DEFAULT 226511799 CHECK (total_cents >= 226511799),
  paid_cents bigint NOT NULL DEFAULT 32914514 CHECK (paid_cents >= 0),
  open_cents bigint NOT NULL DEFAULT 193597285 CHECK (open_cents >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total_cents = paid_cents + open_cents)
);
GRANT SELECT ON public.purchase_month_accounting TO anon, authenticated;
GRANT ALL ON public.purchase_month_accounting TO service_role;
ALTER TABLE public.purchase_month_accounting ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dashboard month totals are readable" ON public.purchase_month_accounting FOR SELECT TO anon, authenticated USING (period = '2026-10');
CREATE FUNCTION public.preserve_purchase_month_total() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.total_cents < OLD.total_cents THEN RAISE EXCEPTION 'Monthly total cannot decrease'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_purchase_month_total BEFORE UPDATE ON public.purchase_month_accounting FOR EACH ROW EXECUTE FUNCTION public.preserve_purchase_month_total();
CREATE FUNCTION public.update_october_accounting(in_open_cents bigint, in_paid_cents bigint DEFAULT NULL) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE previous public.purchase_month_accounting%ROWTYPE; next_total bigint;
BEGIN
  IF in_open_cents < 0 OR in_paid_cents < 0 THEN RAISE EXCEPTION 'Invalid monthly amounts'; END IF;
  SELECT * INTO STRICT previous FROM public.purchase_month_accounting WHERE period = '2026-10' FOR UPDATE;
  next_total := greatest(previous.total_cents, in_open_cents + coalesce(in_paid_cents, previous.paid_cents));
  UPDATE public.purchase_month_accounting SET total_cents = next_total, open_cents = in_open_cents, paid_cents = next_total - in_open_cents, updated_at = now() WHERE period = '2026-10';
END;
$$;
REVOKE ALL ON FUNCTION public.update_october_accounting(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_october_accounting(bigint, bigint) TO service_role;
CREATE TABLE public.buyer_ips (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_address text NOT NULL UNIQUE,
  buyer text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.buyer_ips TO service_role;
ALTER TABLE public.buyer_ips ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.buyer_payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  due_date date NOT NULL,
  buyer text NOT NULL,
  amount_cents bigint NOT NULL,
  import_batch text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX buyer_payments_due_date_idx ON public.buyer_payments (due_date);
CREATE INDEX buyer_payments_buyer_idx ON public.buyer_payments (buyer);
GRANT ALL ON public.buyer_payments TO service_role;
ALTER TABLE public.buyer_payments ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.buyer_budgets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period text NOT NULL,
  buyer text NOT NULL,
  monthly_cents bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period, buyer)
);
GRANT ALL ON public.buyer_budgets TO service_role;
ALTER TABLE public.buyer_budgets ENABLE ROW LEVEL SECURITY;

INSERT INTO public.buyer_budgets (period, buyer, monthly_cents) VALUES
  ('2026-08', 'Marcelo', 84000000),
  ('2026-08', 'Maurício', 66000000),
  ('2026-08', 'Suellen', 66000000);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_buyer_ips_updated_at BEFORE UPDATE ON public.buyer_ips
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_buyer_budgets_updated_at BEFORE UPDATE ON public.buyer_budgets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
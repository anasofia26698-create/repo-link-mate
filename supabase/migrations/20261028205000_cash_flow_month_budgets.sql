CREATE TABLE IF NOT EXISTS public.cash_flow_month_budgets (
  month TEXT PRIMARY KEY CHECK (month ~ '^\d{4}-\d{2}$'),
  budget_cents BIGINT NOT NULL CHECK (budget_cents >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.cash_flow_month_budgets (month, budget_cents)
VALUES ('2026-11', 189146900)
ON CONFLICT (month) DO NOTHING;

GRANT ALL ON public.cash_flow_month_budgets TO service_role;
ALTER TABLE public.cash_flow_month_budgets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.update_cash_flow_month_budgets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_cash_flow_month_budgets_updated_at ON public.cash_flow_month_budgets;
CREATE TRIGGER update_cash_flow_month_budgets_updated_at
BEFORE UPDATE ON public.cash_flow_month_budgets
FOR EACH ROW EXECUTE FUNCTION public.update_cash_flow_month_budgets_updated_at();

CREATE TABLE public.buyer_goal_configs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period text NOT NULL,
  buyer text NOT NULL,
  sales_cents bigint NOT NULL,
  cmv_percent numeric(6, 2) NOT NULL DEFAULT 60,
  ips text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period, buyer)
);

CREATE TABLE public.line_goals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period text NOT NULL,
  line_name text NOT NULL,
  sales_cents bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.buyer_goal_configs TO service_role;
GRANT ALL ON public.line_goals TO service_role;
ALTER TABLE public.buyer_goal_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_goals ENABLE ROW LEVEL SECURITY;

CREATE INDEX buyer_goal_configs_period_idx ON public.buyer_goal_configs (period);
CREATE INDEX line_goals_period_idx ON public.line_goals (period);

CREATE TRIGGER update_buyer_goal_configs_updated_at BEFORE UPDATE ON public.buyer_goal_configs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_line_goals_updated_at BEFORE UPDATE ON public.line_goals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

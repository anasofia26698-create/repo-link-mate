CREATE TABLE public.buyer_goal_configs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period text NOT NULL,
  buyer text NOT NULL,
  sales_cents bigint NOT NULL DEFAULT 0,
  cmv_percent numeric NOT NULL DEFAULT 60,
  ips jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period, buyer)
);
GRANT ALL ON public.buyer_goal_configs TO service_role;
ALTER TABLE public.buyer_goal_configs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.line_goals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period text NOT NULL,
  line_name text NOT NULL,
  sales_cents bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.line_goals TO service_role;
ALTER TABLE public.line_goals ENABLE ROW LEVEL SECURITY;
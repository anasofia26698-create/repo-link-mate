-- Configuração oficial e congelada da dotação de dezembro/2026.
-- Os valores são gravados em centavos e fecham exatamente R$ 1.974.368,00.
INSERT INTO public.buyer_budgets (period, buyer, monthly_cents)
VALUES
  ('2026-12', 'Marcelo', 80171070),
  ('2026-12', 'Suellen', 64239510),
  ('2026-12', 'Maurício', 53026220)
ON CONFLICT (period, buyer) DO UPDATE
SET monthly_cents = EXCLUDED.monthly_cents,
    updated_at = now();

-- Venda-base por comprador: dotação / 60%.
-- A soma fecha R$ 3.290.613,33 (R$ 1.974.368,00 / 60%).
INSERT INTO public.buyer_goal_configs (period, buyer, sales_cents, cmv_percent, ips)
VALUES
  ('2026-12', 'Marcelo', 133618450, 60, '{}'),
  ('2026-12', 'Suellen', 107065850, 60, '{}'),
  ('2026-12', 'Maurício', 88377033, 60, '{}')
ON CONFLICT (period, buyer) DO UPDATE
SET sales_cents = EXCLUDED.sales_cents,
    cmv_percent = EXCLUDED.cmv_percent,
    updated_at = now();

COMMENT ON TABLE public.buyer_budgets IS 'Dotações mensais por comprador; dezembro/2026 usa configuração oficial fechada em R$ 1.974.368,00.';

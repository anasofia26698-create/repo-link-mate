CREATE TABLE public.cash_flow_entries (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL,
  debit_cents BIGINT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('imported','manual')),
  audit_event_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('access','import','confirmation','simulation')),
  user_name TEXT,
  user_email TEXT,
  ip_address TEXT,
  user_agent TEXT,
  route TEXT NOT NULL,
  entry_count INTEGER NOT NULL DEFAULT 0,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.cash_flow_import_runs (
  id BIGSERIAL PRIMARY KEY,
  audit_event_id BIGINT REFERENCES public.audit_events(id),
  file_name TEXT,
  mapped_columns TEXT NOT NULL,
  entry_count INTEGER NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_debit_cents BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.cash_flow_import_entries (
  id BIGSERIAL PRIMARY KEY,
  import_run_id BIGINT NOT NULL REFERENCES public.cash_flow_import_runs(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  debit_cents BIGINT NOT NULL
);

ALTER TABLE public.cash_flow_entries
  ADD CONSTRAINT cash_flow_entries_audit_event_fk
  FOREIGN KEY (audit_event_id) REFERENCES public.audit_events(id);

CREATE INDEX cash_flow_entries_date_idx ON public.cash_flow_entries (date);
CREATE INDEX cash_flow_entries_source_idx ON public.cash_flow_entries (source);
CREATE INDEX audit_events_created_at_idx ON public.audit_events (created_at DESC);
CREATE INDEX cash_flow_import_entries_run_idx ON public.cash_flow_import_entries (import_run_id);

GRANT ALL ON public.cash_flow_entries TO service_role;
GRANT ALL ON public.audit_events TO service_role;
GRANT ALL ON public.cash_flow_import_runs TO service_role;
GRANT ALL ON public.cash_flow_import_entries TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cash_flow_entries_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.audit_events_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cash_flow_import_runs_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cash_flow_import_entries_id_seq TO service_role;

ALTER TABLE public.cash_flow_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_flow_import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_flow_import_entries ENABLE ROW LEVEL SECURITY;
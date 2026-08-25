CREATE TABLE public.known_ip_users (
  id bigint generated always as identity primary key,
  ip_address text not null unique,
  user_name text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
GRANT ALL ON public.known_ip_users TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.known_ip_users_id_seq TO service_role;
ALTER TABLE public.known_ip_users ENABLE ROW LEVEL SECURITY;
INSERT INTO public.known_ip_users (ip_address, user_name) VALUES
  ('2804:79d4:f008:b40:e095:fd5d:3f7e:bf88', 'Suellen'),
  ('207.248.5.43', 'Marcelo'),
  ('2804:d55:4154:8300:d847:168d:41a5:9468', 'Ana Sofia');
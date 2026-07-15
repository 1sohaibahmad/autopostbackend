alter table public.generations add column if not exists generation_mode text not null default 'auto';
alter table public.generations add column if not exists image_provider text;
alter table public.generations add column if not exists image_model text;
alter table public.generations add column if not exists prompt_text text;
alter table public.generations add column if not exists prompt_seed bigint;
alter table public.generations add column if not exists estimated_cost_usd numeric(12,6);
alter table public.generations add column if not exists latency_ms integer;
alter table public.generations add column if not exists retry_attempt integer not null default 0;
alter table public.generations add column if not exists parent_generation_id bigint references public.generations(id) on delete set null;
alter table public.generations add column if not exists safety_judge_result jsonb not null default '{}'::jsonb;

create index if not exists idx_generations_user_created_at on public.generations(user_id, created_at desc);
create index if not exists idx_generations_mode on public.generations(generation_mode);

-- Atomic job claim for the external clipping engine.
create or replace function public.claim_engine_jobs(p_worker text, p_max integer)
returns setof public.engine_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.engine_jobs j
     set status = 'running',
         worker = p_worker,
         claimed_at = now(),
         attempts = j.attempts + 1
   where j.id in (
     select id from public.engine_jobs
      where status = 'queued'
      order by created_at
      limit greatest(1, least(p_max, 50))
      for update skip locked
   )
  returning j.*;
end
$$;

revoke all on function public.claim_engine_jobs(text, integer) from public, anon, authenticated;

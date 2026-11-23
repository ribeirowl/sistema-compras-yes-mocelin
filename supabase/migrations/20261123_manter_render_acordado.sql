-- Mantém o sistema no Render acordado no expediente: o plano gratuito hiberna
-- após ~15 min sem acesso e o primeiro acesso espera ~1 min o servidor subir.
-- O próprio banco (pg_cron + pg_net) acessa o site a cada 5 minutos — confiável,
-- ao contrário do agendamento do GitHub Actions, que atrasa horas.
-- Janela: seg–sex, 10h–21h55 UTC = 07h–18h55 em Brasília. Fora disso deixa dormir:
-- o plano gratuito tem 750 h/mês somadas na workspace (sistema + CRM), e 24/7
-- consumiria ~730 h só com este serviço.
-- Aplicado no projeto Supabase "Sistema de Compras" em 23/11/2026.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'manter-render-acordado';

select cron.schedule(
  'manter-render-acordado',
  '*/5 10-21 * * 1-5',
  $$ select net.http_get(
       url := 'https://sistema-compras-yes-mocelin.onrender.com/app/',
       timeout_milliseconds := 60000
     ); $$
);

-- Conferir:   select * from cron.job_run_details order by start_time desc limit 10;
-- Respostas:  select status_code, created from net._http_response order by id desc limit 10;
-- Desligar:   select cron.unschedule('manter-render-acordado');

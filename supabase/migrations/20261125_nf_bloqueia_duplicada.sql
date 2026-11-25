-- Impede NF duplicada (mesmo número + loja + emitente). Aplicada em 25/11/2026 após
-- a importação de NF Intelbras gerar 240 cópias (checagem de existentes estourava a URL).
create or replace function public.nf_bloqueia_duplicada() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.notas_fiscais where numero = new.numero and loja_cnpj = new.loja_cnpj and coalesce(emit_cnpj,'') = coalesce(new.emit_cnpj,'')) then
    raise exception 'NF % já existe para esta loja', new.numero using errcode = '23505';
  end if;
  return new;
end $$;
drop trigger if exists trg_nf_bloqueia_duplicada on public.notas_fiscais;
create trigger trg_nf_bloqueia_duplicada before insert on public.notas_fiscais for each row execute function public.nf_bloqueia_duplicada();

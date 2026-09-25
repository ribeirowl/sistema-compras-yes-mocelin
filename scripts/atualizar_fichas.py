#!/usr/bin/env python3
"""Confere diariamente os PDFs do public/fichas.json e conserta os links quebrados.

Roda no GitHub Actions (.github/workflows/fichas.yml). Só usa a biblioteca padrão.

1. Confere (HEAD) todos os PDFs do índice no backend da Intelbras.
2. Para cada PDF que a Intelbras tirou do ar (404), abre a página do produto no
   site dela e procura o arquivo substituto (datasheet novo / manual novo).
3. Sem substituto: tira só aquela aba; produto sem nenhum PDF sai do índice.
4. Grava o fichas.json apenas se algo mudou e escreve um resumo em Markdown.

Segurança: timeouts, 5xx e bloqueios (403/429) NUNCA apagam nada, só 404/410.
Se mais de LIMITE_QUEBRADOS dos links derem 404 de uma vez, o script aborta sem
alterar nada (sinal de que o site mudou ou está bloqueando o robô).
"""
import concurrent.futures as cf
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARQ_FICHAS = os.path.join(RAIZ, 'public', 'fichas.json')
ARQ_PAGINAS = os.path.join(RAIZ, 'scripts', 'fichas_paginas.json')
ARQ_RESUMO = os.environ.get('FICHAS_RESUMO', os.path.join(RAIZ, 'fichas_resumo.md'))

BASE_PDF = os.environ.get('FICHAS_BASE_PDF', 'https://backend.intelbras.com/sites/default/files/')
BASE_PAGINA = os.environ.get('FICHAS_BASE_PAGINA', 'https://www.intelbras.com/pt-br/')
LIMITE_QUEBRADOS = float(os.environ.get('FICHAS_LIMITE', '0.05'))  # 5 %
PARALELO = int(os.environ.get('FICHAS_PARALELO', '12'))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

RE_PDF = re.compile(r'backend\.intelbras\.com/sites/default/files/([^"\'\s\\)<>]+?\.pdf)', re.I)
RE_FICHA = re.compile(r'datasheet|ficha[_\-\s%20]*t[eé]cnica', re.I)
RE_MANUAL = re.compile(r'manual|guia', re.I)
RE_GENERICO = re.compile(r'compatibilidade|condominial|boas[_\-%20]*pr|comparativ|tabela|changelog|'
                         r'tutorial|procedimento|informativo|higieniza|banner|lista_|como[-_]', re.I)


def pedir(url, metodo='HEAD', tentativas=3):
    """Devolve (status, content-type, corpo|None). status 0 = erro de rede."""
    for i in range(tentativas):
        try:
            req = urllib.request.Request(url, method=metodo, headers={'User-Agent': UA, 'Accept': '*/*'})
            with urllib.request.urlopen(req, timeout=30) as r:
                corpo = r.read() if metodo == 'GET' else None
                return r.status, r.headers.get('Content-Type', ''), corpo
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return e.code, e.headers.get('Content-Type', ''), None
            if e.code == 405 and metodo == 'HEAD':  # servidor sem HEAD: tenta GET
                return pedir(url, 'GET', 1)
            ultimo = (e.code, '', None)
        except Exception:
            ultimo = (0, '', None)
        time.sleep(2 * (i + 1))
    return ultimo


def situacao(caminho):
    st, ct, _ = pedir(BASE_PDF + caminho)
    if st == 200 and 'pdf' in ct.lower():
        return 'ok'
    if st in (404, 410) or (st == 200 and 'html' in ct.lower()):
        return 'morto'
    return 'incerto'  # timeout, 403, 5xx... não mexe


def tokens(modelo):
    return [t for t in re.split(r'[^a-z0-9]+', modelo.lower()) if len(t) >= 2]


def escolher(links, modelo, filtro, mortos):
    """Melhor PDF da página para a aba: casa com o filtro, não é genérico, não está morto.
    Prefere o que cita o modelo e, empatando, o mais recente (pasta AAAA-MM)."""
    cand = [l for l in links if filtro.search(l) and not RE_GENERICO.search(l) and l not in mortos]
    if not cand:
        return None
    tk = tokens(modelo)

    def nota(l):
        nome = re.sub(r'%20|[_\-]', ' ', l.lower())
        casa = sum(1 for t in tk if t in nome)
        pasta = l.split('/')[0]
        return (casa, pasta if re.match(r'\d{4}-\d{2}$', pasta) else '0000-00')
    cand.sort(key=nota, reverse=True)
    for l in cand:  # primeiro que realmente abre
        if situacao(l) == 'ok':
            return l
    return None


def main():
    dados = json.load(open(ARQ_FICHAS, encoding='utf-8'))
    itens = dados['itens']
    paginas = json.load(open(ARQ_PAGINAS, encoding='utf-8'))

    caminhos = sorted({p for v in itens.values() for p in v[1:3] if p})
    # teste rápido: se o site não responde, para antes de gastar 1 h em tentativas
    amostra = caminhos[::max(1, len(caminhos) // 20)][:20]
    with cf.ThreadPoolExecutor(PARALELO) as ex:
        prova = list(ex.map(lambda p: pedir(BASE_PDF + p, tentativas=1)[0], amostra))
    if amostra and sum(1 for s in prova if s in (0, 403, 429) or s >= 500) > len(amostra) / 2:
        msg = f'ABORTADO: o site da Intelbras não respondeu ao teste ({prova}). Nada alterado.'
        print(msg)
        open(ARQ_RESUMO, 'w', encoding='utf-8').write(f'## Fichas técnicas\n\n{msg}\n')
        sys.exit(1)

    print(f'Conferindo {len(caminhos)} PDFs de {len(itens)} produtos...', flush=True)
    with cf.ThreadPoolExecutor(PARALELO) as ex:
        res = dict(zip(caminhos, ex.map(situacao, caminhos)))
    mortos = {p for p, s in res.items() if s == 'morto'}
    incertos = [p for p, s in res.items() if s == 'incerto']
    print(f'ok={len(caminhos) - len(mortos) - len(incertos)} mortos={len(mortos)} incertos={len(incertos)}')

    if caminhos and len(mortos) / len(caminhos) > LIMITE_QUEBRADOS:
        msg = (f'ABORTADO: {len(mortos)} de {len(caminhos)} PDFs deram 404 de uma vez. '
               'Provável mudança/bloqueio no site da Intelbras; nada foi alterado.')
        print(msg)
        open(ARQ_RESUMO, 'w', encoding='utf-8').write(f'## Fichas técnicas\n\n{msg}\n')
        sys.exit(1)
    if len(incertos) > len(caminhos) * 0.5:
        msg = f'ABORTADO: {len(incertos)} PDFs sem resposta (site fora ou bloqueando). Nada alterado.'
        print(msg)
        open(ARQ_RESUMO, 'w', encoding='utf-8').write(f'## Fichas técnicas\n\n{msg}\n')
        sys.exit(1)

    # página do produto: a do próprio código ou a de outro código que usa o mesmo PDF
    pag_por_pdf = {}
    for c, v in itens.items():
        if c in paginas:
            for p in v[1:3]:
                if p:
                    pag_por_pdf.setdefault(p, paginas[c])

    cache_pag = {}

    def links_da_pagina(slug):
        if slug not in cache_pag:
            st, _, corpo = pedir(BASE_PAGINA + slug, 'GET')
            txt = corpo.decode('utf-8', 'replace') if (st == 200 and corpo) else ''
            cache_pag[slug] = list(dict.fromkeys(RE_PDF.findall(txt)))
        return cache_pag[slug]

    trocas, removidos = [], []
    for c in sorted(itens):
        modelo, ficha, manual = itens[c]
        if ficha not in mortos and manual not in mortos:
            continue
        slug = paginas.get(c) or pag_por_pdf.get(ficha) or pag_por_pdf.get(manual)
        links = links_da_pagina(slug) if slug else []
        novo_f, novo_m = ficha, manual
        if ficha in mortos:
            novo_f = escolher(links, modelo, RE_FICHA, mortos) or ''
        if manual in mortos:
            novo_m = escolher(links, modelo, RE_MANUAL, mortos) or ''
        if not novo_f and not novo_m:
            # sem ficha: aproveita um manual/guia do próprio produto, se houver
            novo_m = escolher(links, modelo, RE_MANUAL, mortos) or ''
        if novo_f == novo_m:
            novo_m = ''
        if not novo_f and not novo_m:
            del itens[c]
            removidos.append((c, modelo))
        else:
            itens[c] = [modelo, novo_f, novo_m]
            trocas.append((c, modelo, ficha, novo_f, manual, novo_m))

    linhas = ['## Fichas técnicas — verificação diária', '',
              f'- PDFs conferidos: **{len(caminhos)}** · fora do ar: **{len(mortos)}** · sem resposta (ignorados): {len(incertos)}',
              f'- Produtos corrigidos: **{len(trocas)}** · removidos do índice: **{len(removidos)}**', '']
    if trocas:
        linhas += ['| Código | Modelo | Ficha técnica | Manual |', '|---|---|---|---|']
        for c, m, f0, f1, m0, m1 in trocas:
            fmt = lambda a, b: '—' if a == b else (f'`{b}`' if b else '~~removida~~')
            linhas.append(f'| {c} | {m} | {fmt(f0, f1)} | {fmt(m0, m1)} |')
        linhas.append('')
    if removidos:
        linhas.append('Removidos (nenhum PDF disponível): ' + ', '.join(f'{c} {m}' for c, m in removidos))
    open(ARQ_RESUMO, 'w', encoding='utf-8').write('\n'.join(linhas) + '\n')

    if trocas or removidos:
        json.dump(dados, open(ARQ_FICHAS, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        print(f'fichas.json atualizado: {len(trocas)} corrigidos, {len(removidos)} removidos.')
    else:
        print('Nada a alterar.')


if __name__ == '__main__':
    main()

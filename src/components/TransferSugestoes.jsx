import { useEffect, useMemo, useState } from 'react'
import { normStr, todayStr } from '../utils.js'
import { FILIAIS, nomeFilial, curtoFilial, sugerirTransferencias, passaCorte, CORTE_PADRAO } from '../analise/transferencias.js'
import { gerarPdfsTransferencia } from '../analise/transferenciaPdf.js'

const brl = v => (v ?? 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL', maximumFractionDigits:0 })
const SEL_KEY = 'sc_transf_sel'
const lerSel = () => { try { return JSON.parse(sessionStorage.getItem(SEL_KEY) || '{}') } catch { return {} } }

// Dias de estoque com cor: no destino, pouco = vermelho/amarelo; na origem, só informativo
function Dias({ d, origem }) {
  if (d == null) return <span className="tf-dias sem">sem giro</span>
  const cls = origem ? 'org' : d < 15 ? 'baixo' : d < 45 ? 'medio' : 'ok'
  return <span className={`tf-dias ${cls}`}>{d}d</span>
}

export default function TransferSugestoes({ rawItems, priceMap, discMap, transferRequests, onUpdate, userName, logo, showPrices }) {
  const [corte, setCorte]   = useState(CORTE_PADRAO)
  const [origem, setOrigem] = useState('')
  const [destino, setDestino] = useState('')
  const [busca, setBusca]   = useState('')
  const [soSel, setSoSel]   = useState(false)
  const [sel, setSel]       = useState(lerSel)         // { [id]: qtd }
  const [registrar, setRegistrar] = useState(true)
  const [gerando, setGerando] = useState(false)
  const [aviso, setAviso]   = useState(null)

  useEffect(() => { try { sessionStorage.setItem(SEL_KEY, JSON.stringify(sel)) } catch {} }, [sel])

  const todas = useMemo(() => sugerirTransferencias(rawItems, priceMap, { discMap, transferRequests }), [rawItems, priceMap, discMap, transferRequests])
  const relevantes = useMemo(() => todas.filter(l => passaCorte(l, corte) || sel[l.id] != null), [todas, corte, sel])

  const filtradas = useMemo(() => {
    const q = normStr(busca)
    return relevantes.filter(l =>
      (!origem || l.from === origem) && (!destino || l.to === destino) &&
      (!soSel || sel[l.id] != null) &&
      (!q || normStr(l.code).includes(q) || normStr(l.description).includes(q)))
  }, [relevantes, origem, destino, busca, soSel, sel])

  // Rotas (origem → destino) em ordem de valor
  const rotas = useMemo(() => {
    const m = new Map()
    for (const l of relevantes) {
      const k = `${l.from}__${l.to}`
      const r = m.get(k) || { k, from:l.from, to:l.to, itens:0, valor:0 }
      r.itens++; r.valor += l.valor; m.set(k, r)
    }
    return [...m.values()].sort((a, b) => b.valor - a.valor)
  }, [relevantes])

  const grupos = useMemo(() => {
    const m = new Map()
    for (const l of filtradas) {
      const k = `${l.from}__${l.to}`
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(l)
    }
    return rotas.filter(r => m.has(r.k)).map(r => ({ ...r, linhas: m.get(r.k) }))
  }, [filtradas, rotas])

  const qtdDe = l => sel[l.id] ?? l.qtd
  const selecionadas = useMemo(() => todas.filter(l => sel[l.id] != null).map(l => ({ ...l, qtd: Number(sel[l.id]) || 0 })).filter(l => l.qtd > 0), [todas, sel])
  const valorSel = selecionadas.reduce((s, l) => s + l.qtd * l.pv, 0)
  const lojasOrigemSel = [...new Set(selecionadas.map(l => l.from))]

  const alternar = l => setSel(s => { const n = { ...s }; if (n[l.id] != null) delete n[l.id]; else n[l.id] = l.qtd; return n })
  const alternarGrupo = (linhas, marcar) => setSel(s => { const n = { ...s }; for (const l of linhas) { if (marcar) n[l.id] ??= l.qtd; else delete n[l.id] } return n })
  const mudarQtd = (l, v) => setSel(s => ({ ...s, [l.id]: Math.max(0, parseInt(v, 10) || 0) }))

  const gerar = async () => {
    if (!selecionadas.length) return
    setGerando(true); setAviso(null)
    try {
      const arquivos = await gerarPdfsTransferencia(selecionadas, { logoUrl: logo ? new URL(logo, window.location.href).href : '', comValor: showPrices, autor: userName || 'Gabriel Ribeiro' })
      let registradas = 0
      if (registrar) {
        const agora = new Date().toISOString(), hoje = todayStr()
        const numeroDe = Object.fromEntries(arquivos.map(a => [a.origem, a.numero]))
        const novas = selecionadas.map(l => ({
          id: `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          code: l.code, description: l.description, cityGroup: l.to, fromStore: l.from,
          status: 'APROVADO', transferQty: l.qtd, transferDate: hoje,
          createdBy: userName || 'Gabriel', createdAt: agora, resolvedBy: userName || 'Gabriel', resolvedAt: agora,
          origem: 'SUGESTAO', numero: numeroDe[l.from] || '',
          observation: `Sugestão automática · ${numeroDe[l.from] || ''}`,
        }))
        onUpdate([...(transferRequests || []), ...novas])
        registradas = novas.length
      }
      setAviso({ ok:true, txt:`${arquivos.length} PDF(s) gerado(s): ${arquivos.map(a => curtoFilial(a.origem)).join(', ')}.${registradas ? ` ${registradas} transferência(s) registrada(s) — saem das sugestões e entram no histórico.` : ''}` })
      if (registrar) setSel({})
    } catch (e) {
      console.error(e); setAviso({ ok:false, txt:'Não foi possível gerar os PDFs: ' + e.message })
    } finally { setGerando(false) }
  }

  if (!(rawItems || []).length) {
    return <div className="table-empty"><div className="table-empty-icon">🔄</div><p>Suba o relatório de estoque (botão Dados) para ver as sugestões de transferência.</p></div>
  }

  const totalValor = relevantes.reduce((s, l) => s + l.valor, 0)

  return (
    <div className="tf">
      {/* Números do topo */}
      <div className="tf-kpis">
        <div className="tf-kpi"><span>Sugestões</span><strong>{relevantes.length}</strong><small>de {todas.length} possíveis</small></div>
        {showPrices && <div className="tf-kpi"><span>Deixa de comprar</span><strong>{brl(totalValor)}</strong><small>se transferir tudo</small></div>}
        <div className="tf-kpi tf-kpi-sel"><span>Selecionadas</span><strong>{selecionadas.length}</strong><small>{showPrices ? brl(valorSel) : `${selecionadas.reduce((s,l)=>s+l.qtd,0)} un.`}</small></div>
      </div>

      {/* Rotas */}
      <div className="tf-rotas">
        {rotas.map(r => {
          const ativa = origem === r.from && destino === r.to
          return (
            <button key={r.k} type="button" className={`tf-rota${ativa ? ' on' : ''}`}
              onClick={() => { if (ativa) { setOrigem(''); setDestino('') } else { setOrigem(r.from); setDestino(r.to) } }}>
              <span className="tf-rota-nome">{curtoFilial(r.from)} <b>→</b> {curtoFilial(r.to)}</span>
              <span className="tf-rota-num">{r.itens} itens{showPrices && ` · ${brl(r.valor)}`}</span>
            </button>
          )
        })}
      </div>

      {/* Filtros */}
      <div className="tf-filtros">
        <select className="filter-select" value={origem} onChange={e => setOrigem(e.target.value)}>
          <option value="">Todas as origens</option>
          {FILIAIS.map(f => <option key={f.id} value={f.id}>De {f.nome}</option>)}
        </select>
        <select className="filter-select" value={destino} onChange={e => setDestino(e.target.value)}>
          <option value="">Todos os destinos</option>
          {FILIAIS.map(f => <option key={f.id} value={f.id}>Para {f.nome}</option>)}
        </select>
        <input className="filter-search" placeholder="Buscar código ou descrição" value={busca} onChange={e => setBusca(e.target.value)}/>
        <label className="tf-corte" title="Mostra só transferências que valem a pena">
          Corte: R$ <input type="number" min="0" step="100" value={corte.valor} onChange={e => setCorte(c => ({ ...c, valor: +e.target.value || 0 }))}/>
          ou <input type="number" min="0" step="5" value={corte.unidades} onChange={e => setCorte(c => ({ ...c, unidades: +e.target.value || 0 }))}/> un.
        </label>
        <label className="filter-toggle"><input type="checkbox" checked={soSel} onChange={e => setSoSel(e.target.checked)}/><span>Só selecionadas</span></label>
      </div>

      {grupos.length === 0
        ? <div className="table-empty"><div className="table-empty-icon">✅</div><p>Nenhuma transferência com esses filtros.</p></div>
        : grupos.map(g => {
            const marcadas = g.linhas.filter(l => sel[l.id] != null).length
            return (
              <section key={g.k} className="tf-grupo">
                <header>
                  <label className="tf-check">
                    <input type="checkbox" checked={marcadas === g.linhas.length} ref={el => { if (el) el.indeterminate = marcadas > 0 && marcadas < g.linhas.length }}
                      onChange={e => alternarGrupo(g.linhas, e.target.checked)}/>
                  </label>
                  <h3>{nomeFilial(g.from)} <span>→</span> {nomeFilial(g.to)}</h3>
                  <span className="tf-grupo-num">{g.linhas.length} itens{showPrices && ` · ${brl(g.linhas.reduce((s, l) => s + l.valor, 0))}`}{marcadas > 0 && ` · ${marcadas} selecionado(s)`}</span>
                </header>
                <div className="table-scroll">
                  <table className="product-table tf-tabela">
                    <thead>
                      <tr className="tf-th-grupo">
                        <th colSpan={3}></th>
                        <th colSpan={2} className="tf-th-o">Origem · {curtoFilial(g.from)}</th>
                        <th colSpan={3} className="tf-th-d">Destino · {curtoFilial(g.to)}</th>
                        <th colSpan={showPrices ? 3 : 2} className="tf-th-t">Transferência</th>
                      </tr>
                      <tr>
                        <th style={{width:34}}></th><th>Código</th><th>Descrição</th>
                        <th className="num tf-o" title="Disponível (estoque − reservado) na origem">Estoque</th>
                        <th className="num" title="Dias de estoque na origem pela média do mês">Dias</th>
                        <th className="num tf-d" title="Disponível no destino">Estoque</th>
                        <th className="num" title="Dias de estoque no destino">Dias</th>
                        <th className="num" title="Sugestão de compra do destino (teto da transferência)">Sugestão</th>
                        <th className="num tf-t">Qtd</th>
                        <th className="num" title="Dias de estoque do destino depois de receber">Destino fica</th>
                        {showPrices && <th className="num">Valor</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {g.linhas.map(l => {
                        const on = sel[l.id] != null
                        const q = qtdDe(l)
                        const depois = l.destino.media > 0 ? Math.round((l.destino.disp + q) / (l.destino.media / 30)) : null
                        return (
                          <tr key={l.id} className={on ? 'tf-on' : ''}>
                            <td><input type="checkbox" checked={on} onChange={() => alternar(l)}/></td>
                            <td className="mono">{l.code}</td>
                            <td className="tf-desc">
                              <div className="col-desc-inner">{l.description}</div>
                              {l.encerrado && <span className="tf-tag" title={l.substituto ? `Substituto: ${l.substituto}` : ''}>encerrado — último estoque</span>}
                            </td>
                            <td className="num tf-o mono"><b>{l.origem.disp}</b></td>
                            <td className="num"><Dias d={l.origem.dias} origem/></td>
                            <td className="num tf-d mono"><b>{l.destino.disp}</b></td>
                            <td className="num"><Dias d={l.destino.dias}/></td>
                            <td className="num mono">{l.destino.sugestao}</td>
                            <td className="num tf-t">
                              <input type="number" min="0" className="tf-qtd" value={q}
                                onChange={e => mudarQtd(l, e.target.value)} onFocus={() => { if (!on) alternar(l) }}/>
                            </td>
                            <td className="num"><Dias d={depois}/></td>
                            {showPrices && <td className="num mono tf-valor">{brl(q * l.pv)}</td>}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          })}

      {/* Barra de ação */}
      <div className={`tf-barra${selecionadas.length ? ' ativa' : ''}`}>
        <div className="tf-barra-info">
          {selecionadas.length
            ? <><strong>{selecionadas.length} itens</strong> · {selecionadas.reduce((s, l) => s + l.qtd, 0)} un.{showPrices && ` · ${brl(valorSel)}`} · {lojasOrigemSel.length} loja(s) de origem</>
            : 'Marque as transferências para gerar os PDFs'}
          {aviso && <div className={aviso.ok ? 'tf-ok' : 'tf-erro'}>{aviso.txt}</div>}
        </div>
        <label className="filter-toggle" title="Grava no histórico (aprovadas, saindo hoje) e tira das próximas sugestões">
          <input type="checkbox" checked={registrar} onChange={e => setRegistrar(e.target.checked)}/><span>Registrar no histórico</span>
        </label>
        {selecionadas.length > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSel({})}>Limpar</button>}
        <button type="button" className="btn btn-yellow" disabled={!selecionadas.length || gerando} onClick={gerar}>
          {gerando ? 'Gerando…' : `⬇️ Gerar PDFs por loja${lojasOrigemSel.length ? ` (${lojasOrigemSel.length})` : ''}`}
        </button>
      </div>
    </div>
  )
}

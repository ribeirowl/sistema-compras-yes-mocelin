import { useState, useMemo } from 'react'
import { fmtDate } from '../utils.js'
import { Sparkle, ClipboardText, Truck, ArrowsLeftRight } from '@phosphor-icons/react'
import { getCityGroup } from '../rules.js'

const D = 86400000
const startOfDay = d => { const x = new Date(d); x.setHours(0,0,0,0); return x }
const parseDate  = s => s ? new Date(String(s).slice(0,10)+'T00:00:00') : null

const LOJAS = [
  { id:'BELTRAO', label:'Beltrão + DV' },
  { id:'TOLEDO',  label:'Toledo' },
]
// Usa o MESMO mapeamento do resto do sistema (rules.js), em vez de uma regra propria

const STATUS_CFG = {
  PENDENTE: { label:'Pendente', cls:'warn' },
  APROVADO: { label:'Aprovada', cls:'ok' },
  RECUSADO: { label:'Recusada', cls:'danger' },
}

function Painel({ icon:Icon, title, sub, count, children }) {
  return (
    <section className="panel">
      <div className="panel-head panel-head-row">
        <span className="panel-ico"><Icon size={18} weight="bold"/></span>
        <div>
          <h3 className="panel-title">{title}</h3>
          {sub && <p className="panel-sub">{sub}</p>}
        </div>
        {count != null && <span className="panel-count">{count}</span>}
      </div>
      {children}
    </section>
  )
}

export default function DashboardVendedor({ rawItems, availMap, orders, purchaseRequests, transferRequests, userName, onGoTab }) {
  const [loja, setLoja] = useState('BELTRAO')
  const hoje = startOfDay(new Date())

  // Oportunidades: sem estoque na loja escolhida, mas disponível imediato na Intelbras
  const oportunidades = useMemo(() => {
    if (!availMap || availMap.size===0) return []
    const porCodigo = new Map()
    ;(rawItems||[]).forEach(i => {
      if (getCityGroup(i.empresa) !== loja) return
      const at = porCodigo.get(i.code) || { code:i.code, description:i.description, stock:0, avgMonthly:0 }
      at.stock      += i.stock||0
      at.avgMonthly += i.avgMonthly||0
      at.description = at.description || i.description
      porCodigo.set(i.code, at)
    })
    return [...porCodigo.values()]
      .filter(i => i.stock <= 0 && availMap.get(i.code)?.origemImediato)
      .sort((a,b)=> (b.avgMonthly||0)-(a.avgMonthly||0))
      .slice(0,12)
  }, [rawItems, availMap, loja])

  const minhas = useMemo(() => {
    const meu = (userName||'').trim().toLowerCase()
    return (purchaseRequests||[])
      .filter(r => (r.createdBy||'').trim().toLowerCase() === meu)
      .sort((a,b)=> new Date(b.createdAt||0) - new Date(a.createdAt||0))
      .slice(0,10)
  }, [purchaseRequests, userName])

  const minhasTransf = useMemo(() => {
    const meu = (userName||'').trim().toLowerCase()
    return (transferRequests||[])
      .filter(t => (t.createdBy||'').trim().toLowerCase() === meu)
      .sort((a,b)=> new Date(b.createdAt||0) - new Date(a.createdAt||0))
      .slice(0,10)
  }, [transferRequests, userName])

  const chegando = useMemo(() => {
    const lim = new Date(hoje.getTime() + 15*D)
    return (orders||[])
      .filter(o => o.source==='carteira' && !o.receivedAt && o.cityGroup===loja)
      .filter(o => { const a=parseDate(o.arrivalDate); return a && a>=hoje && a<=lim })
      .sort((a,b)=> String(a.arrivalDate).localeCompare(String(b.arrivalDate)))
      .slice(0,12)
  }, [orders, loja, hoje])

  const pend = minhas.filter(r=>r.status==='PENDENTE').length

  return (
    <>
      <div className="seg-row">
        <span className="seg-label">Loja</span>
        <div className="seg">
          {LOJAS.map(l=>(
            <button key={l.id} className={`seg-btn${loja===l.id?' active':''}`}
              onClick={()=>setLoja(l.id)}>{l.label}</button>
          ))}
        </div>
      </div>

      <div className="dash-two-col">
        <Painel icon={Sparkle} title="Oportunidades"
          sub="Sem estoque na loja e disponível imediato na Intelbras"
          count={oportunidades.length}>
          {oportunidades.length===0
            ? <div className="panel-empty">Nada a destacar agora.</div>
            : (
              <ul className="mini-list">
                {oportunidades.map(i=>(
                  <li key={i.code}>
                    <span className="mono mini-code">{i.code}</span>
                    <span className="mini-desc" title={i.description}>{i.description}</span>
                    <span className="pill pill-ok">Disponível</span>
                    <button className="btn btn-yellow btn-sm" onClick={()=>onGoTab('pesquisa')}>Solicitar</button>
                  </li>
                ))}
              </ul>
            )}
        </Painel>

        <Painel icon={Truck} title="Chegando na loja" sub="Próximos 15 dias" count={chegando.length}>
          {chegando.length===0
            ? <div className="panel-empty">Nada previsto para os próximos 15 dias.</div>
            : (
              <ul className="mini-list">
                {chegando.map(o=>(
                  <li key={o.id}>
                    <span className="mono mini-code">{o.code}</span>
                    <span className="mini-desc" title={o.description}>{o.description}</span>
                    <span className="mini-qty">{o.qty} un</span>
                    <span className="mini-date">{fmtDate(o.arrivalDate)}</span>
                  </li>
                ))}
              </ul>
            )}
        </Painel>
      </div>

      <div className="dash-two-col">
        <Painel icon={ClipboardText} title="Minhas solicitações"
          sub={pend>0?`${pend} aguardando aprovação`:'Últimas enviadas'} count={minhas.length}>
          {minhas.length===0
            ? <div className="panel-empty">Você ainda não fez solicitações.</div>
            : (
              <ul className="mini-list">
                {minhas.map(r=>{
                  const st = STATUS_CFG[r.status] || STATUS_CFG.PENDENTE
                  return (
                    <li key={r.id}>
                      <span className="mono mini-code">{r.code}</span>
                      <span className="mini-desc" title={r.description}>{r.description}</span>
                      <span className="mini-qty">{r.qty} un</span>
                      <span className={`pill pill-${st.cls}`}>{st.label}</span>
                    </li>
                  )
                })}
              </ul>
            )}
        </Painel>

        <Painel icon={ArrowsLeftRight} title="Minhas transferências"
          sub="Sugestões de transferência entre lojas" count={minhasTransf.length}>
          {minhasTransf.length===0
            ? <div className="panel-empty">Você ainda não sugeriu transferências.</div>
            : (
              <ul className="mini-list">
                {minhasTransf.map(t=>{
                  const st = STATUS_CFG[t.status] || STATUS_CFG.PENDENTE
                  return (
                    <li key={t.id}>
                      <span className="mono mini-code">{t.code}</span>
                      <span className="mini-desc" title={t.description}>{t.description}</span>
                      {t.status==='APROVADO' && t.transferQty
                        ? <span className="mini-qty">{t.transferQty} un · {fmtDate(t.transferDate)}</span>
                        : <span className="mini-qty">—</span>}
                      <span className={`pill pill-${st.cls}`}>{st.label}</span>
                    </li>
                  )
                })}
              </ul>
            )}
        </Painel>
      </div>
    </>
  )
}

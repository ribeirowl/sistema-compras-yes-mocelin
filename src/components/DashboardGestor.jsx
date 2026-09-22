import { useMemo } from 'react'
import {
  FunnelChart, Funnel, LabelList, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { fmtBRL } from '../utils.js'
import {
  ShoppingCart, WarningCircle, Truck, ClockCountdown,
} from '@phosphor-icons/react'

const D = 86400000
const startOfDay = d => { const x = new Date(d); x.setHours(0,0,0,0); return x }
const parseDate  = s => s ? new Date(String(s).slice(0,10)+'T00:00:00') : null

// ─── KPIs ────────────────────────────────────────────────────────────────────
function Kpi({ icon:Icon, label, value, hint, tone='ink', onClick }) {
  return (
    <button className={`kpi kpi-${tone}`} onClick={onClick} disabled={!onClick}>
      <span className="kpi-ico"><Icon size={20} weight="bold"/></span>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </button>
  )
}

export default function DashboardGestor({ tabSummary, tabItems, orders, purchaseRequests, onGoTab, caps }) {
  const hoje = startOfDay(new Date())

  const kpis = useMemo(() => {
    const all = [...(tabItems?.BELTRAO||[]), ...(tabItems?.TOLEDO||[]), ...(tabItems?.OUTROS||[])]

    // A comprar — mesmo cálculo do tabSummary (adjustedQty × pv)
    const aComprar = ['BELTRAO','TOLEDO','OUTROS']
      .reduce((s,t)=> s + (tabSummary?.[t]?.totalValue ?? 0), 0)

    // Ruptura crítica — cobertura < 15 dias (mesma regra do filtro da tabela)
    const ruptura = all.filter(i => {
      const dias = i.avgMonthly > 0 ? Math.floor((i.stock / i.avgMonthly) * 30) : null
      return dias !== null && dias < 15
    }).length

    const emCarteira = (orders||[]).filter(o => o.source==='carteira' && !o.receivedAt)
    const chegando7 = emCarteira.filter(o => {
      const a = parseDate(o.arrivalDate); if (!a) return false
      return a >= hoje && a <= new Date(hoje.getTime() + 7*D)
    }).length
    const vencidos = emCarteira.filter(o => {
      const a = parseDate(o.arrivalDate); return a && a < hoje
    }).length

    return { aComprar, ruptura, chegando7, vencidos }
  }, [tabItems, tabSummary, orders, hoje])

  // ─── Funil ──────────────────────────────────────────────────────────────────
  const funil = useMemo(() => {
    const all = [...(tabItems?.BELTRAO||[]), ...(tabItems?.TOLEDO||[]), ...(tabItems?.OUTROS||[])]
    const sugerido   = all.filter(i => i.suggestion > 0).length
    const solicitado = (purchaseRequests||[]).filter(r => r.status==='PENDENTE').length
    const carteira   = (orders||[]).filter(o => o.source==='carteira' && !o.receivedAt).length
    const recebido   = (orders||[]).filter(o => o.receivedAt &&
      (Date.now() - new Date(o.receivedAt).getTime()) <= 30*D).length
    return [
      { name:'Sugerido',    value: Math.max(sugerido,1),   real: sugerido,   fill:'#F2BE00' },
      { name:'Solicitado',  value: Math.max(solicitado,1), real: solicitado, fill:'#E3A008' },
      { name:'Em carteira', value: Math.max(carteira,1),   real: carteira,   fill:'#6D49D8' },
      { name:'Recebido 30d',value: Math.max(recebido,1),   real: recebido,   fill:'#1FA55B' },
    ]
  }, [tabItems, purchaseRequests, orders])

  // ─── Chegadas por semana (próximas 4) ───────────────────────────────────────
  const semanas = useMemo(() => {
    const buckets = [0,1,2,3].map(i => {
      const ini = new Date(hoje.getTime() + i*7*D)
      const fim = new Date(hoje.getTime() + (i+1)*7*D)
      return { label: i===0 ? 'Esta semana' : `+${i} sem`, ini, fim, itens:0, qtd:0 }
    })
    ;(orders||[]).filter(o => o.source==='carteira' && !o.receivedAt).forEach(o => {
      const a = parseDate(o.arrivalDate); if (!a) return
      const b = buckets.find(b => a >= b.ini && a < b.fim)
      if (b) { b.itens++; b.qtd += (o.qty||0) }
    })
    return buckets.map(({label,itens,qtd}) => ({ label, itens, qtd }))
  }, [orders, hoje])

  // ─── Aging da carteira ──────────────────────────────────────────────────────
  const aging = useMemo(() => {
    const faixas = [
      { label:'até 15 dias', max:15,       n:0, tone:'ok' },
      { label:'15 a 30',     max:30,       n:0, tone:'warn' },
      { label:'30 a 60',     max:60,       n:0, tone:'danger' },
      { label:'mais de 60',  max:Infinity, n:0, tone:'danger' },
    ]
    ;(orders||[]).filter(o => o.source==='carteira' && !o.receivedAt).forEach(o => {
      const d = parseDate(o.date); if (!d) return
      const dias = Math.floor((hoje - d)/D)
      const f = faixas.find(f => dias <= f.max)
      if (f) f.n++
    })
    const total = faixas.reduce((s,f)=>s+f.n,0) || 1
    return faixas.map(f => ({ ...f, pct: Math.round(f.n/total*100) }))
  }, [orders, hoje])

  const temCarteira = (orders||[]).some(o => o.source==='carteira' && !o.receivedAt)

  return (
    <>
      {/* KPIs */}
      <div className="kpi-row">
        {caps.seePrices && (
          <Kpi icon={ShoppingCart} label="A comprar" tone="accent"
            value={fmtBRL(kpis.aComprar)} hint="Sugestão consolidada"
            onClick={()=>onGoTab('BELTRAO')}/>
        )}
        <Kpi icon={WarningCircle} label="Ruptura crítica" tone="danger"
          value={kpis.ruptura} hint="Menos de 15 dias de cobertura"
          onClick={()=>onGoTab('BELTRAO')}/>
        <Kpi icon={Truck} label="Chegando em 7 dias" tone="info"
          value={kpis.chegando7} hint="Itens da carteira"/>
        <Kpi icon={ClockCountdown} label="Previsão vencida" tone="warn"
          value={kpis.vencidos} hint="Passou da data e não chegou"/>
      </div>

      <div className="dash-two-col">
        {/* Funil */}
        <section className="panel">
          <div className="panel-head">
            <h3 className="panel-title">Funil de compra</h3>
            <p className="panel-sub">Do que o sistema sugere até o que chegou</p>
          </div>
          <div style={{height:230}}>
            <ResponsiveContainer width="100%" height="100%">
              <FunnelChart>
                <Tooltip
                  formatter={(v,n,p)=>[p?.payload?.real ?? v, 'itens']}
                  contentStyle={{borderRadius:8,border:'1px solid #E6E6E3',fontSize:13}}/>
                <Funnel dataKey="value" data={funil} isAnimationActive
                  animationDuration={700} lastShapeType="rectangle">
                  <LabelList position="right" dataKey="name" fill="#16181A" stroke="none" fontSize={13}/>
                  <LabelList position="left" dataKey="real" fill="#5B6068" stroke="none" fontSize={13}/>
                </Funnel>
              </FunnelChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Chegadas por semana */}
        <section className="panel">
          <div className="panel-head">
            <h3 className="panel-title">Chegadas previstas</h3>
            <p className="panel-sub">Itens da carteira nas próximas 4 semanas</p>
          </div>
          <div style={{height:230}}>
            {temCarteira ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={semanas} margin={{top:8,right:8,left:-18,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F0EE" vertical={false}/>
                  <XAxis dataKey="label" tick={{fontSize:12,fill:'#5B6068'}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fontSize:12,fill:'#5B6068'}} axisLine={false} tickLine={false} allowDecimals={false}/>
                  <Tooltip cursor={{fill:'#FAFAF8'}}
                    formatter={(v,n)=>[v, n==='itens'?'itens':'unidades']}
                    contentStyle={{borderRadius:8,border:'1px solid #E6E6E3',fontSize:13}}/>
                  <Bar dataKey="itens" radius={[6,6,0,0]} isAnimationActive animationDuration={700}>
                    {semanas.map((s,i)=><Cell key={i} fill={i===0?'#F2BE00':'#3A7AF0'}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="panel-empty">Nenhum pedido em carteira.</div>}
          </div>
        </section>
      </div>

      {/* Aging */}
      <section className="panel">
        <div className="panel-head">
          <h3 className="panel-title">Idade da carteira</h3>
          <p className="panel-sub">Há quanto tempo os pedidos estão em aberto</p>
        </div>
        {temCarteira ? (
          <div className="aging">
            {aging.map(f=>(
              <div key={f.label} className="aging-row">
                <span className="aging-label">{f.label}</span>
                <div className="aging-track">
                  <div className={`aging-fill aging-${f.tone}`} style={{width:`${f.pct}%`}}/>
                </div>
                <span className="aging-n">{f.n}</span>
              </div>
            ))}
          </div>
        ) : <div className="panel-empty">Nenhum pedido em carteira.</div>}
      </section>
    </>
  )
}

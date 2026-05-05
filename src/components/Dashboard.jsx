import { useState, useEffect, useMemo } from 'react'
import { DAILY_LIMITS } from '../constants.js'
import { fmtBRL } from '../utils.js'

export function countBizDays(year, month, d1, d2) {
  let n = 0
  for (let d = d1; d <= d2; d++) {
    const dow = new Date(year, month, d).getDay()
    if (dow !== 0 && dow !== 6) n++
  }
  return n
}

export function getLocalMonthInfo() {
  const d = new Date()
  const year  = d.getFullYear()
  const month = d.getMonth()
  const today = d.getDate()
  const lastDay = new Date(year, month+1, 0).getDate()
  const thisMonth = `${year}-${String(month+1).padStart(2,'0')}`
  return { year, month, today, lastDay, thisMonth }
}

export default function Dashboard({ tabSummary, onGoTab, caps, purchaseHistory, orders }) {
  const cards = [
    { tab:'BELTRAO',   label:'Beltrão',        icon:'🟣', color:'#9C8FFF' },
    { tab:'TOLEDO',    label:'Toledo',          icon:'🔵', color:'#4FC3F7' },
    { tab:'OUTROS',    label:'Outros Fornec.',  icon:'📦', color:'#3DDC97' },
    { tab:'MANUAL',    label:'Análise Manual',  icon:'⚠️', color:'#FFA726' },
    { tab:'SEM_PRECO', label:'Sem Preço',       icon:'❗', color:'#FF4D4D' },
  ]

  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t+1), 3600_000)
    return () => clearInterval(id)
  }, [])

  const { year, month, today, lastDay, thisMonth } = useMemo(() => getLocalMonthInfo(), [tick])

  const bizTotal  = countBizDays(year, month, 1, lastDay)
  const bizRemain = bizTotal - countBizDays(year, month, 1, today)

  const monthSpent = useMemo(() => {
    const res = { BELTRAO:0, TOLEDO:0 }
    const seen = new Set()
    const all  = [...(purchaseHistory||[]), ...(orders||[])]
    all.forEach(h => {
      if (seen.has(h.id)) return
      seen.add(h.id)
      if ((h.date||'').slice(0,7) === thisMonth && res[h.cityGroup] !== undefined)
        res[h.cityGroup] += (h.qty||0) * (h.pv||0)
    })
    return res
  }, [purchaseHistory, orders, thisMonth])

  return (
    <div className="dashboard">
      <h2 className="page-title">Dashboard</h2>
      <p className="page-subtitle">Visão geral das sugestões de compra</p>
      <div className="dashboard-grid">
        {cards.map(c => {
          const s = tabSummary[c.tab] ?? { total:0, totalValue:0, selectedValue:0 }
          return (
            <button key={c.tab} className="dash-card" onClick={()=>onGoTab(c.tab)}
              style={{'--card-color':c.color}}>
              <div className="dash-card-icon">{c.icon}</div>
              <div className="dash-card-label">{c.label}</div>
              <div className="dash-card-count">{s.total} itens</div>
              {caps.seePrices && s.totalValue>0 && (
                <div className="dash-card-value">{fmtBRL(s.totalValue)}</div>
              )}
            </button>
          )
        })}
      </div>

      {caps.seePrices && (
        <>
          <div style={{marginTop:24,display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
            {[{key:'BELTRAO',label:'Beltrão',color:'#9C8FFF'},{key:'TOLEDO',label:'Toledo',color:'#4FC3F7'}].map(({key,label,color})=>{
              const dailyLimit   = DAILY_LIMITS[key]
              const monthlyLimit = dailyLimit * bizTotal
              const dailyUsed    = monthSpent[key]
              const monthlyPct   = Math.min(100, monthlyLimit>0 ? Math.round(dailyUsed/monthlyLimit*100) : 0)
              const overMonthly  = dailyUsed > monthlyLimit
              return (
                <div key={key} style={{background:'var(--surface2)',borderRadius:10,padding:'14px 16px',border:'1px solid var(--border)'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                    <span style={{color,fontWeight:700,fontSize:13}}>{label}</span>
                    <span style={{fontSize:10,color:'var(--muted)',background:'var(--card2)',padding:'2px 8px',borderRadius:10}}>
                      {bizRemain} dias úteis restantes
                    </span>
                  </div>
                  <div style={{fontSize:11,color:'var(--muted)',marginBottom:2,textTransform:'uppercase',letterSpacing:.5}}>Limite diário</div>
                  <div style={{fontSize:20,fontWeight:800,color:color,marginBottom:10}}>{fmtBRL(dailyLimit)}</div>
                  <div style={{fontSize:11,color:'var(--muted)',marginBottom:4,textTransform:'uppercase',letterSpacing:.5}}>
                    Limite mensal <span style={{color:'var(--muted2)',textTransform:'none',letterSpacing:0}}>({fmtBRL(dailyLimit)} × {bizTotal} dias)</span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:6}}>
                    <strong style={{color:overMonthly?'var(--danger)':'var(--text)',fontSize:15}}>{fmtBRL(dailyUsed)}</strong>
                    <span style={{color:'var(--muted)',fontSize:12}}>/ {fmtBRL(monthlyLimit)}</span>
                  </div>
                  <div style={{background:'var(--border2)',borderRadius:4,height:7,overflow:'hidden',marginBottom:5}}>
                    <div style={{width:monthlyPct+'%',height:'100%',background:overMonthly?'var(--danger)':color,borderRadius:4,transition:'width .4s'}}/>
                  </div>
                  <div style={{fontSize:11,color:overMonthly?'var(--danger)':'var(--muted)',textAlign:'right'}}>
                    {overMonthly
                      ? <strong style={{color:'var(--danger)'}}>⛔ {fmtBRL(dailyUsed-monthlyLimit)} acima</strong>
                      : <>Disponível: <strong style={{color:'var(--text)'}}>{fmtBRL(monthlyLimit-dailyUsed)}</strong></>}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="dash-summary">
            <div className="dash-summary-row">
              <span>Sugestão Beltrão:</span>
              <strong style={{color:'#9C8FFF'}}>{fmtBRL(tabSummary.BELTRAO?.totalValue??0)}</strong>
            </div>
            <div className="dash-summary-row">
              <span>Sugestão Toledo:</span>
              <strong style={{color:'#4FC3F7'}}>{fmtBRL(tabSummary.TOLEDO?.totalValue??0)}</strong>
            </div>
            <div className="dash-summary-row" style={{borderTop:'1px solid var(--border)',paddingTop:10}}>
              <span>Total Geral:</span>
              <strong style={{color:'var(--accent)'}}>
                {fmtBRL((tabSummary.BELTRAO?.totalValue??0)+(tabSummary.TOLEDO?.totalValue??0)+(tabSummary.OUTROS?.totalValue??0))}
              </strong>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

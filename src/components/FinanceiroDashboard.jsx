import { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'
import { sb } from '../supabase.js'
import { fmtBRL } from '../utils.js'

const CNPJ_CITY = { '35369505000102':'BELTRAO', '35369505000374':'TOLEDO' }
const LOJAS = [
  { key:'BELTRAO', label:'Beltrão', color:'#9C8FFF' },
  { key:'TOLEDO',  label:'Toledo',  color:'#4FC3F7' },
]
const FIN_KEY    = 'sc_financial_months'
const LIMITE_PCT = 0.75

function fmtMesLabel(m) {
  if (!m) return ''
  const [y, mo] = m.split('-')
  return new Date(+y, +mo-1, 1).toLocaleString('pt-BR', { month:'long', year:'numeric' })
}

function fmtMesShort(m) {
  if (!m) return ''
  const [y, mo] = m.split('-')
  return new Date(+y, +mo-1, 1)
    .toLocaleString('pt-BR', { month:'short', year:'2-digit' })
    .replace('. de ','/').replace(' de ','/').replace('.','')
}

function statusColor(pct) {
  if (pct > 100) return 'var(--danger)'
  if (pct > 85)  return 'var(--warning)'
  return 'var(--success)'
}

function MesTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const comprado    = payload.find(p => p.dataKey==='Comprado')?.value ?? 0
  const limite      = payload.find(p => p.dataKey==='Limite')?.value   ?? 0
  const faturamento = payload[0]?.payload?.faturamento ?? 0
  const pct = limite > 0 ? Math.round(comprado / limite * 100) : 0
  return (
    <div style={{background:'var(--card2)',border:'1px solid var(--border)',padding:'10px 14px',fontSize:11,fontFamily:'var(--mono)',borderRadius:6,minWidth:190}}>
      <div style={{fontWeight:700,marginBottom:6,fontSize:12}}>{label}</div>
      {faturamento > 0 && <div style={{color:'var(--muted)'}}>💰 Fat.: <strong style={{color:'var(--success)'}}>{fmtBRL(faturamento)}</strong></div>}
      <div style={{color:'var(--muted)'}}>📊 Limite (75%): <strong>{fmtBRL(limite)}</strong></div>
      <div style={{color:'var(--muted)'}}>🧾 Comprado: <strong style={{color:statusColor(pct)}}>{fmtBRL(comprado)}</strong></div>
      {limite > 0 && <div style={{marginTop:6,borderTop:'1px solid var(--border)',paddingTop:6,color:statusColor(pct),fontWeight:700}}>Uso: {pct}%</div>}
    </div>
  )
}

function HistTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const comprado    = payload.find(p => p.dataKey==='Comprado')?.value    ?? 0
  const limite      = payload.find(p => p.dataKey==='Limite')?.value      ?? 0
  const faturamento = payload.find(p => p.dataKey==='Faturamento')?.value ?? 0
  const pct = limite > 0 ? Math.round(comprado / limite * 100) : 0
  return (
    <div style={{background:'var(--card2)',border:'1px solid var(--border)',padding:'10px 14px',fontSize:11,fontFamily:'var(--mono)',borderRadius:6,minWidth:190}}>
      <div style={{fontWeight:700,marginBottom:6}}>{label}</div>
      {faturamento > 0 && <div>💰 Faturamento: <strong style={{color:'var(--success)'}}>{fmtBRL(faturamento)}</strong></div>}
      <div>📊 Limite (75%): <strong>{fmtBRL(limite)}</strong></div>
      <div>🧾 Comprado: <strong style={{color:statusColor(pct)}}>{fmtBRL(comprado)}</strong></div>
      {limite > 0 && <div style={{marginTop:4,color:statusColor(pct),fontWeight:700}}>Uso: {pct}%</div>}
    </div>
  )
}

export default function FinanceiroDashboard({ caps }) {
  const currentMes = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
  }, [])

  const [mesSel,  setMesSel]  = useState(currentMes)
  const [nfData,  setNfData]  = useState({})
  const [finData, setFinData] = useState({})
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form,    setForm]    = useState({ BELTRAO:'', TOLEDO:'' })
  const [saving,  setSaving]  = useState(false)

  // Carrega NFs dos últimos 13 meses do Supabase
  useEffect(() => {
    const since = new Date()
    since.setMonth(since.getMonth() - 12)
    const sinceStr = `${since.getFullYear()}-${String(since.getMonth()+1).padStart(2,'0')}-01`
    sb.from('notas_fiscais')
      .select('data_emissao,loja_cnpj,valor_total_centavos')
      .gte('data_emissao', sinceStr)
      .then(({ data }) => {
        const agg = {}
        for (const nf of (data||[])) {
          const mes  = (nf.data_emissao||'').slice(0,7)
          const city = CNPJ_CITY[(nf.loja_cnpj||'').replace(/\D/g,'')]
          if (!mes || !city) continue
          if (!agg[mes]) agg[mes] = { BELTRAO:0, TOLEDO:0, count:0 }
          agg[mes][city] += parseInt(nf.valor_total_centavos||0)
          agg[mes].count++
        }
        setNfData(agg)
        setLoading(false)
      })
  }, [])

  // Carrega faturamento armazenado no Supabase app_data
  useEffect(() => {
    sb.from('app_data').select('value').eq('key', FIN_KEY).maybeSingle()
      .then(({ data }) => {
        if (data?.value) try { setFinData(JSON.parse(data.value)) } catch {}
      })
  }, [])

  const openEdit = () => {
    const d = finData[mesSel] || {}
    setForm({
      BELTRAO: d.BELTRAO ? (d.BELTRAO/100).toFixed(2) : '',
      TOLEDO:  d.TOLEDO  ? (d.TOLEDO/100).toFixed(2)  : '',
    })
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    const toC = v => Math.round((parseFloat(String(v).replace(',','.'))||0)*100)
    const updated = {
      ...finData,
      [mesSel]: { BELTRAO: toC(form.BELTRAO), TOLEDO: toC(form.TOLEDO) },
    }
    await sb.from('app_data').upsert({ key:FIN_KEY, value:JSON.stringify(updated) })
    setFinData(updated)
    setEditing(false)
    setSaving(false)
  }

  const mesOptions = useMemo(() => {
    const opts = []
    const d = new Date()
    for (let i = 0; i < 13; i++) {
      opts.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`)
      d.setMonth(d.getMonth()-1)
    }
    return opts
  }, [])

  // Dados do mês selecionado
  const mesNF  = nfData[mesSel]  || { BELTRAO:0, TOLEDO:0, count:0 }
  const mesFin = finData[mesSel] || { BELTRAO:0, TOLEDO:0 }

  const chartData = LOJAS.map(l => {
    const comprado    = mesNF[l.key] / 100
    const faturamento = mesFin[l.key] / 100
    const limite      = faturamento * LIMITE_PCT
    const pct         = limite > 0 ? comprado / limite * 100 : 0
    return { name:l.label, Comprado:comprado, Limite:limite, faturamento, pct, color:l.color }
  })
  const hasData = chartData.some(d => d.Comprado > 0 || d.faturamento > 0)

  // Histórico de meses (todos com dados)
  const allMeses = useMemo(() => {
    const s = new Set([...Object.keys(nfData), ...Object.keys(finData)])
    return [...s].sort().reverse()
  }, [nfData, finData])

  const histChart = useMemo(() =>
    allMeses.slice(0,12).reverse().map(m => {
      const nf  = nfData[m]  || { BELTRAO:0, TOLEDO:0 }
      const fin = finData[m] || { BELTRAO:0, TOLEDO:0 }
      const comprado    = (nf.BELTRAO + nf.TOLEDO) / 100
      const faturamento = (fin.BELTRAO + fin.TOLEDO) / 100
      const limite      = faturamento * LIMITE_PCT
      return { mes:fmtMesShort(m), mesKey:m, Comprado:comprado, Limite:limite, Faturamento:faturamento }
    })
  , [allMeses, nfData, finData])

  const yFmt = v => v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}k` : v
  const yTick = { fill:'var(--muted)', fontSize:10, fontFamily:'var(--mono)' }
  const xTick = { fill:'var(--muted)', fontSize:11, fontFamily:'var(--mono)' }

  return (
    <div style={{marginTop:24}}>

      {/* ── HEADER ── */}
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16,flexWrap:'wrap'}}>
        <span className="section-title" style={{margin:0}}>PAINEL FINANCEIRO</span>
        <select
          value={mesSel} onChange={e => setMesSel(e.target.value)}
          style={{background:'var(--card)',border:'1px solid var(--border2)',padding:'4px 10px',fontFamily:'var(--mono)',fontSize:11,color:'var(--text)',outline:'none',cursor:'pointer',borderRadius:4}}
        >
          {mesOptions.map(m => (
            <option key={m} value={m}>{fmtMesLabel(m)}{m===currentMes?' (atual)':''}</option>
          ))}
        </select>
        {loading && <span style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--mono)'}}>carregando NFs...</span>}
        <div style={{flex:1}}/>
        {caps.canEdit && (
          <button className="btn btn-sm" onClick={openEdit} style={{fontSize:11,padding:'4px 14px'}}>
            ✏️ Inserir faturamento
          </button>
        )}
      </div>

      {/* ── CARDS POR LOJA ── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:18}}>
        {chartData.map(d => {
          const pct     = Math.round(d.pct)
          const barPct  = Math.min(100, d.pct)
          const color   = statusColor(d.pct)
          const over    = d.Comprado > d.limite && d.limite > 0
          return (
            <div key={d.name} style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:10,padding:'14px 16px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <span style={{color:d.color,fontWeight:700,fontSize:13,fontFamily:'var(--mono)'}}>{d.name}</span>
                {d.faturamento > 0 && (
                  <span style={{fontSize:12,fontWeight:700,color}}>{pct}%</span>
                )}
              </div>

              <div style={{fontSize:10,color:'var(--muted)',letterSpacing:.4,marginBottom:2,textTransform:'uppercase'}}>Faturamento do mês</div>
              <div style={{fontSize:19,fontWeight:800,color:'var(--text)',marginBottom:10}}>
                {d.faturamento > 0
                  ? fmtBRL(d.faturamento)
                  : <span style={{color:'var(--muted)',fontSize:12}}>Não informado</span>}
              </div>

              {d.faturamento > 0 && (
                <>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--muted)',marginBottom:3}}>
                    <span>Limite de compras (75%)</span>
                    <strong style={{color:'var(--text)'}}>{fmtBRL(d.limite)}</strong>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--muted)',marginBottom:8}}>
                    <span>Total comprado (NFs)</span>
                    <strong style={{color}}>{loading ? '...' : fmtBRL(d.Comprado)}</strong>
                  </div>
                  <div style={{background:'var(--border2)',borderRadius:4,height:8,overflow:'hidden',marginBottom:6}}>
                    <div style={{width:barPct+'%',height:'100%',background:color,borderRadius:4,transition:'width .5s ease'}}/>
                  </div>
                  <div style={{fontSize:10,fontFamily:'var(--mono)'}}>
                    {over
                      ? <strong style={{color:'var(--danger)'}}>⛔ {fmtBRL(d.Comprado - d.limite)} acima do limite</strong>
                      : <span style={{color:'var(--muted)'}}>Disponível: <strong style={{color:'var(--text)'}}>{fmtBRL(d.limite - d.Comprado)}</strong></span>}
                  </div>
                </>
              )}

              {d.faturamento === 0 && d.Comprado > 0 && (
                <div style={{fontSize:11,color:'var(--muted)',fontFamily:'var(--mono)'}}>
                  🧾 {mesNF.count} NF(s) · <strong style={{color:'var(--accent)'}}>{fmtBRL(d.Comprado)}</strong> comprado
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── GRÁFICO MÊS SELECIONADO ── */}
      {hasData && (
        <div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:10,padding:'14px 16px',marginBottom:18}}>
          <div style={{fontSize:10,color:'var(--muted)',letterSpacing:.5,marginBottom:10,textTransform:'uppercase'}}>
            Comprado vs Limite — {fmtMesLabel(mesSel)}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} barGap={6} barCategoryGap="40%" margin={{top:4,right:8,left:0,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
              <XAxis dataKey="name" tick={xTick} axisLine={false} tickLine={false}/>
              <YAxis tickFormatter={yFmt} tick={yTick} axisLine={false} tickLine={false} width={56}/>
              <Tooltip content={<MesTooltip/>} cursor={{fill:'rgba(255,255,255,.04)'}}/>
              <Bar dataKey="Comprado" name="Comprado" radius={[5,5,0,0]} maxBarSize={90}>
                {chartData.map((d,i) => <Cell key={i} fill={statusColor(d.pct)}/>)}
              </Bar>
              <Bar dataKey="Limite" name="Limite (75%)" fill="rgba(255,255,255,.08)" radius={[5,5,0,0]} maxBarSize={90}/>
            </BarChart>
          </ResponsiveContainer>
          <div style={{display:'flex',gap:16,marginTop:6,justifyContent:'center'}}>
            {[{color:'var(--success)',label:'Comprado'},
              {color:'rgba(255,255,255,.15)',label:'Limite (75% fat.)'}]
              .map(l => (
                <div key={l.label} style={{display:'flex',alignItems:'center',gap:5,fontSize:10,color:'var(--muted)',fontFamily:'var(--mono)'}}>
                  <div style={{width:10,height:10,borderRadius:2,background:l.color}}/>
                  {l.label}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── GRÁFICO HISTÓRICO ── */}
      {histChart.length > 1 && (
        <div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:10,padding:'14px 16px',marginBottom:18}}>
          <div style={{fontSize:10,color:'var(--muted)',letterSpacing:.5,marginBottom:10,textTransform:'uppercase'}}>
            Histórico — últimos {histChart.length} meses
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={histChart} barGap={3} barCategoryGap="28%" margin={{top:4,right:8,left:0,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
              <XAxis dataKey="mes" tick={{...xTick,fontSize:10}} axisLine={false} tickLine={false}/>
              <YAxis tickFormatter={yFmt} tick={yTick} axisLine={false} tickLine={false} width={56}/>
              <Tooltip content={<HistTooltip/>} cursor={{fill:'rgba(255,255,255,.04)'}}/>
              <Bar dataKey="Faturamento" name="Faturamento" fill="rgba(61,220,151,.2)" radius={[4,4,0,0]} maxBarSize={36}/>
              <Bar dataKey="Limite"      name="Limite (75%)" fill="rgba(255,255,255,.09)" radius={[4,4,0,0]} maxBarSize={36}/>
              <Bar dataKey="Comprado"    name="Comprado" radius={[4,4,0,0]} maxBarSize={36}>
                {histChart.map((d,i) => {
                  const pct = d.Limite > 0 ? d.Comprado/d.Limite*100 : 0
                  return <Cell key={i} fill={statusColor(pct)}/>
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{display:'flex',gap:16,marginTop:6,justifyContent:'center',flexWrap:'wrap'}}>
            {[{color:'rgba(61,220,151,.4)',label:'Faturamento'},
              {color:'rgba(255,255,255,.15)',label:'Limite (75%)'},
              {color:'var(--success)',label:'Comprado'}]
              .map(l => (
                <div key={l.label} style={{display:'flex',alignItems:'center',gap:5,fontSize:10,color:'var(--muted)',fontFamily:'var(--mono)'}}>
                  <div style={{width:10,height:10,borderRadius:2,background:l.color}}/>
                  {l.label}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── TABELA HISTÓRICA ── */}
      {allMeses.length > 0 && (
        <div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:10,padding:'14px 16px'}}>
          <div style={{fontSize:10,color:'var(--muted)',letterSpacing:.5,marginBottom:10,textTransform:'uppercase'}}>Resumo por mês</div>
          <div className="table-scroll">
            <table className="product-table" style={{tableLayout:'auto'}}>
              <thead>
                <tr>
                  <th>Mês</th>
                  <th className="num">Fat. Beltrão</th>
                  <th className="num">Fat. Toledo</th>
                  <th className="num">Limite (75%)</th>
                  <th className="num">Comprado (NFs)</th>
                  <th className="num">Uso</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {allMeses.map((m, idx) => {
                  const nf  = nfData[m]  || { BELTRAO:0, TOLEDO:0 }
                  const fin = finData[m] || { BELTRAO:0, TOLEDO:0 }
                  const comprado    = (nf.BELTRAO + nf.TOLEDO) / 100
                  const fatBeltrao  = fin.BELTRAO / 100
                  const fatToledo   = fin.TOLEDO  / 100
                  const faturamento = fatBeltrao + fatToledo
                  const limite      = faturamento * LIMITE_PCT
                  const pct         = limite > 0 ? Math.round(comprado / limite * 100) : null
                  const color       = pct != null ? statusColor(pct) : 'var(--muted)'
                  const isSel       = m === mesSel
                  return (
                    <tr
                      key={m}
                      style={{background:idx%2===0?'var(--card)':'var(--surface)',cursor:'pointer',outline:isSel?'1px solid var(--accent)':''}}
                      onClick={() => setMesSel(m)}
                    >
                      <td style={{fontFamily:'var(--mono)',fontWeight:isSel?700:400,color:isSel?'var(--accent)':'var(--text)',whiteSpace:'nowrap'}}>
                        {fmtMesLabel(m)}
                        {m === currentMes && <span style={{fontSize:9,marginLeft:6,color:'var(--info)',background:'var(--info-bg)',padding:'1px 5px',borderRadius:3}}>ATUAL</span>}
                      </td>
                      <td className="num" style={{fontFamily:'var(--mono)',fontSize:11}}>{fatBeltrao>0?fmtBRL(fatBeltrao):'—'}</td>
                      <td className="num" style={{fontFamily:'var(--mono)',fontSize:11}}>{fatToledo>0?fmtBRL(fatToledo):'—'}</td>
                      <td className="num" style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--muted)'}}>{limite>0?fmtBRL(limite):'—'}</td>
                      <td className="num" style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--accent)',fontWeight:600}}>{comprado>0?fmtBRL(comprado):'—'}</td>
                      <td className="num" style={{fontFamily:'var(--mono)',fontSize:12,fontWeight:700,color}}>{pct!=null?`${pct}%`:'—'}</td>
                      <td>
                        {pct == null
                          ? <span style={{color:'var(--muted)',fontSize:10}}>Sem faturamento</span>
                          : pct > 100
                            ? <span style={{color:'var(--danger)',fontSize:10,fontWeight:700}}>⛔ Excedido</span>
                            : pct > 85
                              ? <span style={{color:'var(--warning)',fontSize:10,fontWeight:600}}>⚠️ Atenção</span>
                              : <span style={{color:'var(--success)',fontSize:10,fontWeight:600}}>✅ Ok</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── MODAL EDITAR FATURAMENTO ── */}
      {editing && (
        <div
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,.65)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}}
          onClick={e => { if (e.target===e.currentTarget) setEditing(false) }}
        >
          <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:26,width:420,maxWidth:'92vw',boxShadow:'0 20px 60px rgba(0,0,0,.6)'}}>
            <h3 style={{margin:'0 0 4px',fontSize:14,fontWeight:700}}>💰 Faturamento — {fmtMesLabel(mesSel)}</h3>
            <p style={{margin:'0 0 20px',fontSize:11,color:'var(--muted)'}}>
              O limite de compras será calculado automaticamente como 75% do faturamento.
            </p>
            {LOJAS.map(l => (
              <div key={l.key} style={{marginBottom:18}}>
                <div style={{color:l.color,fontWeight:700,fontSize:12,marginBottom:6,fontFamily:'var(--mono)',letterSpacing:.4}}>
                  {l.label.toUpperCase()}
                </div>
                <label style={{fontSize:10,color:'var(--muted)',display:'block',marginBottom:4,letterSpacing:.4}}>
                  FATURAMENTO DO MÊS (R$)
                </label>
                <input
                  type="number" step="0.01" min="0"
                  value={form[l.key]}
                  onChange={e => setForm(f => ({...f, [l.key]:e.target.value}))}
                  placeholder="0.00"
                  style={{width:'100%',background:'var(--card)',border:'1px solid var(--border2)',padding:'9px 11px',color:'var(--text)',fontFamily:'var(--mono)',fontSize:15,borderRadius:6,boxSizing:'border-box',outline:'none'}}
                />
                {form[l.key] && !isNaN(parseFloat(form[l.key])) && (
                  <div style={{fontSize:10,color:'var(--muted)',marginTop:4,fontFamily:'var(--mono)'}}>
                    → Limite de compras: <strong style={{color:l.color}}>
                      {fmtBRL(parseFloat(String(form[l.key]).replace(',','.'))*LIMITE_PCT)}
                    </strong>
                  </div>
                )}
              </div>
            ))}
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
              <button className="btn btn-sm btn-ghost" onClick={() => setEditing(false)} disabled={saving}>Cancelar</button>
              <button
                className="btn btn-sm"
                style={{background:'var(--accent)',color:'#fff',border:'none',minWidth:80}}
                onClick={save}
                disabled={saving}
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

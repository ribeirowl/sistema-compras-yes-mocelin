import { useState, useEffect, useMemo, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'
import { DAILY_LIMITS } from '../constants.js'
import { fmtBRL } from '../utils.js'
import { sb } from '../supabase.js'

const CNPJ_CITY = { '35369505000102': 'BELTRAO', '35369505000374': 'TOLEDO' }

function fmtDate(iso) {
  if (!iso) return '—'
  return iso.slice(0,10).split('-').reverse().join('/')
}

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

const SORT_OPTS = [
  { key:'receivedAt-desc', label:'Recebido ↓' },
  { key:'receivedAt-asc',  label:'Recebido ↑' },
  { key:'date-desc',       label:'Comprado ↓' },
  { key:'date-asc',        label:'Comprado ↑' },
  { key:'code-asc',        label:'Código A→Z' },
]

const TRANSIT_SORT_OPTS = [
  { key:'arrivalDate-asc',  label:'Chegada ↑' },
  { key:'arrivalDate-desc', label:'Chegada ↓' },
  { key:'code-asc',         label:'Código A→Z' },
  { key:'cityGroup-asc',    label:'Cidade A→Z' },
]

function TransitPanel({ orders, caps }) {
  const [search,  setSearch]  = useState('')
  const [sortKey, setSortKey] = useState('arrivalDate-asc')
  const now = new Date()

  const transit = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = (orders||[]).filter(o =>
      o.source === 'carteira' && !o.receivedAt &&
      (!o.arrivalDate || new Date(o.arrivalDate) > now)
    )
    if (q) list = list.filter(o =>
      (o.code||'').toLowerCase().includes(q) ||
      (o.description||'').toLowerCase().includes(q) ||
      (o.cityGroup||'').toLowerCase().includes(q)
    )
    const [col, dir] = sortKey.split('-')
    list = [...list].sort((a, b) => {
      const va = a[col] || ''
      const vb = b[col] || ''
      return dir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
    })
    return list
  }, [orders, search, sortKey])

  const total = (orders||[]).filter(o => o.source === 'carteira' && !o.receivedAt && (!o.arrivalDate || new Date(o.arrivalDate) > now)).length

  return (
    <div style={{marginTop:24}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,flexWrap:'wrap'}}>
        <span className="section-title" style={{margin:0}}>PEDIDOS EM TRÂNSITO (CARTEIRA)</span>
        <span style={{fontFamily:'var(--mono)',fontSize:9,color:'var(--info)',background:'var(--info-bg)',border:'1px solid var(--info)',padding:'1px 6px'}}>
          {total}
        </span>
        <div style={{flex:1}}/>
        <input
          type="text"
          placeholder="Buscar código ou descrição..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{background:'var(--card)',border:'1px solid var(--border2)',padding:'4px 9px',fontFamily:'var(--mono)',fontSize:10.5,color:'var(--text)',outline:'none',width:220}}
        />
        <select
          value={sortKey}
          onChange={e => setSortKey(e.target.value)}
          style={{background:'var(--card)',border:'1px solid var(--border2)',padding:'4px 8px',fontFamily:'var(--mono)',fontSize:10.5,color:'var(--text)',outline:'none',cursor:'pointer'}}
        >
          {TRANSIT_SORT_OPTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </div>

      {total === 0
        ? <div style={{background:'var(--card)',border:'1px solid var(--border)',padding:'20px 16px',fontFamily:'var(--mono)',fontSize:11,color:'var(--muted)',textAlign:'center'}}>
            Nenhum pedido em trânsito.<br/>
            <span style={{fontSize:10,color:'var(--muted2)'}}>Importe a Carteira Detalhado na aba Ped. Intelbras para acompanhar pedidos em trânsito.</span>
          </div>
        : transit.length > 0 && (
          <div className="table-scroll">
            <table className="product-table" style={{tableLayout:'auto'}}>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th>Cidade</th>
                  <th className="num">Qtd</th>
                  {caps.seePrices && <th className="num">Total</th>}
                  <th>Pedido</th>
                  <th>Previsão Chegada</th>
                  <th>Tipo</th>
                </tr>
              </thead>
              <tbody>
                {transit.map((o, idx) => (
                  <tr key={o.id} className="product-row" style={{background:idx%2===0?'var(--card)':'var(--card2)'}}>
                    <td className="mono" style={{whiteSpace:'nowrap'}}>{o.code}</td>
                    <td style={{maxWidth:260,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={o.description}>{o.description||'—'}</td>
                    <td style={{whiteSpace:'nowrap'}}>
                      <span className={`empresa-badge ${o.cityGroup==='BELTRAO'?'beltrao':'toledo'}`}>
                        {o.cityGroup==='BELTRAO'?'Beltrão':'Toledo'}
                      </span>
                    </td>
                    <td className="num">{o.qty}</td>
                    {caps.seePrices && <td className="num">{o.pv>0?fmtBRL((o.qty||0)*(o.pv||0)):'—'}</td>}
                    <td style={{whiteSpace:'nowrap',fontFamily:'var(--mono)',fontSize:10,color:'var(--accent)'}}>{o.pedidoParceiro||'—'}</td>
                    <td style={{whiteSpace:'nowrap',fontFamily:'var(--mono)',fontSize:10,color:'var(--info)',fontWeight:700}}>{fmtDate(o.arrivalDate)}</td>
                    <td>
                      {o.isProgrammed
                        ? <span style={{fontSize:10,color:'var(--info)',background:'var(--info-bg)',padding:'1px 6px',borderRadius:3,fontWeight:600}}>Programado</span>
                        : <span style={{fontSize:10,color:'var(--muted)',background:'var(--card2)',padding:'1px 6px',borderRadius:3}}>Normal</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  )
}

function RecebidosPanel({ orders, caps, onUpdateOrders }) {
  const [search,  setSearch]  = useState('')
  const [sortKey, setSortKey] = useState('receivedAt-desc')

  const received = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = (orders||[]).filter(o => o.receivedAt)
    if (q) list = list.filter(o =>
      (o.code||'').toLowerCase().includes(q) ||
      (o.description||'').toLowerCase().includes(q)
    )
    const [col, dir] = sortKey.split('-')
    list = [...list].sort((a, b) => {
      const va = a[col] || ''
      const vb = b[col] || ''
      return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
    })
    return list
  }, [orders, search, sortKey])

  const total = (orders||[]).filter(o => o.receivedAt).length

  const handleUnmark = (id) => {
    if (!onUpdateOrders) return
    onUpdateOrders((orders||[]).map(o => o.id === id ? { ...o, receivedAt: undefined } : o))
  }

  return (
    <div style={{marginTop:24}}>
      {/* cabeçalho + controles */}
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,flexWrap:'wrap'}}>
        <span className="section-title" style={{margin:0}}>ITENS RECEBIDOS</span>
        <span style={{fontFamily:'var(--mono)',fontSize:9,color:'var(--success)',background:'var(--success-bg)',border:'1px solid var(--success)',padding:'1px 6px'}}>
          {total}
        </span>
        <div style={{flex:1}}/>
        <input
          type="text"
          placeholder="Buscar código ou descrição..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            background:'var(--card)',border:'1px solid var(--border2)',
            padding:'4px 9px',fontFamily:'var(--mono)',fontSize:10.5,
            color:'var(--text)',outline:'none',width:220,
          }}
        />
        <select
          value={sortKey}
          onChange={e => setSortKey(e.target.value)}
          style={{
            background:'var(--card)',border:'1px solid var(--border2)',
            padding:'4px 8px',fontFamily:'var(--mono)',fontSize:10.5,
            color:'var(--text)',outline:'none',cursor:'pointer',
          }}
        >
          {SORT_OPTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </div>

      {total === 0
        ? <div style={{background:'var(--card)',border:'1px solid var(--border)',padding:'20px 16px',fontFamily:'var(--mono)',fontSize:11,color:'var(--muted)',textAlign:'center'}}>
            Nenhum item marcado como recebido ainda.<br/>
            <span style={{fontSize:10,color:'var(--muted2)'}}>O sistema detecta automaticamente ao carregar uma nova planilha de estoque.</span>
          </div>
        : <>
            {received.length === 0 && search &&
              <div style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--muted)',padding:'12px 0'}}>
                Nenhum resultado para <strong style={{color:'var(--text)'}}>{search}</strong>
              </div>
            }
            {received.length > 0 && (
              <div className="table-scroll">
                <table className="product-table" style={{tableLayout:'auto'}}>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Descrição</th>
                      <th>Cidade</th>
                      <th className="num">Qtd</th>
                      {caps.seePrices && <th className="num">Total</th>}
                      <th>Comprado</th>
                      <th>Recebido</th>
                      <th style={{width:90}}>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {received.map((o, idx) => (
                      <tr key={o.id} className="product-row" style={{background:idx%2===0?'var(--card)':'var(--card2)'}}>
                        <td className="mono" style={{whiteSpace:'nowrap'}}>{o.code}</td>
                        <td style={{maxWidth:280,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={o.description}>{o.description||'—'}</td>
                        <td style={{whiteSpace:'nowrap'}}>{o.cityGroup||'—'}</td>
                        <td className="num">{o.qty}</td>
                        {caps.seePrices && <td className="num">{o.pv>0?fmtBRL((o.qty||0)*(o.pv||0)):'—'}</td>}
                        <td style={{whiteSpace:'nowrap',fontFamily:'var(--mono)',fontSize:10}}>{fmtDate(o.date)}</td>
                        <td style={{whiteSpace:'nowrap',fontFamily:'var(--mono)',fontSize:10,color:'var(--success)'}}>{fmtDate(o.receivedAt)}</td>
                        <td>
                          <button className="btn btn-sm btn-ghost" style={{color:'var(--warning)',borderColor:'var(--warning)'}}
                            title="Desmarcar como recebido — o pedido volta a contar nas sugestões"
                            onClick={() => handleUnmark(o.id)}>
                            Desmarcar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
      }
    </div>
  )
}

const FIN_KEY = 'sc_financial_manual'
const LOJAS_FIN = [
  { key:'BELTRAO', label:'Beltrão', color:'#9C8FFF' },
  { key:'TOLEDO',  label:'Toledo',  color:'#4FC3F7' },
]

function parseMoney(v) {
  const n = parseFloat(String(v).replace(/[^0-9,.]/g,'').replace(',','.'))
  return isNaN(n) ? 0 : n
}

function FinTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const comprado = payload.find(p => p.dataKey === 'Comprado')?.value ?? 0
  const limite   = payload.find(p => p.dataKey === 'Limite')?.value ?? 0
  const pct = limite > 0 ? Math.round(comprado / limite * 100) : 0
  return (
    <div style={{background:'var(--card2)',border:'1px solid var(--border)',padding:'8px 12px',fontSize:11,fontFamily:'var(--mono)',borderRadius:6}}>
      <div style={{fontWeight:700,marginBottom:6,color:'var(--text)'}}>{label}</div>
      <div style={{color:'var(--accent)'}}>Comprado: {fmtBRL(comprado)}</div>
      <div style={{color:'var(--muted)'}}>Limite: {fmtBRL(limite)}</div>
      {limite > 0 && <div style={{marginTop:4,borderTop:'1px solid var(--border)',paddingTop:4,color:pct>100?'var(--danger)':pct>85?'var(--warning)':'var(--success)',fontWeight:600}}>
        Uso: {pct}%
      </div>}
    </div>
  )
}

function FinancialPanel({ caps }) {
  const load = () => { try { return JSON.parse(localStorage.getItem(FIN_KEY)) || {} } catch { return {} } }

  const [data,    setData]    = useState(load)
  const [editing, setEditing] = useState(false)
  const [form,    setForm]    = useState({ BELTRAO:{comprado:'',limite:''}, TOLEDO:{comprado:'',limite:''} })

  const openEdit = () => {
    setForm({
      BELTRAO: { comprado: data.BELTRAO?.comprado ?? '', limite: data.BELTRAO?.limite ?? '' },
      TOLEDO:  { comprado: data.TOLEDO?.comprado  ?? '', limite: data.TOLEDO?.limite  ?? '' },
    })
    setEditing(true)
  }

  const save = () => {
    const parsed = {
      BELTRAO: { comprado: parseMoney(form.BELTRAO.comprado), limite: parseMoney(form.BELTRAO.limite) },
      TOLEDO:  { comprado: parseMoney(form.TOLEDO.comprado),  limite: parseMoney(form.TOLEDO.limite)  },
      updatedAt: new Date().toISOString(),
    }
    localStorage.setItem(FIN_KEY, JSON.stringify(parsed))
    setData(parsed)
    setEditing(false)
  }

  const chartData = LOJAS_FIN.map(l => {
    const comprado = data[l.key]?.comprado ?? 0
    const limite   = data[l.key]?.limite   ?? 0
    const pct = limite > 0 ? comprado / limite * 100 : 0
    return { name: l.label, Comprado: comprado, Limite: limite, pct, color: l.color }
  })

  const hasData = chartData.some(d => d.Limite > 0 || d.Comprado > 0)
  const updatedAt = data.updatedAt ? new Date(data.updatedAt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : null

  return (
    <div style={{marginTop:24,background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:10,padding:'16px 18px'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:hasData?16:0}}>
        <span className="section-title" style={{margin:0}}>META FINANCEIRA DO MÊS</span>
        {updatedAt && <span style={{fontSize:9,color:'var(--muted2)',fontFamily:'var(--mono)',marginLeft:4}}>atualizado {updatedAt}</span>}
        <div style={{flex:1}}/>
        {caps.canEdit && (
          <button className="btn btn-sm" onClick={openEdit} style={{fontSize:11,padding:'3px 12px'}}>
            ✏️ Editar dados
          </button>
        )}
      </div>

      {!hasData ? (
        <div style={{textAlign:'center',color:'var(--muted)',fontFamily:'var(--mono)',fontSize:11,padding:'24px 0'}}>
          {caps.canEdit
            ? 'Clique em "Editar dados" para inserir o total comprado e o limite de cada loja.'
            : 'Nenhum dado financeiro inserido para este mês.'}
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={chartData} barGap={6} barCategoryGap="35%" margin={{top:8,right:8,left:0,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
              <XAxis dataKey="name" tick={{fill:'var(--muted)',fontSize:12,fontFamily:'var(--mono)'}} axisLine={false} tickLine={false}/>
              <YAxis
                tickFormatter={v => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}
                tick={{fill:'var(--muted)',fontSize:10,fontFamily:'var(--mono)'}}
                axisLine={false} tickLine={false} width={52}
              />
              <Tooltip content={<FinTooltip/>} cursor={{fill:'rgba(255,255,255,.04)'}}/>
              <Bar dataKey="Comprado" name="Comprado" radius={[5,5,0,0]} maxBarSize={72}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.pct > 100 ? 'var(--danger)' : d.pct > 85 ? 'var(--warning)' : d.color}/>
                ))}
              </Bar>
              <Bar dataKey="Limite" name="Limite" fill="var(--border2)" radius={[5,5,0,0]} maxBarSize={72}/>
            </BarChart>
          </ResponsiveContainer>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginTop:12}}>
            {chartData.map(d => {
              const pct     = Math.min(d.pct, 100)
              const over    = d.pct > 100
              const barColor = d.pct > 100 ? 'var(--danger)' : d.pct > 85 ? 'var(--warning)' : d.color
              return (
                <div key={d.name} style={{background:'var(--card)',borderRadius:8,padding:'10px 12px',border:'1px solid var(--border)'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:6}}>
                    <span style={{color:d.color,fontWeight:700,fontSize:12,fontFamily:'var(--mono)'}}>{d.name}</span>
                    <span style={{fontSize:12,fontWeight:700,color:over?'var(--danger)':d.pct>85?'var(--warning)':'var(--success)'}}>
                      {Math.round(d.pct)}%
                    </span>
                  </div>
                  <div style={{background:'var(--border2)',borderRadius:4,height:8,overflow:'hidden',marginBottom:6}}>
                    <div style={{width:pct+'%',height:'100%',background:barColor,borderRadius:4,transition:'width .5s ease'}}/>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:11,fontFamily:'var(--mono)'}}>
                    <span style={{color:'var(--text)',fontWeight:700}}>{fmtBRL(d.Comprado)}</span>
                    <span style={{color:'var(--muted)'}}>limite {fmtBRL(d.Limite)}</span>
                  </div>
                  <div style={{fontSize:10,marginTop:4,fontFamily:'var(--mono)'}}>
                    {over
                      ? <span style={{color:'var(--danger)',fontWeight:700}}>⛔ {fmtBRL(d.Comprado - d.Limite)} acima do limite</span>
                      : d.Limite > 0
                        ? <span style={{color:'var(--muted)'}}>Disponível: <strong style={{color:'var(--text)'}}>{fmtBRL(d.Limite - d.Comprado)}</strong></span>
                        : null
                    }
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {editing && (
        <div
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}}
          onClick={e => { if (e.target === e.currentTarget) setEditing(false) }}
        >
          <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:24,width:440,maxWidth:'92vw',boxShadow:'0 16px 48px rgba(0,0,0,.5)'}}>
            <h3 style={{margin:'0 0 18px',fontSize:14,color:'var(--text)',fontWeight:700}}>💰 Meta Financeira do Mês</h3>
            {LOJAS_FIN.map(l => (
              <div key={l.key} style={{marginBottom:18}}>
                <div style={{color:l.color,fontWeight:700,fontSize:12,marginBottom:8,fontFamily:'var(--mono)'}}>{l.label.toUpperCase()}</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  {[['comprado','TOTAL COMPRADO (R$)'],['limite','LIMITE (R$)']].map(([field, lbl]) => (
                    <div key={field}>
                      <label style={{fontSize:10,color:'var(--muted)',display:'block',marginBottom:3,letterSpacing:.4}}>{lbl}</label>
                      <input
                        type="number" step="0.01" min="0"
                        value={form[l.key][field]}
                        onChange={e => setForm(f => ({...f, [l.key]:{...f[l.key], [field]:e.target.value}}))}
                        style={{width:'100%',background:'var(--card)',border:'1px solid var(--border2)',padding:'7px 9px',color:'var(--text)',fontFamily:'var(--mono)',fontSize:13,borderRadius:5,boxSizing:'border-box',outline:'none'}}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:4}}>
              <button className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>Cancelar</button>
              <button className="btn btn-sm" style={{background:'var(--accent)',color:'#fff',border:'none'}} onClick={save}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Dashboard({ tabSummary, onGoTab, caps, purchaseHistory, orders, onUpdateOrders }) {
  const cards = [
    { tab:'BELTRAO',   label:'Beltrão',        icon:'🟣', color:'#9C8FFF' },
    { tab:'TOLEDO',    label:'Toledo',          icon:'🔵', color:'#4FC3F7' },
    { tab:'OUTROS',    label:'Outros Fornec.',  icon:'📦', color:'#3DDC97' },
    { tab:'MANUAL',    label:'Análise Manual',  icon:'⚠️', color:'#FFA726' },
    { tab:'SEM_PRECO', label:'Sem Preço',       icon:'❗', color:'#FF4D4D' },
  ]

  const [tick,      setTick]      = useState(0)
  const [sbPedidos, setSbPedidos] = useState([])

  useEffect(() => {
    const id = setInterval(() => setTick(t => t+1), 3600_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    sb.from('pedidos')
      .select('id,numero,loja_cnpj,status,data_pedido,previsao_entrega,pedido_itens(quantidade,valor_unit_centavos)')
      .in('status', ['faturado','parcial'])
      .then(({ data }) => setSbPedidos(data || []))
  }, [])

  const { year, month, today, lastDay, thisMonth } = useMemo(() => getLocalMonthInfo(), [tick])

  const bizTotal  = countBizDays(year, month, 1, lastDay)
  const bizRemain = bizTotal - countBizDays(year, month, 1, today)

  const monthSpent = useMemo(() => {
    const res = { BELTRAO:0, TOLEDO:0 }
    // IDs de pedidos já faturados no Supabase — evita dupla contagem com carteira local
    const faturadoNums = new Set(sbPedidos.map(p => `${p.numero}__${p.loja_cnpj}`))
    const cnpjOf = city => city === 'BELTRAO' ? '35369505000102' : '35369505000374'

    // 1. Solicitações aprovadas (fromRequest) — mesma fonte que o Financeiro
    ;(purchaseHistory||[]).filter(h => h.fromRequest).forEach(h => {
      const month = (h.arrivalDate || h.date || '').slice(0,7)
      if (month === thisMonth && res[h.cityGroup] !== undefined)
        res[h.cityGroup] += (h.qty||0) * (h.pv||0)
    })

    // 2. Carteira ainda não faturada
    ;(orders||[]).filter(o =>
      o.source === 'carteira' &&
      !faturadoNums.has(`${o.pedidoParceiro}__${cnpjOf(o.cityGroup)}`)
    ).forEach(o => {
      const month = (o.arrivalDate || o.date || '').slice(0,7)
      if (month === thisMonth && res[o.cityGroup] !== undefined)
        res[o.cityGroup] += (o.qty||0) * (o.pv||0)
    })

    // 3. Pedidos faturados/parciais do Supabase
    sbPedidos.forEach(p => {
      const city = CNPJ_CITY[p.loja_cnpj]
      if (!city) return
      const month = (p.previsao_entrega || p.data_pedido || '').slice(0,7)
      if (month !== thisMonth) return
      const total = (p.pedido_itens||[]).reduce((s,i) => s + (i.quantidade||0) * ((i.valor_unit_centavos||0)/100), 0)
      res[city] += total
    })

    return res
  }, [purchaseHistory, orders, sbPedidos, thisMonth])

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
      {/* ── META FINANCEIRA ── */}
      {caps.seeFinancial && <FinancialPanel caps={caps}/>}

      {/* ── PEDIDOS EM TRÂNSITO ── */}
      <TransitPanel orders={orders} caps={caps}/>

      {/* ── ITENS RECEBIDOS ── */}
      {caps.canEdit && (
        <RecebidosPanel orders={orders} caps={caps} onUpdateOrders={onUpdateOrders}/>
      )}
    </div>
  )
}

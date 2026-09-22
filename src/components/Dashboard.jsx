import { useState, useEffect, useMemo, useCallback } from 'react'
import { fmtBRL } from '../utils.js'
import { sb } from '../supabase.js'
import FinanceiroDashboard from './FinanceiroDashboard.jsx'
import { TabIcon } from '../icons.jsx'
import DashboardGestor from './DashboardGestor.jsx'
import DashboardVendedor from './DashboardVendedor.jsx'

const CNPJ_CITY = { '35369505000102': 'BELTRAO', '35369505000374': 'TOLEDO' }

function fmtDate(iso) {
  if (!iso) return '—'
  return iso.slice(0,10).split('-').reverse().join('/')
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
        <span style={{fontFamily:'var(--mono)',fontSize:10,color:'var(--info)',background:'var(--info-bg)',border:'1px solid var(--info)',padding:'1px 6px'}}>
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
                    <td title={o.description}><div className="col-desc-inner">{o.description||'—'}</div></td>
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


export default function Dashboard({ tabSummary, onGoTab, caps, purchaseHistory, orders,
  tabItems, rawItems, availMap, priceMap, purchaseRequests, transferRequests, role, userName }) {

  // Vendedor tem uma visao propria: sem valores, focada no que ele precisa para vender
  if (role === 'SELLER') {
    return (
      <div className="dashboard">
        <div className="page-head">
          <h2 className="page-title">Visão geral</h2>
          <p className="page-subtitle">O que está disponível, o que está chegando e suas solicitações</p>
        </div>
        <DashboardVendedor rawItems={rawItems} availMap={availMap} orders={orders}
          purchaseRequests={purchaseRequests} transferRequests={transferRequests}
          userName={userName} onGoTab={onGoTab}/>
      </div>
    )
  }

  const cards = [
    { tab:'BELTRAO',   label:'Beltrão + DV',   color:'var(--purple)' },
    { tab:'TOLEDO',    label:'Toledo',          color:'var(--info)' },
    { tab:'OUTROS',    label:'Outros Fornec.',  color:'var(--ok)' },
    { tab:'MANUAL',    label:'Análise Manual',  color:'var(--warn)' },
    { tab:'SEM_PRECO', label:'Sem Preço',       color:'var(--danger)' },
  ]
  const vBel = tabSummary.BELTRAO?.totalValue??0
  const vTol = tabSummary.TOLEDO?.totalValue??0
  const vOut = tabSummary.OUTROS?.totalValue??0

  return (
    <div className="dashboard">
      <div className="page-head">
        <h2 className="page-title">Visão geral</h2>
        <p className="page-subtitle">Limite de compra do mês, prioridades e situação da carteira</p>
      </div>

      {/* 1º: limite de compra conforme faturamento */}
      {caps.seeFinancial && <FinanceiroDashboard caps={caps}/>}

      {/* 2º: prioridades do dia */}
      <DashboardGestor tabSummary={tabSummary} tabItems={tabItems} orders={orders}
        purchaseRequests={purchaseRequests} onGoTab={onGoTab} caps={caps}/>
      <div className="dashboard-grid">
        {cards.map(c => {
          const s = tabSummary[c.tab] ?? { total:0, totalValue:0, selectedValue:0 }
          return (
            <button key={c.tab} className="dash-card" onClick={()=>onGoTab(c.tab)}
              style={{'--card-color':c.color}}>
              <div className="dash-card-icon"><TabIcon id={c.tab} size={20}/></div>
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
          <div className="dash-summary">
            <div className="dash-summary-item">
              <span className="dash-summary-label">Sugestão Beltrão + DV</span>
              <strong className="dash-summary-value" style={{color:'var(--purple)'}}>{fmtBRL(vBel)}</strong>
            </div>
            <div className="dash-summary-item">
              <span className="dash-summary-label">Sugestão Toledo</span>
              <strong className="dash-summary-value" style={{color:'var(--info-ink)'}}>{fmtBRL(vTol)}</strong>
            </div>
            <div className="dash-summary-item">
              <span className="dash-summary-label">Outros fornecedores</span>
              <strong className="dash-summary-value" style={{color:'var(--ok-ink)'}}>{fmtBRL(vOut)}</strong>
            </div>
            <div className="dash-summary-item total">
              <span className="dash-summary-label">Total geral</span>
              <strong className="dash-summary-value">{fmtBRL(vBel+vTol+vOut)}</strong>
            </div>
          </div>
        </>
      )}
      {/* ── PEDIDOS EM TRÂNSITO ── */}
      <TransitPanel orders={orders} caps={caps}/>
    </div>
  )
}

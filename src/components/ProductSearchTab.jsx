import { useState, useCallback, useEffect } from 'react'
import { STATUS_CFG } from '../constants.js'
import { normStr, fmtBRL, fmtDate, bizDaysBetween, parseLocalDate } from '../utils.js'
import { getRequests, saveRequests } from '../supabase.js'
import { getProductStatus, getArrivalDate } from '../rules.js'
import DataTable from './DataTable.jsx'
import { STORES } from './TransferenciasTab.jsx'

export default function ProductSearchTab({ rawItems, priceMap, discontinuedMap, purchaseHistory, purchaseRequests, productOverrides, availMap, role, caps, orders, onNewTransfer }) {
  const [search,    setSearch]    = useState('')
  const [cityGroup, setCityGroup] = useState('BELTRAO')
  const [results,   setResults]   = useState([])
  const [showReq,   setShowReq]   = useState(null)

  const doSearch = useCallback(() => {
    if (!search.trim()) { setResults([]); return }
    const q = normStr(search)
    const codes = new Set()
    rawItems.forEach(i => {
      if (normStr(i.code).includes(q)||normStr(i.description).includes(q)) codes.add(i.code)
    })
    priceMap.forEach((_,k) => { if(normStr(k).includes(q)) codes.add(k) })
    discontinuedMap.forEach((_,k) => { if(normStr(k).includes(q)) codes.add(k) })

    const res = [...codes].map(code => {
      const rawI  = rawItems.find(i=>i.code===code) ?? {}
      const price = priceMap.get(code) ?? {}
      const disc  = discontinuedMap.get(code)
      const status = getProductStatus(code, cityGroup, rawItems, purchaseHistory, purchaseRequests, discontinuedMap, productOverrides, availMap, priceMap, orders)
      const arrival = getArrivalDate(price.ufOrigem||'', price.brand||rawI.brand||'')
      return {
        code,
        description: rawI.description || disc?.description || code,
        brand:       price.brand || rawI.brand || '',
        pv:          price.pv || 0,
        ufOrigem:    price.ufOrigem || '',
        status,
        arrival,
      }
    })
    setResults(res)
  }, [search, cityGroup, rawItems, purchaseHistory, purchaseRequests, discontinuedMap, priceMap, orders])

  const histOf = code => purchaseHistory
    .filter(h => h.code===code && h.cityGroup===cityGroup)
    .sort((a,b) => new Date(b.date) - new Date(a.date))

  const columns = [
    { id:'code', label:'Código', alwaysVisible:true, defaultWidth:92,
      render:r=><span className="mono">{r.code}</span> },
    { id:'description', label:'Descrição', defaultWidth:240,
      render:r=><span title={r.description}>{r.description}</span> },
    { id:'brand', label:'Marca', defaultWidth:110,
      render:r=><span className="brand-badge">{r.brand||'—'}</span> },
    ...(caps.seePrices ? [{ id:'pv', label:'PV', align:'right', defaultWidth:90,
      render:r=> r.pv>0?fmtBRL(r.pv):'—' }] : []),
    { id:'status', label:'Status', defaultWidth:210, wrap:true,
      render:r=>{
        const cfg = STATUS_CFG[r.status.type] ?? STATUS_CFG.SEM_ESTOQUE
        const hist = histOf(r.code)
        return (
          <>
            <span className="status-badge" style={{background:cfg.bg,color:cfg.txt}}>{cfg.label}</span>
            {r.status.type==='ENCERRADO_COM_SUB'&&r.status.substitute&&(
              <div className="sub-info">→ Substituto: <strong>{r.status.substitute}</strong></div>
            )}
            {r.status.type==='DISPONIVEL_IMEDIATO'&&r.status.qtdImediato!=null&&(
              <div className="sub-info">Estoque: {r.status.qtdImediato}</div>
            )}
            {hist.length>0&&(
              <div className="sub-info" style={{color:'var(--accent)'}}>▾ {hist.length} compra{hist.length>1?'s':''}</div>
            )}
          </>
        )
      } },
    { id:'previsao', label:'Previsão', defaultWidth:140,
      render:r=>{
        const t = r.status.type, now = new Date()
        if (['ENCERRADO','ENCERRADO_COM_SUB','CONSULTAR_COMPRAS'].includes(t))
          return <span style={{color:'var(--muted)'}}>—</span>
        const arrTypes = ['COMPRADO_COM_PREV','COMPRADO_FATURADO','COMPRADO_CARTEIRA']
        if (arrTypes.includes(t) && r.status.arrivalDate) {
          const arrD = parseLocalDate(r.status.arrivalDate)
          const d = bizDaysBetween(now, arrD)
          const c = d<7?'var(--success)':d<=15?'var(--warning)':'var(--danger)'
          return <span style={{color:c}}>{fmtDate(arrD)}</span>
        }
        if (['COMPRADO_COM_PREV','COMPRADO_FATURADO'].includes(t))
          return <span style={{color:'var(--muted)'}}>Em trânsito</span>
        if (t==='DISPONIVEL_IMEDIATO'||t==='AGUARDANDO_COMPRA')
          return <span style={{color:'var(--info)'}}>Mín. {fmtDate(getArrivalDate(r.ufOrigem||''))}</span>
        if (t==='DISPONIVEL_MES') { const dd=new Date(); dd.setDate(dd.getDate()+30); return <span style={{color:'var(--warning)'}}>Mín. {fmtDate(dd)}</span> }
        // Sem previsão própria, mas o produto tem disponibilidade na Intelbras → mostra a estimativa mínima
        if (r.status.minArrival)
          return <span style={{color:'var(--info)'}} title="Estimativa pela disponibilidade Intelbras — não é data confirmada">Mín. {fmtDate(r.status.minArrival)}</span>
        return <span style={{color:'var(--muted)'}}>Sem previsão</span>
      } },
    ...(['SELLER','GERENCIA'].includes(role) ? [{ id:'acao', label:'Ação', defaultWidth:100,
      render:r=> !['ENCERRADO','ENCERRADO_COM_SUB'].includes(r.status.type) && (
        <button className="btn btn-yellow btn-sm" onClick={e=>{e.stopPropagation();setShowReq(r)}}>Solicitar</button>
      ) }] : []),
  ]

  return (
    <div className="search-tab">
      <h2 className="page-title">Pesquisa de Produtos</h2>
      <p className="page-subtitle">Consulte disponibilidade e status em tempo real</p>
      <div className="search-controls">
        <input className="search-input" type="text" placeholder="Código ou descrição..."
          value={search} onChange={e=>setSearch(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&doSearch()}/>
        <select className="filter-select" value={cityGroup} onChange={e=>setCityGroup(e.target.value)}>
          <option value="BELTRAO">Beltrão</option>
          <option value="TOLEDO">Toledo</option>
          <option value="DOIS_VIZINHOS">Dois Vizinhos</option>
        </select>
        <button className="btn btn-yellow" onClick={doSearch}>🔍 Buscar</button>
      </div>

      {results.length>0 && (
        <div className="search-results" style={{marginTop:12}}>
          <DataTable
            tableId="pesquisa_produtos"
            rows={results}
            rowKey={r=>r.code}
            columns={columns}
            expandedContent={r=>{
              const hist = histOf(r.code)
              if (!hist.length) return null
              return (
                <div style={{padding:'8px 12px'}}>
                  <div style={{fontSize:11,fontWeight:600,color:'var(--muted)',textTransform:'uppercase',letterSpacing:.5,marginBottom:6}}>Histórico de compras — {cityGroup}</div>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead>
                      <tr style={{color:'var(--muted)',fontWeight:600}}>
                        <th style={{textAlign:'left',padding:'2px 8px'}}>Data</th>
                        <th style={{textAlign:'center',padding:'2px 8px'}}>Qtd</th>
                        {caps.seePrices&&<th style={{textAlign:'right',padding:'2px 8px'}}>PV</th>}
                        {caps.seePrices&&<th style={{textAlign:'right',padding:'2px 8px'}}>Total</th>}
                        <th style={{textAlign:'left',padding:'2px 8px'}}>Registrado por</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hist.map(h=>(
                        <tr key={h.id} style={{borderTop:'1px solid var(--border)'}}>
                          <td style={{padding:'4px 8px'}}>{fmtDate(h.date)}</td>
                          <td style={{padding:'4px 8px',textAlign:'center',fontWeight:600}}>{h.qty}</td>
                          {caps.seePrices&&<td style={{padding:'4px 8px',textAlign:'right'}}>{h.pv>0?fmtBRL(h.pv):'—'}</td>}
                          {caps.seePrices&&<td style={{padding:'4px 8px',textAlign:'right',fontWeight:600}}>{h.pv>0&&h.qty>0?fmtBRL(h.qty*h.pv):'—'}</td>}
                          <td style={{padding:'4px 8px',color:'var(--muted)'}}>{h.enteredBy||'—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }}
          />
        </div>
      )}

      {results.length===0&&search&&(
        <div className="table-empty"><div className="table-empty-icon">🔍</div><p>Nenhum produto encontrado para "{search}"</p></div>
      )}

      {showReq&&(
        <RequestModal item={showReq} cityGroup={cityGroup}
          purchaseHistory={purchaseHistory} purchaseRequests={purchaseRequests}
          onClose={()=>setShowReq(null)}
          onSubmit={req=>{
            const reqs=[...getRequests(),req]
            saveRequests(reqs)
            setShowReq(null)
          }}
          onSubmitTransfer={tr=>{ onNewTransfer?.(tr); setShowReq(null) }}/>
      )}
    </div>
  )
}

export function RequestModal({ item, cityGroup: cityGroupProp, purchaseHistory, purchaseRequests, onClose, onSubmit, onSubmitTransfer }) {
  const [mode,       setMode]       = useState('COMPRA')   // COMPRA | TRANSFERENCIA
  const [qty,        setQty]        = useState(1)
  const [obs,        setObs]        = useState('')
  const [tipo,       setTipo]       = useState('ESTOQUE')
  const [city,       setCity]       = useState(cityGroupProp||'BELTRAO')
  const [fromStore,  setFromStore]  = useState('')
  const [sellerName, setSellerName] = useState(()=>sessionStorage.getItem('sc_name')||'')
  const [errors,     setErrors]     = useState({})
  const [warn,       setWarn]       = useState(null)
  const [blocked,    setBlocked]    = useState(false)

  useEffect(()=>{
    const now = new Date()
    const isDisc = item.status.type==='ENCERRADO'||item.status.type==='ENCERRADO_COM_SUB'
    if (isDisc) {
      setBlocked(true)
      setWarn(`Produto descontinuado / fora de linha.${item.status.substitute?` Substituto: ${item.status.substitute}`:''}`)
      return
    }
    const recent = purchaseHistory.find(h =>
      h.code===item.code && h.cityGroup===city &&
      (now-new Date(h.date))/86400000 <= 8)
    if (recent) {
      const days = Math.floor((now-new Date(recent.date))/86400000)
      setWarn(`Este produto foi comprado há ${days} dias (${fmtDate(recent.date)}). Confirme se realmente deseja solicitar novamente.`)
    } else { setWarn(null) }
  },[item,city,purchaseHistory])

  const submit = () => {
    const errs = {}
    if (!sellerName.trim()) errs.sellerName = 'Informe seu nome'

    if (mode === 'TRANSFERENCIA') {
      if (!fromStore) errs.fromStore = 'Selecione a loja de origem'
      if (Object.keys(errs).length) { setErrors(errs); return }
      onSubmitTransfer?.({
        id:          Date.now().toString()+Math.random().toString(36).slice(2),
        code:        item.code,
        description: item.description,
        brand:       item.brand,
        cityGroup:   city,          // destino (loja que recebe)
        fromStore,                  // origem sugerida pelo vendedor
        observation: obs.trim(),    // opcional
        status:      'PENDENTE',
        createdAt:   new Date().toISOString(),
        createdBy:   sellerName.trim(),
        transferQty: null,
        transferDate: null,
      })
      return
    }

    if (!obs.trim()) errs.obs = 'Observação é obrigatória'
    if (Object.keys(errs).length) { setErrors(errs); return }
    onSubmit({
      id:          Date.now().toString(),
      code:        item.code,
      description: item.description,
      brand:       item.brand,
      cityGroup:   city,
      qty,
      tipo,
      observation: obs,
      status:      'PENDENTE',
      createdAt:   new Date().toISOString(),
      createdBy:   sellerName.trim(),
    })
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{mode==='TRANSFERENCIA'?'Solicitar Transferência':'Solicitar Compra'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="request-product-info">
            <span className="mono" style={{color:'var(--accent)',fontWeight:700}}>{item.code}</span>
            <span>{item.description}</span>
            <span><span className="brand-badge">{item.brand||'—'}</span></span>
          </div>
          {warn&&<div className={`alert ${blocked?'alert-error':'alert-warning'}`}>⚠️ {warn}</div>}
          {!blocked&&(
            <>
              {/* Seletor: Compra ou Transferência */}
              <div className="form-field">
                <label>O que você precisa?</label>
                <div style={{display:'flex',gap:8}}>
                  {[['COMPRA','🛒 Compra'],['TRANSFERENCIA','🔄 Transferência']].map(([v,lbl])=>(
                    <button key={v} type="button" className="btn btn-sm"
                      style={{flex:1,background:mode===v?'var(--accent)':'var(--card2)',color:mode===v?'#000':'var(--muted)',border:`1px solid ${mode===v?'var(--accent)':'var(--border)'}`}}
                      onClick={()=>{setMode(v);setErrors({})}}>{lbl}</button>
                  ))}
                </div>
              </div>

              <div className="form-field">
                <label>Seu nome <span style={{color:'var(--danger)'}}>*</span></label>
                <input className={`login-input${errors.sellerName?' input-error':''}`} value={sellerName}
                  onChange={e=>{setSellerName(e.target.value);setErrors(p=>({...p,sellerName:''}))}}
                  placeholder="Nome do vendedor"/>
                {errors.sellerName&&<span className="field-error">{errors.sellerName}</span>}
              </div>

              {mode==='COMPRA' ? (
                <>
                  <div className="form-field">
                    <label>Cidade</label>
                    <select className="filter-select" style={{width:'100%'}} value={city} onChange={e=>setCity(e.target.value)}>
                      <option value="BELTRAO">Beltrão</option>
                      <option value="TOLEDO">Toledo</option>
                      <option value="DOIS_VIZINHOS">Dois Vizinhos</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label>Quantidade</label>
                    <input type="number" className="login-input" min="1" value={qty}
                      onChange={e=>setQty(parseInt(e.target.value)||1)}/>
                  </div>
                  <div className="form-field">
                    <label>Tipo de solicitação</label>
                    <select className="filter-select" style={{width:'100%'}} value={tipo} onChange={e=>setTipo(e.target.value)}>
                      <option value="ESTOQUE">Estoque</option>
                      <option value="VENDA_CASADA">Venda Casada</option>
                      <option value="PROJETO">Projeto</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label>Observação <span style={{color:'var(--danger)'}}>*</span></label>
                    <textarea className={`obs-textarea${errors.obs?' input-error':''}`} value={obs}
                      onChange={e=>{setObs(e.target.value);setErrors(p=>({...p,obs:''}))}}
                      placeholder="Motivo da solicitação, urgência, cliente aguardando..."/>
                    {errors.obs&&<span className="field-error">{errors.obs}</span>}
                  </div>
                </>
              ) : (
                <>
                  <div className="form-field">
                    <label>Loja de destino (para onde vai)</label>
                    <select className="filter-select" style={{width:'100%'}} value={city} onChange={e=>{setCity(e.target.value); if(fromStore===e.target.value) setFromStore('')}}>
                      <option value="BELTRAO">Beltrão</option>
                      <option value="TOLEDO">Toledo</option>
                      <option value="DOIS_VIZINHOS">Dois Vizinhos</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label>Transferir de qual loja? <span style={{color:'var(--danger)'}}>*</span></label>
                    <select className={`filter-select${errors.fromStore?' input-error':''}`} style={{width:'100%'}} value={fromStore}
                      onChange={e=>{setFromStore(e.target.value);setErrors(p=>({...p,fromStore:''}))}}>
                      <option value="">Selecione a loja de origem…</option>
                      {STORES.filter(s=>s.id!==city).map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                    {errors.fromStore&&<span className="field-error">{errors.fromStore}</span>}
                  </div>
                  <div className="form-field">
                    <label>Observação (opcional)</label>
                    <textarea className="obs-textarea" value={obs}
                      onChange={e=>setObs(e.target.value)}
                      placeholder="Ex.: cliente aguardando, item parado na outra loja…"/>
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <div className="modal-actions">
          {!blocked&&<button className="btn btn-yellow" onClick={submit}>Enviar Solicitação</button>}
          <button className="btn btn-ghost" onClick={onClose}>{blocked?'Fechar':'Cancelar'}</button>
        </div>
      </div>
    </div>
  )
}

import { useState, useCallback, useEffect } from 'react'
import { STATUS_CFG } from '../constants.js'
import { normStr, fmtBRL, fmtDate, bizDaysBetween } from '../utils.js'
import { getRequests, saveRequests } from '../supabase.js'
import { getProductStatus, getArrivalDate } from '../rules.js'

export default function ProductSearchTab({ rawItems, priceMap, discontinuedMap, purchaseHistory, purchaseRequests, productOverrides, availMap, role, caps }) {
  const [search,          setSearch]          = useState('')
  const [cityGroup,       setCityGroup]       = useState('BELTRAO')
  const [results,         setResults]         = useState([])
  const [showReq,         setShowReq]         = useState(null)
  const [expandedHistory, setExpandedHistory] = useState(new Set())

  const toggleHistory = code => setExpandedHistory(prev => {
    const s = new Set(prev); s.has(code) ? s.delete(code) : s.add(code); return s
  })

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
      const status = getProductStatus(code, cityGroup, rawItems, purchaseHistory, purchaseRequests, discontinuedMap, productOverrides, availMap, priceMap)
      const arrival = getArrivalDate(price.ufOrigem||'', price.brand||rawI.brand||'')
      return {
        code,
        description: rawI.description || disc?.description || (disc ? code : code),
        brand:       price.brand || rawI.brand || '',
        pv:          price.pv || 0,
        ufOrigem:    price.ufOrigem || '',
        status,
        arrival,
      }
    })
    setResults(res)
  }, [search, cityGroup, rawItems, purchaseHistory, purchaseRequests, discontinuedMap, priceMap])

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

      {results.length>0&&(
        <div className="search-results">
          <table className="product-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descrição</th>
                <th>Marca</th>
                {caps.seePrices&&<th>PV</th>}
                <th>Status</th>
                <th>Previsão</th>
                {['SELLER','GERENCIA'].includes(role)&&<th>Ação</th>}
              </tr>
            </thead>
            <tbody>
              {results.map((item,idx)=>{
                const cfg = STATUS_CFG[item.status.type] ?? STATUS_CFG.SEM_ESTOQUE
                const now = new Date()
                const hasArrival = ['COMPRADO_COM_PREV','COMPRADO_FATURADO'].includes(item.status.type)
                const arrD = hasArrival&&item.status.arrivalDate ? new Date(item.status.arrivalDate) : null
                const daysToArr = arrD ? bizDaysBetween(now, arrD) : null
                const arrColor  = daysToArr===null?'var(--muted)':daysToArr<7?'var(--success)':daysToArr<=15?'var(--warning)':'var(--danger)'
                const itemHist  = purchaseHistory
                  .filter(h => h.code===item.code && h.cityGroup===cityGroup)
                  .sort((a,b) => new Date(b.date) - new Date(a.date))
                const histOpen  = expandedHistory.has(item.code)
                const colCount  = 5 + (caps.seePrices?1:0) + (['SELLER','GERENCIA'].includes(role)?1:0)
                const renderPrev = () => {
                  const t = item.status.type
                  if (['ENCERRADO','ENCERRADO_COM_SUB','CONSULTAR_COMPRAS'].includes(t))
                    return <span style={{color:'var(--muted)'}}>—</span>
                  if (t==='SEM_ESTOQUE'||t==='COMPRADO_SEM_PREV'||t==='SEM_INFORMACAO')
                    return <span style={{color:'var(--muted)'}}>Sem previsão</span>
                  if (['COMPRADO_COM_PREV','COMPRADO_FATURADO'].includes(t)&&arrD)
                    return <span style={{color:arrColor}}>{fmtDate(arrD)}</span>
                  if (['COMPRADO_COM_PREV','COMPRADO_FATURADO'].includes(t)&&!arrD)
                    return <span style={{color:'var(--muted)'}}>Em trânsito</span>
                  if (t==='DISPONIVEL_IMEDIATO'||t==='AGUARDANDO_COMPRA') {
                    const minArr = getArrivalDate(item.ufOrigem||'', item.brand||'')
                    return <span style={{color:'var(--info)',fontSize:12}}>Mín. {fmtDate(minArr)}</span>
                  }
                  if (t==='DISPONIVEL_MES') {
                    const d = new Date(); d.setDate(d.getDate() + 30)
                    return <span style={{color:'var(--warning)',fontSize:12}}>Mín. {fmtDate(d)}</span>
                  }
                  return <span style={{color:'var(--muted)'}}>—</span>
                }
                return (
                  <>
                    <tr key={item.code} style={{background:idx%2===0?'var(--card)':'var(--surface)'}}>
                      <td className="mono">{item.code}</td>
                      <td className="col-desc" title={item.description}>{item.description}</td>
                      <td><span className="brand-badge">{item.brand||'—'}</span></td>
                      {caps.seePrices&&<td className="num">{item.pv>0?fmtBRL(item.pv):'—'}</td>}
                      <td>
                        <span className="status-badge" style={{background:cfg.bg,color:cfg.txt}}>{cfg.label}</span>
                        {item.status.type==='ENCERRADO_COM_SUB'&&item.status.substituteName&&(
                          <div className="sub-info">→ Substituto: <strong>{item.status.substitute||''}</strong>{item.status.substitute ? ' — ' + item.status.substituteName.replace(item.status.substitute,'').replace(/^[\s\-–—]+/,'') : item.status.substituteName}</div>
                        )}
                        {item.status.type==='DISPONIVEL_IMEDIATO'&&(
                          <div className="sub-info">Estoque: {item.status.stock}</div>
                        )}
                        {itemHist.length>0&&(
                          <div className="sub-info" style={{cursor:'pointer',color:'var(--accent)',userSelect:'none'}} onClick={()=>toggleHistory(item.code)}>
                            {histOpen?'▲':'▼'} {itemHist.length} compra{itemHist.length>1?'s':''}
                          </div>
                        )}
                      </td>
                      <td>{renderPrev()}</td>
                      {['SELLER','GERENCIA'].includes(role)&&(
                        <td>
                          {!['ENCERRADO','ENCERRADO_COM_SUB'].includes(item.status.type)&&(
                            <button className="btn btn-yellow btn-sm" onClick={()=>setShowReq(item)}>Solicitar</button>
                          )}
                        </td>
                      )}
                    </tr>
                    {histOpen&&itemHist.length>0&&(
                      <tr key={item.code+'-hist'} style={{background:'var(--surface2)'}}>
                        <td colSpan={colCount} style={{padding:'8px 12px'}}>
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
                              {itemHist.map(h=>(
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
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
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
          }}/>
      )}
    </div>
  )
}

export function RequestModal({ item, cityGroup: cityGroupProp, purchaseHistory, purchaseRequests, onClose, onSubmit }) {
  const [qty,        setQty]        = useState(1)
  const [obs,        setObs]        = useState('')
  const [tipo,       setTipo]       = useState('ESTOQUE')
  const [city,       setCity]       = useState(cityGroupProp||'BELTRAO')
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
          <h2 className="modal-title">Solicitar Compra</h2>
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
              <div className="form-field">
                <label>Seu nome <span style={{color:'var(--danger)'}}>*</span></label>
                <input className={`login-input${errors.sellerName?' input-error':''}`} value={sellerName}
                  onChange={e=>{setSellerName(e.target.value);setErrors(p=>({...p,sellerName:''}))}}
                  placeholder="Nome do vendedor"/>
                {errors.sellerName&&<span className="field-error">{errors.sellerName}</span>}
              </div>
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

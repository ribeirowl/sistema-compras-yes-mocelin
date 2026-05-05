import { useState, useCallback, useEffect } from 'react'
import { STATUS_CFG } from '../constants.js'
import { normStr, fmtBRL, fmtDate, bizDaysBetween } from '../utils.js'
import { getRequests, saveRequests } from '../supabase.js'
import { getProductStatus, getArrivalDate } from '../rules.js'

export default function ProductSearchTab({ rawItems, priceMap, discontinuedMap, purchaseHistory, purchaseRequests, productOverrides, availMap, role, caps }) {
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
                {role==='SELLER'&&<th>Ação</th>}
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
                const renderPrev = () => {
                  const t = item.status.type
                  if (['ENCERRADO','ENCERRADO_COM_SUB','CONSULTAR_COMPRAS'].includes(t))
                    return <span style={{color:'var(--muted)'}}>—</span>
                  if (t==='SEM_ESTOQUE'||t==='COMPRADO_SEM_PREV'||t==='SEM_INFORMACAO')
                    return <span style={{color:'var(--muted)'}}>Sem previsão</span>
                  if (t==='COMPRADO_AGUARD_FAT')
                    return <span style={{color:'var(--warning)',fontSize:12}}>Ag. faturamento</span>
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
                  <tr key={item.code} style={{background:idx%2===0?'var(--card)':'var(--surface)'}}>
                    <td className="mono">{item.code}</td>
                    <td>{item.description}</td>
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
                    </td>
                    <td>{renderPrev()}</td>
                    {role==='SELLER'&&(
                      <td>
                        {!['ENCERRADO','ENCERRADO_COM_SUB'].includes(item.status.type)&&(
                          <button className="btn btn-yellow btn-sm" onClick={()=>setShowReq(item)}>Solicitar</button>
                        )}
                      </td>
                    )}
                  </tr>
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

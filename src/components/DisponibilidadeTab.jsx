import { useState, useMemo } from 'react'
import { STATUS_CFG } from '../constants.js'
import { normStr, fmtDate, todayStr, useDebounce } from '../utils.js'
import { saveAvailMap, saveOverrides } from '../supabase.js'
import { getProductStatus } from '../rules.js'
import { readWb, parseAvailability } from '../parsers.js'

export function StatusOverrideModal({ item, currentOverride, onClose, onSave, onClear }) {
  const [status,      setStatus]      = useState(currentOverride?.status||'COMPRADO_COM_PREV')
  const [arrivalDate, setArrivalDate] = useState(currentOverride?.arrivalDate||todayStr())
  const [notes,       setNotes]       = useState(currentOverride?.notes||'')
  const needsDate = status==='COMPRADO_COM_PREV'||status==='DISPONIVEL_MES'
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Definir Status Manual</h2>
            <p className="modal-sub">{item.code} · {item.description.slice(0,45)}</p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-field">
            <label>Status</label>
            <select className="filter-select" style={{width:'100%'}} value={status} onChange={e=>setStatus(e.target.value)}>
              <option value="COMPRADO_COM_PREV">Comprado — com previsão de chegada</option>
              <option value="COMPRADO_SEM_PREV">Comprado — sem previsão</option>
              <option value="AGUARDANDO_COMPRA">Aguardando compra</option>
              <option value="DISPONIVEL_MES">Disponível em até 30 dias</option>
            </select>
          </div>
          {needsDate && (
            <div className="form-field">
              <label>Previsão de Chegada</label>
              <input type="date" className="login-input" value={arrivalDate} onChange={e=>setArrivalDate(e.target.value)}/>
            </div>
          )}
          <div className="form-field">
            <label>Observação (NF, pedido...)</label>
            <textarea className="obs-textarea" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="NF, número do pedido, info adicional..."/>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-yellow" onClick={()=>onSave({status, arrivalDate:needsDate?arrivalDate:null, notes})}>Salvar</button>
          {currentOverride && <button className="btn btn-danger" onClick={onClear}>Limpar Status Manual</button>}
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}

export default function DisponibilidadeTab({ rawItems, priceMap, discontinuedMap, purchaseHistory, purchaseRequests, productOverrides, onUpdateOverrides, availMap, onUpdateAvailMap, onNewRequest, caps }) {
  const [search,      setSearch]      = useState('')
  const dSearch = useDebounce(search, 250)
  const [showAll,     setShowAll]     = useState(false)
  const [cityGroup,   setCityGroup]   = useState('BELTRAO')
  const [editItem,    setEditItem]    = useState(null)
  const [requestItem, setRequestItem] = useState(null)
  const [uploading,   setUploading]   = useState(false)
  const [uploadErr,   setUploadErr]   = useState(null)

  const availLoaded = availMap && availMap.size > 0

  const empresas = useMemo(() => {
    const s = new Set()
    rawItems.forEach(i => s.add(i.empresa))
    return [...s].sort()
  }, [rawItems])

  const byCode = useMemo(() => {
    const map = new Map()
    rawItems.forEach(item => {
      if (!map.has(item.code)) {
        map.set(item.code, { code:item.code, description:item.description, family:item.family, brand:item.brand, empresaStock:{}, totalStock:0, totalSuggestion:0 })
      }
      const g = map.get(item.code)
      g.empresaStock[item.empresa] = (g.empresaStock[item.empresa]||0) + item.stock
      g.totalStock += item.stock
      g.totalSuggestion += item.suggestion
    })
    availMap?.forEach((av, code) => {
      if (!map.has(code)) {
        map.set(code, { code, description: av.description || code, family:'', brand:'INTELBRAS', empresaStock:{}, totalStock:0, totalSuggestion:0 })
      }
    })
    return [...map.values()]
  }, [rawItems, availMap])

  const filtered = useMemo(() => {
    let items = byCode
    if (!showAll) items = items.filter(i => i.totalSuggestion > 0 || (availMap?.has(i.code)))
    if (dSearch) { const q=normStr(dSearch); items=items.filter(i=>normStr(i.code).includes(q)||normStr(i.description).includes(q)) }
    return items.sort((a,b) => b.totalSuggestion - a.totalSuggestion)
  }, [byCode, showAll, dSearch, availMap])

  const handleAvailUpload = async file => {
    if (!file) return
    setUploading(true); setUploadErr(null)
    try {
      const wb = await readWb(file)
      const am = parseAvailability(wb)
      if (am.size === 0) throw new Error('Nenhum dado encontrado. Verifique se é a planilha de disponibilidade correta.')
      saveAvailMap(am)
      onUpdateAvailMap(am)
    } catch(e) { setUploadErr(e.message) }
    finally { setUploading(false) }
  }

  const getStatus = item => getProductStatus(item.code, cityGroup, rawItems, purchaseHistory, purchaseRequests, discontinuedMap, productOverrides, availMap, priceMap)

  const applyOverride = (code, data) => {
    const next = { ...productOverrides }
    const key = `${code}__BELTRAO`; const key2 = `${code}__TOLEDO`
    if (!data) { delete next[key]; delete next[key2] }
    else { next[key] = { ...data, setAt:new Date().toISOString() }; next[key2] = { ...data, setAt:new Date().toISOString() } }
    onUpdateOverrides(next); saveOverrides(next)
  }

  return (
    <div>
      <div className="page-header">
        <div><h2 className="page-title">📋 Disponibilidade</h2>
          <p className="page-subtitle">Estoque nas lojas · Disponibilidade Intelbras · Status para vendedores</p></div>
      </div>

      {caps?.canUpload ? (
        <div style={{background:'var(--card)',border:`1px solid ${availLoaded?'var(--success)':'var(--warning)'}`,borderRadius:'var(--r)',padding:'12px 16px',marginBottom:16,display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <div style={{flex:1}}>
            <span style={{fontWeight:700,color:availLoaded?'var(--success)':'var(--warning)',fontSize:13}}>
              {availLoaded ? `✅ Disponibilidade Intelbras carregada — ${availMap.size} produtos` : '⚠️ Planilha de disponibilidade não carregada — status indisponível para vendedores'}
            </span>
            {uploadErr && <div style={{color:'var(--danger)',fontSize:12,marginTop:4}}>⚠️ {uploadErr}</div>}
          </div>
          <label style={{cursor:uploading?'wait':'pointer'}}>
            <input type="file" accept=".xls,.xlsx" hidden disabled={uploading}
              onChange={e=>e.target.files[0]&&handleAvailUpload(e.target.files[0])}/>
            <span className={`btn btn-sm ${availLoaded?'btn-ghost':'btn-yellow'}`}>
              {uploading?<><span className="spinner"/>Carregando...</>:availLoaded?'↑ Atualizar Planilha':'↑ Carregar Planilha de Disponibilidade Intelbras'}
            </span>
          </label>
        </div>
      ) : availLoaded && (
        <div style={{background:'var(--success-bg)',border:'1px solid var(--success)',borderRadius:'var(--r)',padding:'10px 16px',marginBottom:16,fontSize:13,color:'var(--success)',fontWeight:600}}>
          ✅ Disponibilidade Intelbras carregada — {availMap.size} produtos
        </div>
      )}

      <div className="filter-bar">
        <input className="filter-search" placeholder="Buscar código ou descrição..." value={search} onChange={e=>setSearch(e.target.value)}/>
        <select className="filter-select" value={cityGroup} onChange={e=>setCityGroup(e.target.value)}>
          <option value="BELTRAO">Beltrão + DV</option>
          <option value="TOLEDO">Toledo</option>
        </select>
        <label className="filter-toggle">
          <input type="checkbox" checked={showAll} onChange={e=>setShowAll(e.target.checked)}/>
          <span>Mostrar todos os itens</span>
        </label>
        <span style={{fontSize:12,color:'var(--muted)'}}>{filtered.length} itens</span>
      </div>

      {filtered.length===0
        ?<div className="table-empty"><div className="table-empty-icon">📋</div><p>Nenhum item.</p></div>
        :(
          <div className="table-scroll" style={{overflowX:'auto'}}>
            <table className="product-table" style={{minWidth:Math.max(900,700+empresas.length*80)}}>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descrição</th>
                  {empresas.map(e=><th key={e} className="num" title={e} style={{fontSize:10}}>{e.replace(/ /g,' ').slice(0,12)}</th>)}
                  <th className="num" style={{color:'var(--success)'}} title="Disponibilidade Imediata — Origem">Imediato</th>
                  <th className="num" style={{color:'var(--info)'}} title="Disponibilidade P/ Mês — Origem">P/ Mês</th>
                  <th>Status</th>
                  <th>Previsão</th>
                  <th style={{minWidth:140}}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item,idx)=>{
                  const av = availMap?.get(item.code)
                  const status = getStatus(item)
                  const cfg = STATUS_CFG[status.type]??STATUS_CFG.SEM_INFORMACAO
                  const hasOverride = !!(productOverrides?.[`${item.code}__BELTRAO`])
                  return (
                    <tr key={item.code} style={{background:idx%2===0?'var(--card)':'var(--surface)'}}>
                      <td className="mono">{item.code}</td>
                      <td title={item.description} style={{maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.description}</td>
                      {empresas.map(e=>(
                        <td key={e} className="num" style={{color:(item.empresaStock[e]||0)>0?'var(--success)':'var(--muted2)',fontWeight:(item.empresaStock[e]||0)>0?700:400}}>
                          {item.empresaStock[e]||0}
                        </td>
                      ))}
                      <td className="num" style={{color:av?.origemImediato?'var(--success)':'var(--muted2)',fontWeight:700}}>
                        {av ? (av.origemImediato ? 'Sim' : 'Não') : '—'}
                      </td>
                      <td className="num" style={{color:av?.origemMes?'var(--info)':'var(--muted2)'}}>
                        {av ? (av.origemMes ? 'Sim' : 'Não') : '—'}
                      </td>
                      <td>
                        <span className="status-badge" style={{background:cfg.bg,color:cfg.txt}}>{cfg.label}</span>
                        {hasOverride&&<span style={{marginLeft:4,fontSize:10,color:'var(--accent)'}}>✏️</span>}
                      </td>
                      <td style={{fontSize:12,color:'var(--muted)'}}>{status.arrivalDate?fmtDate(status.arrivalDate):'—'}</td>
                      <td style={{display:'flex',gap:3,flexWrap:'nowrap'}}>
                        <button className="btn btn-sm btn-yellow" onClick={()=>setRequestItem(item)}>+ Solicitar</button>
                        {caps?.canUpload&&<button className="btn btn-sm btn-ghost" onClick={()=>setEditItem(item)} title="Status manual">✏️</button>}
                        {caps?.canUpload&&hasOverride&&<button className="btn btn-sm btn-danger" onClick={()=>applyOverride(item.code,null)} title="Limpar">✕</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      }

      {editItem&&(
        <StatusOverrideModal item={editItem}
          currentOverride={productOverrides?.[`${editItem.code}__BELTRAO`]}
          onClose={()=>setEditItem(null)}
          onSave={data=>{applyOverride(editItem.code,data);setEditItem(null)}}
          onClear={()=>{applyOverride(editItem.code,null);setEditItem(null)}}/>
      )}

      {requestItem&&(
        <DisponibilidadeRequestModal item={requestItem}
          purchaseHistory={purchaseHistory} purchaseRequests={purchaseRequests}
          onClose={()=>setRequestItem(null)}
          onSubmit={req=>{onNewRequest(req);setRequestItem(null)}}/>
      )}
    </div>
  )
}

function DisponibilidadeRequestModal({ item, purchaseHistory, purchaseRequests, onClose, onSubmit }) {
  const [cityGroup,  setCityGroup]  = useState('BELTRAO')
  const [qty,        setQty]        = useState(1)
  const [obs,        setObs]        = useState('')
  const [tipo,       setTipo]       = useState('ESTOQUE')
  const [sellerName, setSellerName] = useState(()=>sessionStorage.getItem('sc_name')||'')
  const [errors,     setErrors]     = useState({})
  const alreadyPending = purchaseRequests.some(r=>r.code===item.code&&r.cityGroup===cityGroup&&r.status==='PENDENTE')
  const recentPurchase = purchaseHistory.find(h=>h.code===item.code&&h.cityGroup===cityGroup&&(new Date()-new Date(h.date))/86400000<=30)

  const submit = () => {
    const errs = {}
    if (!sellerName.trim()) errs.sellerName = 'Informe seu nome'
    if (!obs.trim()) errs.obs = 'Observação é obrigatória'
    if (Object.keys(errs).length) { setErrors(errs); return }
    onSubmit({id:Date.now().toString(),code:item.code,description:item.description,brand:item.brand||'',cityGroup,qty,tipo,observation:obs,status:'PENDENTE',createdAt:new Date().toISOString(),createdBy:sellerName.trim()})
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div><h2 className="modal-title">Solicitar Compra</h2>
            <p className="modal-sub">{item.code} · {item.description.slice(0,40)}</p></div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {recentPurchase&&<div className="alert alert-warning">⚠️ Este produto foi comprado há {Math.floor((new Date()-new Date(recentPurchase.date))/86400000)} dia(s) ({fmtDate(recentPurchase.date)}). Confirme se realmente deseja solicitar novamente.</div>}
          {alreadyPending&&<div className="alert alert-warning">⚠️ Já existe uma solicitação pendente para esta cidade.</div>}
          <div className="form-field">
            <label>Seu nome <span style={{color:'var(--danger)'}}>*</span></label>
            <input className={`login-input${errors.sellerName?' input-error':''}`} value={sellerName}
              onChange={e=>{setSellerName(e.target.value);setErrors(p=>({...p,sellerName:''}))}}
              placeholder="Nome do vendedor"/>
            {errors.sellerName&&<span className="field-error">{errors.sellerName}</span>}
          </div>
          <div className="form-field">
            <label>Cidade</label>
            <select className="filter-select" style={{width:'100%'}} value={cityGroup} onChange={e=>setCityGroup(e.target.value)}>
              <option value="BELTRAO">Beltrão</option>
              <option value="TOLEDO">Toledo</option>
              <option value="DOIS_VIZINHOS">Dois Vizinhos</option>
            </select>
          </div>
          <div className="form-field">
            <label>Quantidade</label>
            <input type="number" className="login-input" min="1" value={qty} onChange={e=>setQty(parseInt(e.target.value)||1)}/>
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
              placeholder="Motivo, urgência, cliente aguardando..."/>
            {errors.obs&&<span className="field-error">{errors.obs}</span>}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-yellow" onClick={submit}>Enviar Solicitação</button>
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}

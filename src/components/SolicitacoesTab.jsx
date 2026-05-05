import { useState } from 'react'
import { normStr, fmtDate, fmtBRL, todayStr } from '../utils.js'
import { saveRequests, saveHistory } from '../supabase.js'

function SolicitacaoDetailModal({ req, users, caps, userName, priceMap, onClose, onSave }) {
  const [qty,      setQty]      = useState(req.qty || 1)
  const [response, setResponse] = useState(req.response || '')
  const seller = (users||[]).find(u => normStr(u.name) === normStr(req.createdBy || ''))

  const buildWaMsg = (status) => {
    const label = status === 'APROVADO' ? 'aprovada ✅' : status === 'RECUSADO' ? 'recusada ❌' : 'atualizada'
    let msg = `Olá ${req.createdBy}! Sua solicitação de compra foi ${label}:\n\n`
    msg += `📦 Código: ${req.code}\n`
    msg += `📝 ${(req.description||'').slice(0,60)}\n`
    msg += `🔢 Quantidade: ${qty} un.\n`
    msg += `🏪 Cidade: ${req.cityGroup==='BELTRAO'?'Beltrão':req.cityGroup==='TOLEDO'?'Toledo':'Dois Viz.'}\n`
    if (response.trim()) msg += `\n💬 ${response.trim()}`
    return msg
  }

  const sendWa = (status) => {
    if (!seller?.whatsapp) return
    const phone = '55' + seller.whatsapp.replace(/\D/g,'')
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(buildWaMsg(status))}`, '_blank')
  }

  const handleAction = (status) => {
    const updated = { ...req, qty: Number(qty), response: response.trim(), respondedBy: userName || '', respondedAt: new Date().toISOString(), status, resolvedAt: new Date().toISOString() }
    onSave(updated, status)
    sendWa(status)
    onClose()
  }

  const handleSaveQty = () => {
    const updated = { ...req, qty: Number(qty), response: response.trim() }
    onSave(updated, null)
    if (seller?.whatsapp && (Number(qty) !== req.qty || response.trim() !== (req.response||'').trim())) sendWa(null)
    onClose()
  }

  const tipoLabel = req.tipo==='VENDA_CASADA'?'Venda Casada':req.tipo==='PROJETO'?'Projeto':'Estoque'
  const canEdit = caps.canApprove

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:520}}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">📋 Solicitação de Compra</h2>
            <p className="modal-sub">{req.createdBy} · {fmtDate(req.createdAt)}</p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{display:'flex',flexDirection:'column',gap:12}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div>
              <div style={{fontSize:11,color:'var(--muted)',marginBottom:2}}>Código</div>
              <div className="mono" style={{fontWeight:700}}>{req.code}</div>
            </div>
            <div>
              <div style={{fontSize:11,color:'var(--muted)',marginBottom:2}}>Cidade</div>
              <span className={`empresa-badge ${req.cityGroup==='BELTRAO'?'beltrao':req.cityGroup==='TOLEDO'?'toledo':'dv'}`}>
                {req.cityGroup==='BELTRAO'?'Beltrão':req.cityGroup==='TOLEDO'?'Toledo':'Dois Viz.'}
              </span>
            </div>
            <div style={{gridColumn:'1/-1'}}>
              <div style={{fontSize:11,color:'var(--muted)',marginBottom:2}}>Descrição</div>
              <div style={{fontWeight:600}}>{req.description}</div>
            </div>
            <div>
              <div style={{fontSize:11,color:'var(--muted)',marginBottom:2}}>Tipo</div>
              <span style={{fontSize:12,padding:'2px 8px',borderRadius:4,background:'var(--surface)',border:'1px solid var(--border)'}}>{tipoLabel}</span>
            </div>
            <div>
              <div style={{fontSize:11,color:'var(--muted)',marginBottom:2}}>Status</div>
              <span className={`status-tag status-${(req.status||'').toLowerCase()}`}>{req.status}</span>
            </div>
            <div>
              <div style={{fontSize:11,color:'var(--muted)',marginBottom:2}}>Quantidade</div>
              {canEdit
                ? <input type="number" min="1" className="filter-input" style={{width:80,padding:'4px 8px'}}
                    value={qty} onChange={e=>setQty(Math.max(1,parseInt(e.target.value)||1))}/>
                : <div style={{fontWeight:600}}>{req.qty}</div>
              }
            </div>
            <div>
              <div style={{fontSize:11,color:'var(--muted)',marginBottom:2}}>Solicitante</div>
              <div>{req.createdBy}</div>
            </div>
          </div>
          {req.observation&&(
            <div style={{background:'var(--surface)',borderRadius:6,padding:'8px 12px',border:'1px solid var(--border)'}}>
              <div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>Observação do solicitante</div>
              <div style={{fontSize:13}}>{req.observation}</div>
            </div>
          )}
          {req.response&&!canEdit&&(
            <div style={{background:'var(--info-bg)',borderRadius:6,padding:'8px 12px',border:'1px solid var(--info)'}}>
              <div style={{fontSize:11,color:'var(--info)',marginBottom:4}}>Resposta de {req.respondedBy||'Compras'}</div>
              <div style={{fontSize:13}}>{req.response}</div>
            </div>
          )}
          {canEdit&&(
            <div className="form-field">
              <label>Resposta / Observação</label>
              <textarea className="filter-input" rows={3} style={{width:'100%',resize:'vertical',fontFamily:'inherit',fontSize:13}}
                placeholder="Digite uma resposta para o vendedor (opcional)..."
                value={response} onChange={e=>setResponse(e.target.value)}/>
            </div>
          )}
          {!seller?.whatsapp&&canEdit&&(
            <div style={{fontSize:12,color:'var(--muted)'}}>⚠️ Vendedor sem WhatsApp cadastrado — notificação não será enviada.</div>
          )}
        </div>
        <div className="modal-actions" style={{justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
          <div style={{display:'flex',gap:6}}>
            {canEdit&&req.status==='PENDENTE'&&(
              <>
                <button className="btn" style={{background:'var(--success-bg)',color:'var(--success)',border:'1px solid var(--success)'}}
                  onClick={()=>handleAction('APROVADO')}>✔ Aprovar{seller?.whatsapp?' + Notificar':''}</button>
                <button className="btn" style={{background:'var(--danger-bg)',color:'var(--danger)',border:'1px solid var(--danger)'}}
                  onClick={()=>handleAction('RECUSADO')}>✘ Recusar{seller?.whatsapp?' + Notificar':''}</button>
              </>
            )}
            {canEdit&&req.status!=='PENDENTE'&&seller?.whatsapp&&(
              <button className="btn btn-ghost" onClick={()=>sendWa(req.status)}>📱 Reenviar Notif. WA</button>
            )}
          </div>
          <div style={{display:'flex',gap:6}}>
            {canEdit&&(
              <button className="btn btn-yellow" onClick={handleSaveQty}>💾 Salvar{seller?.whatsapp&&(Number(qty)!==req.qty||response.trim()!==(req.response||'').trim())?' + Notificar':''}</button>
            )}
            <button className="btn btn-ghost" onClick={onClose}>Fechar</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SolicitacoesTab({ purchaseRequests, onUpdateRequests, caps, purchaseHistory, onUpdateHistory, priceMap, userName, users }) {
  const [filter,    setFilter]    = useState('PENDENTE')
  const [detailReq, setDetailReq] = useState(null)

  const visible = purchaseRequests
    .filter(r=>filter===''||r.status===filter)
    .sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))

  const saveRequest = (updatedReq, newStatus) => {
    const reqs = purchaseRequests.map(r => r.id === updatedReq.id ? updatedReq : r)
    onUpdateRequests(reqs)
    saveRequests(reqs)
    if (newStatus === 'APROVADO') {
      const price = priceMap?.get(updatedReq.code)
      const entry = {
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        code: updatedReq.code,
        description: updatedReq.description || updatedReq.code,
        brand: updatedReq.brand || price?.brand || '',
        qty: updatedReq.qty || 1,
        pv: price?.pv || updatedReq.pv || 0,
        cityGroup: updatedReq.cityGroup || 'BELTRAO',
        date: todayStr(),
        enteredBy: userName || sessionStorage.getItem('sc_name') || 'Sistema',
        fromRequest: updatedReq.id,
      }
      const h = [...(purchaseHistory||[]), entry]
      onUpdateHistory(h)
      saveHistory(h)
    }
  }

  const quickAction = (req, status) => {
    const updated = { ...req, status, resolvedAt: new Date().toISOString() }
    saveRequest(updated, status)
  }

  return (
    <div className="solicit-tab">
      <div className="page-header">
        <div>
          <h2 className="page-title">Solicitações de Compra</h2>
          <p className="page-subtitle">{purchaseRequests.filter(r=>r.status==='PENDENTE').length} pendente(s)</p>
        </div>
        <div style={{display:'flex',gap:6}}>
          {['','PENDENTE','APROVADO','RECUSADO'].map(s=>(
            <button key={s} className={`btn btn-sm ${filter===s?'btn-yellow':'btn-ghost'}`}
              onClick={()=>setFilter(s)}>{s||'Todas'}</button>
          ))}
        </div>
      </div>
      {visible.length===0
        ?<div className="table-empty"><div className="table-empty-icon">📋</div><p>Nenhuma solicitação.</p></div>
        :(
          <div className="table-scroll">
            <table className="product-table">
              <thead><tr>
                <th>Código</th><th>Descrição</th><th>Cidade</th>
                <th className="num">Qtd</th><th>Solicitado por</th><th>Tipo</th><th>Data</th>
                <th>Observação / Resposta</th><th>Status</th>
                <th>Ver</th>
                {caps.canApprove&&<th>Ações</th>}
              </tr></thead>
              <tbody>
                {visible.map((r,idx)=>(
                  <tr key={r.id} style={{background:idx%2===0?'var(--card)':'var(--surface)'}}>
                    <td className="mono">{r.code}</td>
                    <td title={r.description}>{(r.description||'').slice(0,40)}{(r.description||'').length>40&&'...'}</td>
                    <td><span className={`empresa-badge ${r.cityGroup==='BELTRAO'?'beltrao':r.cityGroup==='TOLEDO'?'toledo':'dv'}`}>{r.cityGroup==='BELTRAO'?'Beltrão':r.cityGroup==='TOLEDO'?'Toledo':'Dois Viz.'}</span></td>
                    <td className="num">{r.qty}</td>
                    <td>{r.createdBy}</td>
                    <td><span style={{fontSize:11,padding:'2px 6px',borderRadius:4,background:'var(--surface)',border:'1px solid var(--border)'}}>{r.tipo==='VENDA_CASADA'?'Venda Casada':r.tipo==='PROJETO'?'Projeto':'Estoque'}</span></td>
                    <td>{fmtDate(r.createdAt)}</td>
                    <td title={r.response||r.observation}>
                      {r.response
                        ? <span style={{color:'var(--info)',fontSize:12}}>💬 {r.response.slice(0,25)}{r.response.length>25&&'...'}</span>
                        : <span style={{color:'var(--muted)',fontSize:12}}>{(r.observation||'').slice(0,25)}{(r.observation||'').length>25&&'...'}</span>
                      }
                    </td>
                    <td><span className={`status-tag status-${(r.status||'').toLowerCase()}`}>{r.status}</span></td>
                    <td>
                      <button className="btn btn-sm btn-ghost" onClick={()=>setDetailReq(r)}>🔍 Ver</button>
                    </td>
                    {caps.canApprove&&(
                      <td>
                        {r.status==='PENDENTE'&&(
                          <div style={{display:'flex',gap:4}}>
                            <button className="btn btn-sm" style={{background:'var(--success-bg)',color:'var(--success)',border:'1px solid var(--success)'}}
                              onClick={()=>quickAction(r,'APROVADO')}>✔</button>
                            <button className="btn btn-sm" style={{background:'var(--danger-bg)',color:'var(--danger)',border:'1px solid var(--danger)'}}
                              onClick={()=>quickAction(r,'RECUSADO')}>✘</button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      {detailReq&&(
        <SolicitacaoDetailModal
          req={detailReq}
          users={users||[]}
          caps={caps}
          userName={userName}
          priceMap={priceMap}
          onClose={()=>setDetailReq(null)}
          onSave={(updated, status) => { saveRequest(updated, status); setDetailReq(null) }}
        />
      )}
    </div>
  )
}

import { useState, useMemo } from 'react'
import { normStr, fmtDate, todayStr } from '../utils.js'

export const STORES = [
  { id:'BELTRAO',       label:'Beltrão' },
  { id:'TOLEDO',        label:'Toledo' },
  { id:'DOIS_VIZINHOS', label:'Dois Vizinhos' },
]
export const storeLabel = id => STORES.find(s=>s.id===id)?.label || id || '—'

const STATUS_CFG = {
  PENDENTE: { label:'Pendente', bg:'var(--warning-bg)', color:'var(--warning)' },
  APROVADO: { label:'Aprovada', bg:'var(--success-bg)', color:'var(--success)' },
  RECUSADO: { label:'Recusada', bg:'var(--danger-bg)',  color:'var(--danger)' },
}

export default function TransferenciasTab({ transferRequests, onUpdate, caps, userName }) {
  const [statusFilter, setStatusFilter] = useState('')
  const [search,       setSearch]       = useState('')
  const [approving,    setApproving]    = useState(null)  // id em aprovação
  const [qty,          setQty]          = useState(1)
  const [date,         setDate]         = useState(todayStr())

  const list = useMemo(() => {
    let out = [...(transferRequests||[])]
    if (statusFilter) out = out.filter(t => t.status === statusFilter)
    if (search) {
      const q = normStr(search)
      out = out.filter(t => normStr(t.code).includes(q) || normStr(t.description).includes(q))
    }
    return out.sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0))
  }, [transferRequests, statusFilter, search])

  const pendentes = (transferRequests||[]).filter(t => t.status === 'PENDENTE').length

  const openApprove = t => { setApproving(t.id); setQty(t.transferQty||1); setDate(t.transferDate||todayStr()) }

  const confirmApprove = t => {
    if (!(qty > 0) || !date) return
    const updated = (transferRequests||[]).map(x => x.id===t.id
      ? { ...x, status:'APROVADO', transferQty:qty, transferDate:date, resolvedBy:userName||'Gabriel', resolvedAt:new Date().toISOString() }
      : x)
    onUpdate(updated)
    setApproving(null)
  }

  const reject = t => {
    const updated = (transferRequests||[]).map(x => x.id===t.id
      ? { ...x, status:'RECUSADO', resolvedBy:userName||'Gabriel', resolvedAt:new Date().toISOString() }
      : x)
    onUpdate(updated)
    setApproving(null)
  }

  return (
    <div style={{padding:24}}>
      <div className="page-header">
        <div>
          <h2 className="page-title">🔄 Transferências</h2>
          <p className="page-subtitle">
            {(transferRequests||[]).length} solicitação(ões)
            {pendentes>0 && <span style={{color:'var(--warning)',marginLeft:8}}>· {pendentes} pendente(s)</span>}
          </p>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <input className="filter-search" style={{minWidth:180}} placeholder="Buscar código ou descrição..."
            value={search} onChange={e=>setSearch(e.target.value)}/>
          <select className="filter-select" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
            <option value="">Todos os status</option>
            <option value="PENDENTE">Pendentes</option>
            <option value="APROVADO">Aprovadas</option>
            <option value="RECUSADO">Recusadas</option>
          </select>
        </div>
      </div>

      {list.length===0
        ? <div className="table-empty"><div className="table-empty-icon">🔄</div><p>Nenhuma solicitação de transferência.</p></div>
        : (
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {list.map(t => {
              const cfg = STATUS_CFG[t.status] || STATUS_CFG.PENDENTE
              const isApproving = approving === t.id
              return (
                <div key={t.id} style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--r)',padding:'12px 16px'}}>
                  <div style={{display:'flex',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
                    <div style={{flex:1,minWidth:220}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                        <span className="mono" style={{color:'var(--accent)',fontWeight:700}}>{t.code}</span>
                        <span style={{fontWeight:600}}>{t.description}</span>
                      </div>
                      <div style={{fontSize:13,color:'var(--muted)',marginTop:4}}>
                        Transferir de <strong style={{color:'var(--text)'}}>{storeLabel(t.fromStore)}</strong>
                        {' → '}<strong style={{color:'var(--text)'}}>{storeLabel(t.cityGroup)}</strong>
                      </div>
                      <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>
                        Solicitado por {t.createdBy || '—'} · {fmtDate(t.createdAt)}
                      </div>
                      {t.observation && <div style={{fontSize:12,color:'var(--muted2)',marginTop:4,fontStyle:'italic'}}>Obs: {t.observation}</div>}
                      {t.status==='APROVADO' && (
                        <div style={{fontSize:13,color:'var(--success)',marginTop:6,fontWeight:600}}>
                          ✓ {t.transferQty} un. · vai para a loja em {fmtDate(t.transferDate)}
                        </div>
                      )}
                    </div>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:8}}>
                      <span style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:4,background:cfg.bg,color:cfg.color}}>{cfg.label}</span>
                      {caps?.canApprove && t.status==='PENDENTE' && !isApproving && (
                        <div style={{display:'flex',gap:6}}>
                          <button className="btn btn-sm btn-yellow" onClick={()=>openApprove(t)}>Aceitar</button>
                          <button className="btn btn-sm" style={{background:'var(--danger-bg)',color:'var(--danger)',border:'1px solid var(--danger)'}} onClick={()=>reject(t)}>Recusar</button>
                        </div>
                      )}
                    </div>
                  </div>

                  {caps?.canApprove && isApproving && (
                    <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid var(--border)',display:'flex',gap:10,alignItems:'flex-end',flexWrap:'wrap'}}>
                      <div className="form-field" style={{margin:0}}>
                        <label>Quantidade a transferir</label>
                        <input type="number" min="1" className="login-input" style={{width:130}} value={qty}
                          onChange={e=>setQty(parseInt(e.target.value,10)||0)}/>
                      </div>
                      <div className="form-field" style={{margin:0}}>
                        <label>Data que vai para a loja</label>
                        <input type="date" className="login-input" style={{width:170}} value={date}
                          onChange={e=>setDate(e.target.value)}/>
                      </div>
                      <button className="btn btn-yellow" onClick={()=>confirmApprove(t)}>✔ Confirmar</button>
                      <button className="btn btn-ghost" onClick={()=>setApproving(null)}>Cancelar</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      }
    </div>
  )
}

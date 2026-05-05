import { useState, useMemo } from 'react'
import { normStr, fmtBRL, fmtDate, todayStr } from '../utils.js'
import { getOrders, saveOrders, saveHistory } from '../supabase.js'
import ConfirmModal from './ConfirmModal.jsx'

const EMPTY_LINE = {code:'',description:'',brand:'',qty:1,pv:0}

export default function FinancialTab({ purchaseHistory, onUpdateHistory, caps, onDeleteOrder, rawItems, priceMap, userName }) {
  const [showAdd,   setShowAdd]   = useState(false)
  const [editItem,    setEditItem]    = useState(null)
  const [deleteId,    setDeleteId]    = useState(null)
  const [regCity,   setRegCity]   = useState('BELTRAO')
  const [regDate,   setRegDate]   = useState(todayStr())
  const [regLines,  setRegLines]  = useState([{...EMPTY_LINE}])
  const [suggest,   setSuggest]   = useState({idx:-1,list:[]})

  const searchItems = (q, idx) => {
    if (!q || q.length < 2) { setSuggest({idx:-1,list:[]}); return }
    const nq = normStr(q)
    const seen = new Set()
    const hits = []
    rawItems.forEach(i => {
      if (seen.has(i.code)) return
      if (normStr(i.code).includes(nq)||normStr(i.description).includes(nq)) {
        const price = priceMap?.get(i.code) ?? {}
        hits.push({code:i.code, description:i.description, brand:price.brand||i.brand||'', pv:price.pv||0})
        seen.add(i.code)
      }
    })
    priceMap?.forEach((v,k) => {
      if (!seen.has(k) && normStr(k).includes(nq)) {
        hits.push({code:k, description:k, brand:v.brand||'', pv:v.pv||0})
        seen.add(k)
      }
    })
    setSuggest({idx, list:hits.slice(0,8)})
  }

  const pickSuggest = (item) => {
    setRegLines(prev => prev.map((l,i) => i===suggest.idx ? {...l,...item} : l))
    setSuggest({idx:-1, list:[]})
  }

  const setLine = (idx, field, val) => {
    setRegLines(prev => prev.map((l,i) => i===idx ? {...l,[field]:val} : l))
    if (field==='code'||field==='description') searchItems(val, idx)
    else setSuggest({idx:-1,list:[]})
  }

  const addLine  = () => setRegLines(prev=>[...prev,{...EMPTY_LINE}])
  const remLine  = idx => setRegLines(prev=>prev.filter((_,i)=>i!==idx))

  const doAdd = () => {
    const valid = regLines.filter(l=>l.code.trim())
    if (!valid.length) return
    const newEntries = valid.map(l=>({
      id: Date.now().toString()+Math.random().toString(36).slice(2),
      code:l.code.trim(), description:l.description||l.code, brand:l.brand,
      qty:l.qty||1, pv:l.pv||0, cityGroup:regCity, date:regDate,
      enteredBy: userName || sessionStorage.getItem('sc_name') || 'Sistema',
    }))
    const h = [...purchaseHistory, ...newEntries]
    onUpdateHistory(h); saveHistory(h)
    setShowAdd(false)
    setRegLines([{...EMPTY_LINE}]); setSuggest({idx:-1,list:[]})
  }

  const doEdit = () => {
    const h = purchaseHistory.map(x => x.id===editItem.id ? {...x,...editItem} : x)
    onUpdateHistory(h)
    saveHistory(h)
    const allOrders = getOrders().map(o => o.id===editItem.id ? {...o,...editItem} : o)
    saveOrders(allOrders)
    setEditItem(null)
  }

  const doDelete = (id) => {
    const h = purchaseHistory.filter(x => x.id !== id)
    onUpdateHistory(h)
    saveHistory(h)
    const allOrders = getOrders().filter(o => o.id !== id)
    saveOrders(allOrders)
    if (onDeleteOrder) onDeleteOrder(allOrders)
    setDeleteId(null)
  }

  const byMonth = useMemo(() => {
    const m = new Map()
    purchaseHistory.forEach(h => {
      const key = (h.date||'').slice(0,7)
      if (!m.has(key)) m.set(key,{total:0,count:0})
      const e = m.get(key)
      e.total += (h.qty||0)*(h.pv||0)
      e.count += 1
    })
    return [...m.entries()].sort((a,b)=>b[0].localeCompare(a[0])).slice(0,12)
  },[purchaseHistory])

  return (
    <div className="financial-tab">
      <div className="page-header">
        <div>
          <h2 className="page-title">Financeiro</h2>
          <p className="page-subtitle">Histórico de compras e resumo mensal</p>
        </div>
        <button className="btn btn-yellow" onClick={()=>setShowAdd(true)}>+ Registrar Compra</button>
      </div>

      {byMonth.length>0&&(
        <div className="fin-grid">
          {byMonth.map(([month,data])=>(
            <div key={month} className="fin-card">
              <div className="fin-month">{month}</div>
              <div className="fin-value">{fmtBRL(data.total)}</div>
              <div className="fin-count">{data.count} pedido(s)</div>
            </div>
          ))}
        </div>
      )}

      <div className="table-scroll">
        <table className="product-table">
          <thead><tr>
            <th>Código</th><th>Descrição</th><th>Cidade</th>
            <th className="num">Qtd</th><th className="num">PV</th><th className="num">Total</th><th>Data</th>
            {caps?.canEdit&&<th style={{width:80}}>Ações</th>}
          </tr></thead>
          <tbody>
            {purchaseHistory.slice().reverse().map((h,idx)=>(
              <tr key={h.id} style={{background:idx%2===0?'var(--card)':'var(--surface)'}}>
                <td className="mono">{h.code}</td>
                <td>{h.description}</td>
                <td>{h.cityGroup}</td>
                <td className="num">{h.qty}</td>
                <td className="num">{fmtBRL(h.pv)}</td>
                <td className="num"><strong>{fmtBRL((h.qty||0)*(h.pv||0))}</strong></td>
                <td>{fmtDate(h.date)}</td>
                {caps?.canEdit&&(
                  <td style={{whiteSpace:'nowrap'}}>
                    <button className="btn btn-sm btn-secondary" style={{marginRight:4}}
                      onClick={()=>setEditItem({...h})}>✏️</button>
                    <button className="btn btn-sm" style={{background:'var(--danger-bg)',color:'var(--danger)'}}
                      onClick={()=>setDeleteId(h.id)}>🗑️</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editItem&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setEditItem(null)}>
          <div className="modal">
            <div className="modal-header">
              <h2 className="modal-title">Editar Pedido</h2>
              <button className="modal-close" onClick={()=>setEditItem(null)}>✕</button>
            </div>
            <div className="modal-body">
              {[['Código','code','text'],['Descrição','description','text'],['Data','date','date']].map(([lbl,key,type])=>(
                <div key={key} className="form-field">
                  <label>{lbl}</label>
                  <input type={type} className="login-input" value={editItem[key]||''}
                    onChange={e=>setEditItem({...editItem,[key]:e.target.value})}/>
                </div>
              ))}
              <div className="form-field">
                <label>Quantidade</label>
                <input type="number" className="login-input" min="1" value={editItem.qty||1}
                  onChange={e=>setEditItem({...editItem,qty:parseInt(e.target.value)||1})}/>
              </div>
              <div className="form-field">
                <label>PV (R$)</label>
                <input type="number" className="login-input" min="0" step="0.01" value={editItem.pv||0}
                  onChange={e=>setEditItem({...editItem,pv:parseFloat(e.target.value)||0})}/>
              </div>
              <div className="form-field">
                <label>Cidade</label>
                <select className="login-input" value={editItem.cityGroup||'BELTRAO'}
                  onChange={e=>setEditItem({...editItem,cityGroup:e.target.value})}>
                  <option value="BELTRAO">Beltrão</option>
                  <option value="TOLEDO">Toledo</option>
                  <option value="DOIS_VIZINHOS">Dois Vizinhos</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setEditItem(null)}>Cancelar</button>
              <button className="btn btn-yellow" onClick={doEdit}>💾 Salvar</button>
            </div>
          </div>
        </div>
      )}

      {showAdd&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&(setShowAdd(false),setSuggest({idx:-1,list:[]}))}>
          <div className="modal" style={{maxWidth:680,width:'95vw'}}>
            <div className="modal-header">
              <h2 className="modal-title">Registrar Compra</h2>
              <button className="modal-close" onClick={()=>setShowAdd(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{display:'flex',gap:12,marginBottom:16,flexWrap:'wrap'}}>
                <div className="form-field" style={{flex:1,minWidth:130}}>
                  <label>Data</label>
                  <input type="date" className="login-input" value={regDate} onChange={e=>setRegDate(e.target.value)}/>
                </div>
                <div className="form-field" style={{flex:1,minWidth:130}}>
                  <label>Cidade</label>
                  <select className="filter-select" style={{width:'100%'}} value={regCity} onChange={e=>setRegCity(e.target.value)}>
                    <option value="BELTRAO">Beltrão</option>
                    <option value="TOLEDO">Toledo</option>
                    <option value="DOIS_VIZINHOS">Dois Vizinhos</option>
                  </select>
                </div>
              </div>
              <div style={{fontSize:12,color:'var(--muted)',marginBottom:8,fontWeight:600,textTransform:'uppercase',letterSpacing:.5}}>Itens da Compra</div>
              {regLines.map((line,idx)=>(
                <div key={idx} style={{position:'relative',background:'var(--surface2)',borderRadius:6,padding:'10px 12px',marginBottom:8}}>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 2fr auto auto auto',gap:8,alignItems:'center'}}>
                    <div style={{position:'relative'}}>
                      <input className="login-input" placeholder="Código" value={line.code}
                        onChange={e=>setLine(idx,'code',e.target.value)}
                        onBlur={()=>setTimeout(()=>setSuggest(p=>p.idx===idx?{idx:-1,list:[]}:p),150)}
                        style={{fontSize:12,padding:'6px 8px'}}/>
                      {suggest.idx===idx&&suggest.list.length>0&&(
                        <div style={{position:'absolute',top:'100%',left:0,right:0,background:'var(--card)',border:'1px solid var(--border)',borderRadius:4,zIndex:50,maxHeight:180,overflowY:'auto'}}>
                          {suggest.list.map(s=>(
                            <div key={s.code} onMouseDown={()=>pickSuggest(s)}
                              style={{padding:'6px 10px',cursor:'pointer',fontSize:12,borderBottom:'1px solid var(--border)'}}
                              onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'}
                              onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                              <span style={{color:'var(--accent)',marginRight:6}}>{s.code}</span>
                              <span style={{color:'var(--muted)'}}>{s.description?.slice(0,40)}</span>
                              {s.brand&&<span className="brand-badge" style={{marginLeft:6,fontSize:10}}>{s.brand}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <input className="login-input" placeholder="Descrição" value={line.description}
                      onChange={e=>setLine(idx,'description',e.target.value)}
                      style={{fontSize:12,padding:'6px 8px'}}/>
                    <input className="login-input" type="number" placeholder="Qtd" min="1" value={line.qty}
                      onChange={e=>setLine(idx,'qty',parseInt(e.target.value)||1)}
                      style={{width:60,fontSize:12,padding:'6px 8px'}}/>
                    <input className="login-input" type="number" placeholder="PV" min="0" step="0.01" value={line.pv}
                      onChange={e=>setLine(idx,'pv',parseFloat(e.target.value)||0)}
                      style={{width:90,fontSize:12,padding:'6px 8px'}}/>
                    {regLines.length>1
                      ? <button className="btn btn-sm" style={{background:'var(--danger-bg)',color:'var(--danger)',padding:'4px 8px'}} onClick={()=>remLine(idx)}>✕</button>
                      : <div style={{width:32}}/>}
                  </div>
                  {line.brand&&<div style={{fontSize:11,color:'var(--muted)',marginTop:4}}>Fabricante: <strong>{line.brand}</strong>{line.pv>0&&<span style={{marginLeft:8}}>PV: {fmtBRL(line.pv)}</span>}</div>}
                </div>
              ))}
              <button className="btn btn-secondary btn-sm" onClick={addLine} style={{marginTop:4}}>+ Adicionar item</button>
            </div>
            <div className="modal-actions">
              <button className="btn btn-yellow" onClick={doAdd}>💾 Salvar Compra</button>
              <button className="btn btn-ghost" onClick={()=>setShowAdd(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
      {deleteId&&(
        <ConfirmModal
          title="Remover pedido"
          message="Remover este registro do histórico? Essa ação não pode ser desfeita."
          confirmLabel="Remover"
          confirmClass="btn-danger"
          onConfirm={()=>doDelete(deleteId)}
          onCancel={()=>setDeleteId(null)}/>
      )}
    </div>
  )
}

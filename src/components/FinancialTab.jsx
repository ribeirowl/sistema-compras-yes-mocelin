import { useState, useMemo, useEffect, useCallback } from 'react'
import { normStr, fmtBRL, fmtDate, todayStr } from '../utils.js'
import { sb, getOrders, saveOrders, saveHistory } from '../supabase.js'
import ConfirmModal from './ConfirmModal.jsx'

const CNPJ_CITY = {
  '35369505000102': 'BELTRAO',
  '35369505000374': 'TOLEDO',
}

const EMPTY_LINE = {code:'',description:'',brand:'',qty:1,pv:0}

export default function FinancialTab({ purchaseHistory, onUpdateHistory, caps, onDeleteOrder, onAddToOrders, rawItems, priceMap, userName, orders }) {
  const [showAdd,      setShowAdd]      = useState(false)
  const [editItem,     setEditItem]     = useState(null)
  const [deleteId,     setDeleteId]     = useState(null)
  const [confirmLimpar,setConfirmLimpar]= useState(false)
  const [histSearch,   setHistSearch]   = useState('')
  const [sbPedidos,    setSbPedidos]    = useState([])

  const loadSbPedidos = useCallback(() => {
    sb.from('pedidos')
      .select('id,numero,loja_cnpj,status,data_pedido,previsao_entrega,pedido_itens(codigo,descricao,quantidade,valor_unit_centavos),notas_fiscais(numero)')
      .in('status', ['faturado','parcial'])
      .order('data_pedido', {ascending:false})
      .then(({ data }) => setSbPedidos(data || []))
  }, [])

  useEffect(() => { loadSbPedidos() }, [loadSbPedidos])
  const [regCity,      setRegCity]      = useState('BELTRAO')
  const [regDate,      setRegDate]      = useState(todayStr())
  const [regLines,     setRegLines]     = useState([{...EMPTY_LINE}])
  const [suggest,      setSuggest]      = useState({idx:-1,list:[]})

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
      ufOrigem: priceMap?.get(l.code.trim())?.ufOrigem || '',
    }))
    const h = [...purchaseHistory, ...newEntries]
    onUpdateHistory(h); saveHistory(h)
    if (onAddToOrders) onAddToOrders(newEntries)
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

  const manualCount = useMemo(() =>
    (purchaseHistory||[]).filter(h => !h.fromRequest).length
  , [purchaseHistory])

  const doLimparManuais = () => {
    const toRemoveIds = new Set((purchaseHistory||[]).filter(h => !h.fromRequest).map(h => h.id))
    const newHistory = (purchaseHistory||[]).filter(h => h.fromRequest)
    onUpdateHistory(newHistory)
    saveHistory(newHistory)
    const allOrders = getOrders().filter(o => !toRemoveIds.has(o.id))
    saveOrders(allOrders)
    if (onDeleteOrder) onDeleteOrder(allOrders)
    setConfirmLimpar(false)
  }

  // Pedidos faturados/parciais do Supabase → uma linha por item
  const sbItems = useMemo(() => {
    // IDs de pedidos que já estão faturados — para excluir da carteira local
    const faturadoNums = new Set(sbPedidos.map(p => `${p.numero}__${p.loja_cnpj}`))
    return sbPedidos.flatMap(p =>
      (p.pedido_itens||[]).map(i => ({
        id:            `nf_${p.id}_${i.codigo}`,
        code:          i.codigo,
        description:   i.descricao || i.codigo,
        qty:           i.quantidade,
        pv:            (i.valor_unit_centavos || 0) / 100,
        cityGroup:     CNPJ_CITY[p.loja_cnpj] || 'BELTRAO',
        date:          p.data_pedido || '',
        arrivalDate:   p.previsao_entrega || null,
        _origem:       'nf',
        _pedidoNum:    p.numero,
        _nfNumeros:    (p.notas_fiscais||[]).map(n=>n.numero).join(', '),
        _status:       p.status,
      }))
    )
  }, [sbPedidos])

  // Merged view: fromRequest history + carteira (não faturada) + faturados do Supabase
  const filteredHistory = useMemo(() => {
    const q = normStr(histSearch)
    const faturadoNums = new Set(sbPedidos.map(p => `${p.numero}__${p.loja_cnpj}`))
    const solics = (purchaseHistory||[])
      .filter(h => h.fromRequest)
      .map(h => ({ ...h, _origem: 'solicitacao' }))
    const carteiraOrders = (orders||[])
      .filter(o => o.source === 'carteira' && !faturadoNums.has(`${o.pedidoParceiro}__${o.cityGroup === 'BELTRAO' ? '35369505000102' : '35369505000374'}`))
      .map(o => ({ ...o, _origem: 'carteira' }))
    let list = [...solics, ...carteiraOrders, ...sbItems]
    if (q) list = list.filter(h =>
      normStr(h.code).includes(q) || normStr(h.description).includes(q) || normStr(h.cityGroup).includes(q)
    )
    return list.sort((a, b) => (b.date||'').localeCompare(a.date||''))
  }, [purchaseHistory, orders, sbItems, sbPedidos, histSearch])

  const byMonth = useMemo(() => {
    const m = new Map()
    const faturadoNumsSet = new Set(sbPedidos.map(p => `${p.numero}__${p.loja_cnpj}`))
    const cnpjOf = city => city === 'BELTRAO' ? '35369505000102' : '35369505000374'
    const allEntries = [
      ...(purchaseHistory||[]).filter(h => h.fromRequest),
      // Carteira não faturada — exclui os que já entraram via sbItems para evitar dupla contagem
      ...(orders||[]).filter(o =>
        o.source === 'carteira' &&
        !faturadoNumsSet.has(`${o.pedidoParceiro}__${cnpjOf(o.cityGroup)}`)
      ),
      ...sbItems,
    ]
    allEntries.forEach(h => {
      const key = (h.arrivalDate || h.date || '').slice(0,7)
      if (!key) return
      if (!m.has(key)) m.set(key,{total:0,count:0})
      const e = m.get(key)
      e.total += (h.qty||0)*(h.pv||0)
      e.count += 1
    })
    return [...m.entries()].sort((a,b)=>b[0].localeCompare(a[0])).slice(0,12)
  },[purchaseHistory, orders, sbItems, sbPedidos])

  return (
    <div className="financial-tab">
      <div className="page-header">
        <div>
          <h2 className="page-title">Financeiro</h2>
          <p className="page-subtitle">Solicitações aprovadas e pedidos da Carteira</p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          {caps?.canEdit && manualCount > 0 && (
            <button className="btn btn-ghost btn-sm" style={{color:'var(--danger)',borderColor:'var(--danger)'}}
              onClick={()=>setConfirmLimpar(true)}>
              🗑 Limpar Manuais ({manualCount})
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={loadSbPedidos} title="Recarregar NFs">🔄</button>
          <button className="btn btn-yellow" onClick={()=>setShowAdd(true)}>+ Registrar Compra</button>
        </div>
      </div>

      {byMonth.length>0&&(
        <div className="fin-grid">
          {byMonth.map(([month,data])=>(
            <div key={month} className="fin-card">
              <div className="fin-month">{month}</div>
              <div className="fin-value">{fmtBRL(data.total)}</div>
              <div className="fin-count">{data.count} registro(s)</div>
            </div>
          ))}
        </div>
      )}

      <div style={{margin:'0 0 12px',display:'flex',gap:8,alignItems:'center'}}>
        <input className="filter-search" type="text" placeholder="Buscar código, descrição ou cidade..."
          value={histSearch} onChange={e=>setHistSearch(e.target.value)} style={{flex:1,maxWidth:380}}/>
        {histSearch&&<button className="btn btn-ghost btn-sm" onClick={()=>setHistSearch('')}>✕ Limpar</button>}
        <span style={{fontSize:12,color:'var(--muted)'}}>{filteredHistory.length} registro{filteredHistory.length!==1?'s':''}</span>
      </div>

      <div className="table-scroll">
        <table className="product-table">
          <thead><tr>
            <th>Código</th><th>Descrição</th><th>Cidade</th>
            <th className="num">Qtd</th><th className="num">PV</th><th className="num">Total</th>
            <th>Data</th><th>Previsão</th><th>Origem</th>
            {caps?.canEdit&&<th style={{width:80}}>Ações</th>}
          </tr></thead>
          <tbody>
            {filteredHistory.map((h,idx)=>(
              <tr key={h.id} style={{background:idx%2===0?'var(--card)':'var(--surface)'}}>
                <td className="mono">{h.code}</td>
                <td className="col-desc" title={h.description}>{h.description}</td>
                <td>{h.cityGroup}</td>
                <td className="num">{h.qty}</td>
                <td className="num">{h.pv>0?fmtBRL(h.pv):'—'}</td>
                <td className="num"><strong>{h.pv>0?fmtBRL((h.qty||0)*(h.pv||0)):'—'}</strong></td>
                <td>{fmtDate(h.date)}</td>
                <td style={{whiteSpace:'nowrap',fontSize:11,color:'var(--info)'}}>
                  {h.arrivalDate ? fmtDate(h.arrivalDate) : <span style={{color:'var(--muted)'}}>—</span>}
                </td>
                <td>
                  {h._origem === 'carteira'
                    ? <span style={{fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:3,background:'var(--success-bg)',color:'var(--success)'}}>Carteira</span>
                    : h._origem === 'nf'
                    ? <span style={{fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:3,background:'var(--warning-bg)',color:'var(--warning)'}}
                        title={h._nfNumeros ? `NF: ${h._nfNumeros}` : `Pedido: ${h._pedidoNum}`}>
                        {h._nfNumeros ? `NF ${h._nfNumeros}` : `Ped. ${h._pedidoNum}`}
                      </span>
                    : <span style={{fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:3,background:'var(--info-bg)',color:'var(--info)'}}>Solicitação</span>
                  }
                </td>
                {caps?.canEdit&&(
                  <td style={{whiteSpace:'nowrap'}}>
                    {h._origem !== 'carteira' && h._origem !== 'nf' && (
                      <>
                        <button className="btn btn-sm btn-secondary" style={{marginRight:4}}
                          onClick={()=>setEditItem({...h})}>✏️</button>
                        <button className="btn btn-sm" style={{background:'var(--danger-bg)',color:'var(--danger)'}}
                          onClick={()=>setDeleteId(h.id)}>🗑️</button>
                      </>
                    )}
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

      {confirmLimpar&&(
        <ConfirmModal
          title="Limpar pedidos manuais"
          message={`Remover ${manualCount} pedido(s) inserido(s) manualmente? Solicitações aprovadas e itens da Carteira serão mantidos.`}
          confirmLabel="Limpar"
          confirmClass="btn-danger"
          onConfirm={doLimparManuais}
          onCancel={()=>setConfirmLimpar(false)}/>
      )}
    </div>
  )
}

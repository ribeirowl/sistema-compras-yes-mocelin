import { useState, useEffect } from 'react'
import { LOJAS, toCents, fromCents, fmtCents, lojaNome } from '../constants.js'
import { dbLoadPedidos, dbSavePedido, dbDeletePedido } from '../supabase.js'

const STATUS_PEDIDO = {
  aguardando:   { label:'Aguardando',    color:'var(--warning)',  bg:'var(--warning-bg)' },
  parcial:      { label:'Parcial',       color:'var(--purple)',   bg:'var(--purple-bg)' },
  faturado:     { label:'Faturado',      color:'var(--info)',     bg:'var(--info-bg)' },
  em_transito:  { label:'Em Trânsito',   color:'var(--info)',     bg:'var(--info-bg)' },
  entregue:     { label:'Entregue',      color:'var(--success)',  bg:'var(--success-bg)' },
  cancelado:    { label:'Cancelado',     color:'var(--danger)',   bg:'var(--danger-bg)' },
}
const badgePedido = s => {
  const cfg = STATUS_PEDIDO[s] || { label:s, color:'var(--muted)', bg:'var(--card2)' }
  return <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:4,background:cfg.bg,color:cfg.color}}>{cfg.label}</span>
}
const ITEM0 = { codigo:'', descricao:'', quantidade:'1', valor_unit:'' }
const FORM0_PEDIDO = { numero:'', data_pedido:new Date().toISOString().slice(0,10), loja_cnpj:'35369505000102', fornecedor:'', fornecedor_cnpj:'', previsao_entrega:'', observacoes:'', status:'aguardando' }

export default function ComprasTab({ userName }) {
  const [pedidos,    setPedidos]   = useState([])
  const [loading,    setLoading]   = useState(false)
  const [lojaFilt,   setLojaFilt]  = useState('')
  const [statusFilt, setStatusFilt]= useState('')
  const [detail,     setDetail]    = useState(null)
  const [showForm,   setShowForm]  = useState(false)
  const [editId,     setEditId]    = useState(null)
  const [form,       setForm]      = useState(FORM0_PEDIDO)
  const [itens,      setItens]     = useState([{...ITEM0}])
  const [saving,     setSaving]    = useState(false)
  const [error,      setError]     = useState(null)

  const load = async () => {
    setLoading(true); setError(null)
    try { setPedidos(await dbLoadPedidos(lojaFilt)) }
    catch(e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [lojaFilt])

  const openNew = () => {
    setEditId(null); setForm({...FORM0_PEDIDO, created_by: userName||''}); setItens([{...ITEM0}]); setShowForm(true); setError(null)
  }
  const openEdit = p => {
    setEditId(p.id)
    setForm({ numero:p.numero, data_pedido:p.data_pedido?.slice(0,10)||'', loja_cnpj:p.loja_cnpj,
               fornecedor:p.fornecedor||'', previsao_entrega:p.previsao_entrega?.slice(0,10)||'',
               observacoes:p.observacoes||'', status:p.status||'aguardando', created_by:p.created_by||'' })
    setItens(p.pedido_itens?.length
      ? p.pedido_itens.map(i=>({ codigo:i.codigo||'', descricao:i.descricao||'', quantidade:String(i.quantidade||1), valor_unit:String(fromCents(i.valor_unit_centavos)||'') }))
      : [{...ITEM0}])
    setShowForm(true); setError(null)
  }
  const closeForm = () => { setShowForm(false); setEditId(null) }

  const addItem = () => setItens(p=>[...p,{...ITEM0}])
  const setItem = (i,k,v) => setItens(p=>p.map((it,idx)=>idx===i?{...it,[k]:v}:it))
  const removeItem = i => setItens(p=>p.filter((_,idx)=>idx!==i))

  const save = async () => {
    setSaving(true); setError(null)
    try {
      await dbSavePedido({...form}, itens, editId)
      closeForm(); load()
    } catch(e) { setError(e.message) }
    finally { setSaving(false) }
  }
  const deletePedido = async id => {
    if (!confirm('Excluir pedido?')) return
    await dbDeletePedido(id); load()
    if (detail?.id===id) setDetail(null)
  }

  const visivel = pedidos.filter(p => !statusFilt || p.status===statusFilt)
  const fmtDate = d => d ? new Date(d+'T00:00:00').toLocaleDateString('pt-BR') : '—'

  const totalLinha = it => {
    const q = parseFloat(it.quantidade)||0
    const v = parseFloat(String(it.valor_unit||'').replace(',','.'))||0
    return q*v
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div className="page-header" style={{marginBottom:0}}>
        <div>
          <h2 className="page-title">🛒 Pedidos de Compra</h2>
          <p className="page-subtitle">{visivel.length} pedido(s)</p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <select className="filter-input" value={lojaFilt} onChange={e=>setLojaFilt(e.target.value)}>
            <option value=''>Todas as lojas</option>
            {LOJAS.map(l=><option key={l.id} value={l.cnpjRaw}>{l.nome}</option>)}
          </select>
          <select className="filter-input" value={statusFilt} onChange={e=>setStatusFilt(e.target.value)}>
            <option value=''>Todos os status</option>
            {Object.entries(STATUS_PEDIDO).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
          </select>
          <button className="btn btn-yellow btn-sm" onClick={openNew}>+ Novo Pedido</button>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {showForm && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
          <div style={{background:'var(--surface)',borderRadius:12,border:'1px solid var(--border)',width:'100%',maxWidth:780,maxHeight:'90vh',overflowY:'auto',padding:24,display:'flex',flexDirection:'column',gap:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <h3 style={{margin:0,fontSize:16}}>{editId?'Editar Pedido':'Novo Pedido de Compra'}</h3>
              <button className="btn btn-sm btn-ghost" onClick={closeForm}>✕</button>
            </div>
            {error && <div className="alert alert-danger" style={{margin:0}}>{error}</div>}

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
              <div>
                <label style={{fontSize:11,color:'var(--muted)',display:'block',marginBottom:4}}>NÚMERO DO PEDIDO *</label>
                <input className="login-input" value={form.numero} onChange={e=>setForm(p=>({...p,numero:e.target.value}))} placeholder="Ex: 01846829"/>
              </div>
              <div>
                <label style={{fontSize:11,color:'var(--muted)',display:'block',marginBottom:4}}>DATA DO PEDIDO</label>
                <input type="date" className="login-input" value={form.data_pedido} onChange={e=>setForm(p=>({...p,data_pedido:e.target.value}))}/>
              </div>
              <div>
                <label style={{fontSize:11,color:'var(--muted)',display:'block',marginBottom:4}}>LOJA *</label>
                <select className="login-input" value={form.loja_cnpj} onChange={e=>setForm(p=>({...p,loja_cnpj:e.target.value}))}>
                  {LOJAS.map(l=><option key={l.id} value={l.cnpjRaw}>{l.nome}</option>)}
                </select>
              </div>
              <div>
                <label style={{fontSize:11,color:'var(--muted)',display:'block',marginBottom:4}}>FORNECEDOR</label>
                <input className="login-input" value={form.fornecedor} onChange={e=>setForm(p=>({...p,fornecedor:e.target.value}))} placeholder="Intelbras, etc."/>
              </div>
              <div>
                <label style={{fontSize:11,color:'var(--muted)',display:'block',marginBottom:4}}>CNPJ FORNECEDOR</label>
                <input className="login-input" value={form.fornecedor_cnpj||''} onChange={e=>setForm(p=>({...p,fornecedor_cnpj:e.target.value}))} placeholder="00.000.000/0000-00"/>
              </div>
              <div>
                <label style={{fontSize:11,color:'var(--muted)',display:'block',marginBottom:4}}>PREVISÃO DE ENTREGA</label>
                <input type="date" className="login-input" value={form.previsao_entrega} onChange={e=>setForm(p=>({...p,previsao_entrega:e.target.value}))}/>
              </div>
              <div>
                <label style={{fontSize:11,color:'var(--muted)',display:'block',marginBottom:4}}>STATUS</label>
                <select className="login-input" value={form.status} onChange={e=>setForm(p=>({...p,status:e.target.value}))}>
                  {Object.entries(STATUS_PEDIDO).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label style={{fontSize:11,color:'var(--muted)',display:'block',marginBottom:4}}>OBSERVAÇÕES</label>
              <input className="login-input" value={form.observacoes} onChange={e=>setForm(p=>({...p,observacoes:e.target.value}))} placeholder="Condição de pagamento, etc."/>
            </div>

            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <label style={{fontSize:12,fontWeight:700}}>Itens do Pedido</label>
                <button className="btn btn-sm btn-ghost" onClick={addItem}>+ Linha</button>
              </div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead>
                  <tr style={{borderBottom:'1px solid var(--border)'}}>
                    {['Código','Descrição *','Qtd','Valor Unit. (R$)','Total',''].map(h=>(
                      <th key={h} style={{padding:'4px 6px',textAlign:h==='Total'||h==='Qtd'?'right':'left',color:'var(--muted)',fontWeight:600,fontSize:11}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {itens.map((it,i)=>(
                    <tr key={i}>
                      <td style={{padding:'4px 4px'}}><input className="login-input" style={{padding:'4px 6px',width:90}} value={it.codigo} onChange={e=>setItem(i,'codigo',e.target.value)} placeholder="Código"/></td>
                      <td style={{padding:'4px 4px'}}><input className="login-input" style={{padding:'4px 6px',width:'100%'}} value={it.descricao} onChange={e=>setItem(i,'descricao',e.target.value)} placeholder="Descrição do produto"/></td>
                      <td style={{padding:'4px 4px'}}><input className="login-input" style={{padding:'4px 6px',width:56,textAlign:'right'}} value={it.quantidade} onChange={e=>setItem(i,'quantidade',e.target.value)}/></td>
                      <td style={{padding:'4px 4px'}}><input className="login-input" style={{padding:'4px 6px',width:90,textAlign:'right'}} value={it.valor_unit} onChange={e=>setItem(i,'valor_unit',e.target.value)} placeholder="0,00"/></td>
                      <td style={{padding:'4px 8px',textAlign:'right',whiteSpace:'nowrap'}}>{fmtCents(toCents(totalLinha(it)))}</td>
                      <td style={{padding:'4px 4px'}}>{itens.length>1&&<button className="btn btn-sm btn-ghost" style={{padding:'2px 6px',color:'var(--danger)'}} onClick={()=>removeItem(i)}>✕</button>}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} style={{padding:'8px 8px',textAlign:'right',fontSize:12,fontWeight:700,color:'var(--muted)'}}>TOTAL DO PEDIDO</td>
                    <td style={{padding:'8px 8px',textAlign:'right',fontWeight:800,fontSize:14,color:'var(--accent)'}}>{fmtCents(toCents(itens.reduce((s,it)=>s+totalLinha(it),0)))}</td>
                    <td/>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div style={{display:'flex',gap:8,justifyContent:'flex-end',paddingTop:8,borderTop:'1px solid var(--border)'}}>
              <button className="btn btn-ghost" onClick={closeForm}>Cancelar</button>
              <button className="btn btn-yellow" disabled={saving} onClick={save}>{saving?'Salvando...':'Salvar Pedido'}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{display:'flex',gap:12,minHeight:400}}>
        <div style={{flex:1,overflowX:'auto'}}>
          {loading ? <div style={{padding:32,textAlign:'center',color:'var(--muted)'}}>Carregando...</div> : (
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr style={{borderBottom:'2px solid var(--border)'}}>
                  {['Número','Data','Loja','Fornecedor','Itens','Total','Status','Previsão',''].map(h=>(
                    <th key={h} style={{padding:'8px 10px',textAlign:'left',fontSize:11,color:'var(--muted)',fontWeight:700,whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visivel.length===0 && <tr><td colSpan={9} style={{padding:32,textAlign:'center',color:'var(--muted)'}}>Nenhum pedido encontrado.</td></tr>}
                {visivel.map(p=>{
                  const totalCents = p.pedido_itens?.reduce((s,i)=>s+fromCents(i.valor_unit_centavos)*(i.quantidade||0),0)||0
                  const isSelected = detail?.id===p.id
                  return (
                    <tr key={p.id} onClick={()=>setDetail(isSelected?null:p)}
                      style={{borderBottom:'1px solid var(--border)',cursor:'pointer',
                        background:isSelected?'var(--card2)':'transparent',transition:'background .1s'}}>
                      <td style={{padding:'8px 10px',fontWeight:700,color:'var(--accent)'}}>{p.numero}</td>
                      <td style={{padding:'8px 10px',whiteSpace:'nowrap'}}>{fmtDate(p.data_pedido)}</td>
                      <td style={{padding:'8px 10px',whiteSpace:'nowrap'}}>{lojaNome(p.loja_cnpj)}</td>
                      <td style={{padding:'8px 10px'}}>{p.fornecedor||'—'}</td>
                      <td style={{padding:'8px 10px',textAlign:'center'}}>{p.pedido_itens?.length||0}</td>
                      <td style={{padding:'8px 10px',whiteSpace:'nowrap'}}>{totalCents>0?fmtCents(toCents(totalCents)):'—'}</td>
                      <td style={{padding:'8px 10px'}}>{badgePedido(p.status)}</td>
                      <td style={{padding:'8px 10px',whiteSpace:'nowrap'}}>{fmtDate(p.previsao_entrega)}</td>
                      <td style={{padding:'8px 10px'}}>
                        <div style={{display:'flex',gap:4}}>
                          <button className="btn btn-sm btn-ghost" onClick={e=>{e.stopPropagation();openEdit(p)}} title="Editar">✏️</button>
                          <button className="btn btn-sm btn-ghost" style={{color:'var(--danger)'}} onClick={e=>{e.stopPropagation();deletePedido(p.id)}} title="Excluir">🗑</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {detail && (
          <div style={{width:360,flexShrink:0,background:'var(--card)',border:'1px solid var(--border)',borderRadius:8,padding:16,overflowY:'auto',maxHeight:600}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <span style={{fontWeight:700,fontSize:14}}>Pedido {detail.numero}</span>
              <button className="btn btn-sm btn-ghost" onClick={()=>setDetail(null)}>✕</button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:6,fontSize:12,marginBottom:12}}>
              <div><span style={{color:'var(--muted)'}}>Loja: </span><strong>{lojaNome(detail.loja_cnpj)}</strong></div>
              <div><span style={{color:'var(--muted)'}}>Fornecedor: </span><strong>{detail.fornecedor||'—'}</strong></div>
              <div><span style={{color:'var(--muted)'}}>Data: </span>{fmtDate(detail.data_pedido)}</div>
              <div><span style={{color:'var(--muted)'}}>Previsão: </span>{fmtDate(detail.previsao_entrega)}</div>
              <div><span style={{color:'var(--muted)'}}>Status: </span>{badgePedido(detail.status)}</div>
              {detail.observacoes&&<div style={{color:'var(--muted)',fontStyle:'italic'}}>{detail.observacoes}</div>}
            </div>
            <div style={{fontSize:12,fontWeight:700,marginBottom:6,borderTop:'1px solid var(--border)',paddingTop:10}}>Itens</div>
            {(detail.pedido_itens||[]).map((it,i)=>(
              <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid var(--border)',fontSize:12}}>
                <div>
                  {it.codigo&&<span style={{fontFamily:'monospace',color:'var(--muted)',marginRight:6}}>{it.codigo}</span>}
                  {it.descricao}
                </div>
                <div style={{textAlign:'right',flexShrink:0,marginLeft:8}}>
                  <div>{it.quantidade}×{fmtCents(it.valor_unit_centavos)}</div>
                  <div style={{fontWeight:700}}>{fmtCents(toCents(fromCents(it.valor_unit_centavos)*(it.quantidade||0)))}</div>
                </div>
              </div>
            ))}
            {detail.notas_fiscais?.length>0 && (
              <>
                <div style={{fontSize:12,fontWeight:700,marginBottom:6,borderTop:'1px solid var(--border)',paddingTop:10}}>Nota Fiscal Vinculada</div>
                {detail.notas_fiscais.map(nf=>(
                  <div key={nf.id} style={{fontSize:12,background:'var(--success-bg)',borderRadius:6,padding:'8px 10px'}}>
                    <div style={{fontWeight:700,color:'var(--success)'}}>NF {nf.numero} — {fmtCents(nf.valor_total_centavos)}</div>
                    <div style={{color:'var(--muted)'}}>{fmtDate(nf.data_emissao)}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

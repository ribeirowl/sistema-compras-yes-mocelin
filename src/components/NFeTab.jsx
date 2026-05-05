import { useState, useEffect } from 'react'
import { sb, dbLoadNotas, dbLoadPedidos, dbVincularManual } from '../supabase.js'
import { loadSupabasePedidosForStatus, detectarUF, calcPrevisaoChegada, executarMotorVinculo } from '../nf-logic.js'
import { LOJAS, lojaNome, fmtCents } from '../constants.js'
import { fmtDate } from '../utils.js'

const STATUS_VINCULO = {
  pendente:   { label:'Pendente',   color:'var(--warning)', bg:'var(--warning-bg)' },
  sugerido:   { label:'Sugerido',   color:'var(--info)',    bg:'var(--info-bg)'    },
  vinculado:  { label:'Vinculado',  color:'var(--success)', bg:'var(--success-bg)' },
  sem_pedido: { label:'Sem pedido', color:'var(--danger)',  bg:'var(--danger-bg)'  },
}
const badgeVinculo = s => {
  const cfg = STATUS_VINCULO[s] || { label:s||'—', color:'var(--muted)', bg:'var(--card2)' }
  return <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:4,background:cfg.bg,color:cfg.color}}>{cfg.label}</span>
}

export default function NFeTab() {
  const [notas,      setNotas]     = useState([])
  const [pedidos,    setPedidos]   = useState([])
  const [loading,    setLoading]   = useState(false)
  const [lojaFilt,   setLojaFilt]  = useState('')
  const [vincFilt,   setVincFilt]  = useState('')
  const [detail,     setDetail]    = useState(null)
  const [linkId,     setLinkId]    = useState(null)
  const [linkSearch, setLinkSearch]= useState('')
  const [error,      setError]     = useState(null)
  const [motor,      setMotor]     = useState(null)

  const localFmtDate = d => d ? new Date(d+'T00:00:00').toLocaleDateString('pt-BR') : '—'

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const [n, p] = await Promise.all([
        dbLoadNotas(lojaFilt, vincFilt),
        dbLoadPedidos(''),
      ])
      setNotas(n); setPedidos(p)
    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [lojaFilt, vincFilt])

  const vincularManual = async (nfId, pedidoId) => {
    await dbVincularManual(nfId, pedidoId)
    setLinkId(null); setLinkSearch(''); load()
    loadSupabasePedidosForStatus().catch(()=>{})
  }

  const confirmarVinculo = async (nfId, pedidoId) => {
    const nfData = notas.find(n=>n.id===nfId)
    const previsao = nfData ? calcPrevisaoChegada(nfData.data_emissao, detectarUF(nfData.emit_cnpj, nfData.emit_uf)) : null
    await sb.from('notas_fiscais').update({ status_vinculo:'vinculado', acao_necessaria:'', previsao_chegada: previsao }).eq('id',nfId)
    if (pedidoId) await sb.from('pedidos').update({ status:'faturado', previsao_entrega: previsao, updated_at:new Date().toISOString() }).eq('id',pedidoId)
    await sb.from('vinculo_log').insert({ nf_id:nfId, pedido_id:pedidoId, evento:'confirmado', detalhe:'Confirmado pelo usuário' })
    loadSupabasePedidosForStatus().catch(()=>{})
    load()
  }

  const rejeitarVinculo = async (nfId) => {
    await sb.from('notas_fiscais').update({ status_vinculo:'sem_pedido', pedido_id:null, score_confianca:0, acao_necessaria:'revisão manual' }).eq('id',nfId)
    await sb.from('vinculo_log').insert({ nf_id:nfId, evento:'rejeitado', detalhe:'Sugestão rejeitada pelo usuário' })
    load()
  }

  const [confirmandoTodos, setConfirmandoTodos] = useState(false)
  const confirmarTodos = async () => {
    const sugeridas = notas.filter(n => n.status_vinculo === 'sugerido' && n.pedido_id)
    if (!sugeridas.length) return
    setConfirmandoTodos(true)
    try {
      for (const nf of sugeridas) {
        const previsao = calcPrevisaoChegada(nf.data_emissao, detectarUF(nf.emit_cnpj, nf.emit_uf))
        await sb.from('notas_fiscais').update({ status_vinculo:'vinculado', acao_necessaria:'', previsao_chegada: previsao }).eq('id', nf.id)
        if (nf.pedido_id) await sb.from('pedidos').update({ status:'faturado', previsao_entrega: previsao, updated_at: new Date().toISOString() }).eq('id', nf.pedido_id)
        await sb.from('vinculo_log').insert({ nf_id: nf.id, pedido_id: nf.pedido_id, evento:'confirmado', detalhe:'Confirmado em lote pelo usuário' })
      }
      load()
      loadSupabasePedidosForStatus().catch(()=>{})
    } finally {
      setConfirmandoTodos(false)
    }
  }

  const rodarMotor = async (retry=false, tudo=false) => {
    setMotor({ running:true, prog:0, total:0, current:'', resultados:[] })
    try {
      const res = await executarMotorVinculo((prog, total, cur) =>
        setMotor(p => ({ ...p, prog, total, current:cur })), retry, tudo
      )
      setMotor({ running:false, prog:res.length, total:res.length, current:'', resultados:res })
      load()
      loadSupabasePedidosForStatus().catch(()=>{})
    } catch(e) {
      setMotor(p => ({ ...p, running:false, current:'Erro: '+e.message }))
    }
  }

  const pedidosParaVinculo = pedidos.filter(p => {
    const q = linkSearch.toLowerCase()
    return !q || p.numero.toLowerCase().includes(q) || (p.fornecedor||'').toLowerCase().includes(q)
  })

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div className="page-header" style={{marginBottom:0}}>
        <div>
          <h2 className="page-title">📋 Notas Fiscais</h2>
          <p className="page-subtitle">{notas.length} nota(s)</p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <select className="filter-input" value={lojaFilt} onChange={e=>setLojaFilt(e.target.value)}>
            <option value=''>Todas as lojas</option>
            {LOJAS.map(l=><option key={l.id} value={l.cnpjRaw}>{l.nome}</option>)}
          </select>
          <select className="filter-input" value={vincFilt} onChange={e=>setVincFilt(e.target.value)}>
            <option value=''>Todos os vínculos</option>
            {Object.entries(STATUS_VINCULO).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
          </select>
          <button className="btn btn-sm btn-ghost" onClick={load} title="Recarregar">🔄</button>
          <button className="btn btn-sm btn-yellow" disabled={motor?.running} onClick={()=>rodarMotor(false)} title="Processa apenas NF-e novas (pendente)">
            {motor?.running ? `⚙️ ${motor.prog}/${motor.total}` : '⚙️ Motor de Vínculo'}
          </button>
          <button className="btn btn-sm btn-ghost" disabled={motor?.running} onClick={()=>rodarMotor(true)} title="Re-tenta NF-e sem pedido também">
            ↩ Retry
          </button>
          <button className="btn btn-sm btn-ghost" disabled={motor?.running} onClick={()=>rodarMotor(false,true)} title="Reprocessa todas as NF-e inclusive já vinculadas/sugeridas">
            ↺ Tudo
          </button>
          {notas.some(n=>n.status_vinculo==='sugerido')&&(
            <button className="btn btn-sm btn-ghost" disabled={confirmandoTodos} onClick={confirmarTodos}
              style={{color:'var(--success)',border:'1px solid var(--success)'}}
              title="Confirma todos os vínculos sugeridos de uma vez">
              {confirmandoTodos ? '⏳ Confirmando...' : `✓ Aceitar todos (${notas.filter(n=>n.status_vinculo==='sugerido').length})`}
            </button>
          )}
        </div>
      </div>

      {motor && (
        <div style={{background:motor.running?'var(--info-bg)':'var(--success-bg)',
                     border:`1px solid ${motor.running?'var(--info)':'var(--success)'}`,
                     borderRadius:'var(--r)',padding:'10px 16px',display:'flex',flexDirection:'column',gap:6}}>
          {motor.running ? (
            <>
              <div style={{fontSize:13,fontWeight:700,color:'var(--info)'}}>
                ⚙️ Processando {motor.prog}/{motor.total} — {motor.current}
              </div>
              <div style={{height:4,background:'var(--border)',borderRadius:2,overflow:'hidden'}}>
                <div style={{height:'100%',background:'var(--info)',width:`${motor.total?motor.prog/motor.total*100:0}%`,transition:'width .3s'}}/>
              </div>
            </>
          ) : (
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontWeight:700,fontSize:13,color:'var(--success)'}}>
                ✅ Motor concluído — {motor.resultados?.length||0} notas processadas
                {' · '}{motor.resultados?.filter(r=>r.status==='vinculado').length||0} vinculadas
                {' · '}{motor.resultados?.filter(r=>r.status==='sugerido').length||0} aguardando confirmação
              </span>
              <button className="btn btn-sm btn-ghost" onClick={()=>setMotor(null)}>✕</button>
            </div>
          )}
        </div>
      )}

      {error && <div className="alert alert-danger">{error}</div>}

      {linkId && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
          <div style={{background:'var(--surface)',borderRadius:12,border:'1px solid var(--border)',width:'100%',maxWidth:480,padding:24}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:12}}>
              <h3 style={{margin:0,fontSize:15}}>Vincular NF manualmente</h3>
              <button className="btn btn-sm btn-ghost" onClick={()=>setLinkId(null)}>✕</button>
            </div>
            <input className="login-input" style={{marginBottom:10}} placeholder="Buscar pedido por número ou fornecedor…" value={linkSearch} onChange={e=>setLinkSearch(e.target.value)} autoFocus/>
            <div style={{maxHeight:260,overflowY:'auto',display:'flex',flexDirection:'column',gap:4}}>
              {pedidosParaVinculo.slice(0,30).map(p=>(
                <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 10px',background:'var(--card)',borderRadius:6,border:'1px solid var(--border)'}}>
                  <div style={{fontSize:13}}>
                    <strong style={{color:'var(--accent)'}}>{p.numero}</strong>
                    <span style={{color:'var(--muted)',marginLeft:8}}>{p.fornecedor||'—'}</span>
                    <span style={{color:'var(--muted2)',marginLeft:8,fontSize:11}}>{lojaNome(p.loja_cnpj)}</span>
                  </div>
                  <button className="btn btn-sm btn-yellow" onClick={()=>vincularManual(linkId,p.id)}>Vincular</button>
                </div>
              ))}
              {pedidosParaVinculo.length===0&&<div style={{color:'var(--muted)',textAlign:'center',padding:16}}>Nenhum pedido encontrado.</div>}
            </div>
          </div>
        </div>
      )}

      <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
        <div style={{flex:1,overflowX:'auto',minWidth:0}}>
          {loading ? <div style={{padding:32,textAlign:'center',color:'var(--muted)'}}>Carregando...</div> : (
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,minWidth:780}}>
              <thead>
                <tr style={{borderBottom:'2px solid var(--border)'}}>
                  {['NF / Série','Data','Emitente','Loja','Valor Total','Score','Prev. Chegada','Vínculo',''].map(h=>(
                    <th key={h} style={{padding:'8px 10px',textAlign:'left',fontSize:11,color:'var(--muted)',fontWeight:700,whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {notas.length===0&&<tr><td colSpan={9} style={{padding:32,textAlign:'center',color:'var(--muted)'}}>Nenhuma nota fiscal encontrada.</td></tr>}
                {notas.map(nf=>{
                  const isSelected = detail?.id===nf.id
                  return (
                    <tr key={nf.id} onClick={()=>setDetail(isSelected?null:nf)}
                      style={{borderBottom:'1px solid var(--border)',cursor:'pointer',background:isSelected?'var(--card2)':'transparent'}}>
                      <td style={{padding:'8px 10px',fontWeight:700,color:'var(--accent)',whiteSpace:'nowrap'}}>{nf.numero}{nf.serie?`/${nf.serie}`:''}</td>
                      <td style={{padding:'8px 10px',whiteSpace:'nowrap'}}>{localFmtDate(nf.data_emissao)}</td>
                      <td style={{padding:'8px 10px',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{nf.emit_nome||'—'}</td>
                      <td style={{padding:'8px 10px',whiteSpace:'nowrap'}}>{lojaNome(nf.loja_cnpj)}</td>
                      <td style={{padding:'8px 10px',fontWeight:700,whiteSpace:'nowrap'}}>{fmtCents(nf.valor_total_centavos)}</td>
                      <td style={{padding:'8px 10px',whiteSpace:'nowrap'}}>
                        {nf.score_confianca>0
                          ? <span style={{background:(nf.score_confianca>=80?'var(--success)':nf.score_confianca>=50?'var(--info)':'var(--muted)')+'22',color:nf.score_confianca>=80?'var(--success)':nf.score_confianca>=50?'var(--info)':'var(--muted)',borderRadius:4,padding:'2px 6px',fontWeight:700,fontSize:12}}>{nf.score_confianca}</span>
                          : '—'}
                      </td>
                      <td style={{padding:'8px 10px',whiteSpace:'nowrap'}}>{nf.previsao_chegada?localFmtDate(nf.previsao_chegada):'—'}</td>
                      <td style={{padding:'8px 10px'}}>{badgeVinculo(nf.status_vinculo)}</td>
                      <td style={{padding:'8px 10px',whiteSpace:'nowrap'}}>
                        {nf.status_vinculo==='sugerido'&&(
                          <>
                            <button className="btn btn-sm btn-ghost" onClick={e=>{e.stopPropagation();confirmarVinculo(nf.id,nf.pedido_id)}} title="Confirmar vínculo sugerido" style={{color:'var(--success)',marginRight:4}}>✓</button>
                            <button className="btn btn-sm btn-ghost" onClick={e=>{e.stopPropagation();rejeitarVinculo(nf.id)}} title="Rejeitar sugestão" style={{color:'var(--danger)',marginRight:4}}>✗</button>
                          </>
                        )}
                        {nf.status_vinculo!=='vinculado'&&(
                          <button className="btn btn-sm btn-ghost" onClick={e=>{e.stopPropagation();setLinkId(nf.id);setLinkSearch('')}} title="Vincular manualmente a pedido">🔗</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {detail && (
          <div style={{width:380,flexShrink:0,background:'var(--card)',border:'1px solid var(--border)',borderRadius:8,padding:16,overflowY:'auto',maxHeight:'calc(100vh - 180px)',position:'sticky',top:0}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <span style={{fontWeight:700,fontSize:14}}>NF {detail.numero}{detail.serie?`/${detail.serie}`:''}</span>
              <button className="btn btn-sm btn-ghost" onClick={()=>setDetail(null)}>✕</button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:5,fontSize:12,marginBottom:12}}>
              <div><span style={{color:'var(--muted)'}}>Emitente: </span><strong>{detail.emit_nome||'—'}</strong></div>
              {detail.emit_cnpj&&<div style={{color:'var(--muted)',fontSize:11}}>{detail.emit_cnpj}</div>}
              <div><span style={{color:'var(--muted)'}}>Loja: </span><strong>{lojaNome(detail.loja_cnpj)}</strong></div>
              <div><span style={{color:'var(--muted)'}}>Data emissão: </span>{localFmtDate(detail.data_emissao)}</div>
              <div><span style={{color:'var(--muted)'}}>Valor total: </span><strong style={{color:'var(--accent)'}}>{fmtCents(detail.valor_total_centavos)}</strong></div>
              {detail.base_calculo_centavos>0&&<div><span style={{color:'var(--muted)'}}>Base ICMS: </span>{fmtCents(detail.base_calculo_centavos)}</div>}
              {detail.icms_centavos>0&&<div><span style={{color:'var(--muted)'}}>ICMS: </span>{fmtCents(detail.icms_centavos)}</div>}
              {detail.pis_centavos>0&&<div><span style={{color:'var(--muted)'}}>PIS: </span>{fmtCents(detail.pis_centavos)}</div>}
              {detail.cofins_centavos>0&&<div><span style={{color:'var(--muted)'}}>COFINS: </span>{fmtCents(detail.cofins_centavos)}</div>}
              {detail.desconto_centavos>0&&<div><span style={{color:'var(--muted)'}}>Desconto: </span>{fmtCents(detail.desconto_centavos)}</div>}
              {detail.cond_pagamento&&<div><span style={{color:'var(--muted)'}}>Cond. pag.: </span>{detail.cond_pagamento}</div>}
              <div><span style={{color:'var(--muted)'}}>Vínculo: </span>{badgeVinculo(detail.status_vinculo)}</div>
              {detail.score_confianca>0&&<div><span style={{color:'var(--muted)'}}>Score: </span><span style={{color:detail.score_confianca>=80?'var(--success)':detail.score_confianca>=50?'var(--info)':'var(--muted)',fontWeight:700}}>{detail.score_confianca}/100</span></div>}
              {detail.previsao_chegada&&<div><span style={{color:'var(--muted)'}}>Prev. chegada: </span><strong>{localFmtDate(detail.previsao_chegada)}</strong></div>}
              {detail.status_vinculo==='vinculado'&&detail.pedidos&&<div style={{color:'var(--success)',fontSize:12}}>Pedido: {detail.pedidos.numero} — {detail.pedidos.fornecedor}</div>}
              {detail.status_vinculo==='sugerido'&&detail.pedido_id&&(
                <div style={{display:'flex',gap:6,marginTop:4}}>
                  <button className="btn btn-sm" style={{background:'var(--success)',color:'#fff'}} onClick={()=>confirmarVinculo(detail.id,detail.pedido_id)}>✓ Confirmar</button>
                  <button className="btn btn-sm btn-ghost" style={{color:'var(--danger)'}} onClick={()=>rejeitarVinculo(detail.id)}>✗ Rejeitar</button>
                </div>
              )}
              {detail.vinculo_motivo&&<div style={{color:'var(--warning)',fontSize:11,fontStyle:'italic',marginTop:2}}>{detail.vinculo_motivo}</div>}
              {detail.acao_necessaria&&<div style={{color:'var(--danger)',fontSize:11,fontWeight:600,marginTop:2}}>⚠ {detail.acao_necessaria}</div>}
              {detail.chave_acesso&&<div style={{fontSize:10,color:'var(--muted2)',wordBreak:'break-all',marginTop:4}}>Chave: {detail.chave_acesso}</div>}
            </div>

            {detail.nf_itens?.length>0&&(
              <>
                <div style={{fontSize:12,fontWeight:700,marginBottom:6,borderTop:'1px solid var(--border)',paddingTop:10}}>Itens ({detail.nf_itens.length})</div>
                {detail.nf_itens.map((it,i)=>(
                  <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid var(--border)',fontSize:12}}>
                    <div style={{flex:1,minWidth:0}}>
                      {it.codigo&&<span style={{fontFamily:'monospace',fontSize:11,color:'var(--muted)',marginRight:5}}>{it.codigo}</span>}
                      <span style={{wordBreak:'break-word'}}>{it.descricao}</span>
                    </div>
                    <div style={{textAlign:'right',flexShrink:0,marginLeft:8}}>
                      <div style={{color:'var(--muted)'}}>{it.quantidade}×</div>
                      <div style={{fontWeight:700}}>{fmtCents(it.valor_total_centavos)}</div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {detail.nf_pagamentos?.length>0&&(
              <>
                <div style={{fontSize:12,fontWeight:700,marginBottom:6,borderTop:'1px solid var(--border)',paddingTop:10}}>Vencimentos</div>
                {detail.nf_pagamentos.map((p,i)=>(
                  <div key={i} style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'4px 0',borderBottom:'1px solid var(--border)'}}>
                    <span>{p.vencimento?localFmtDate(p.vencimento):'—'}</span>
                    <strong>{fmtCents(p.valor_centavos)}</strong>
                  </div>
                ))}
              </>
            )}

            {detail.status_vinculo!=='vinculado'&&(
              <button className="btn btn-sm btn-yellow" style={{marginTop:12,width:'100%',justifyContent:'center'}}
                onClick={()=>{setLinkId(detail.id);setLinkSearch('')}}>🔗 Vincular a Pedido</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

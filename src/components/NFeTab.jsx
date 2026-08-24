import { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { sb, sbFetchAll, dbLoadNotas, dbLoadPedidos, dbVincularManual } from '../supabase.js'
import { loadSupabasePedidosForStatus, detectarUF, calcPrevisaoChegada, executarMotorVinculo } from '../nf-logic.js'
import { LOJAS, lojaNome, fmtCents, toCents } from '../constants.js'
import { fmtDate } from '../utils.js'

function normH(h) {
  return (h||'').toString().trim().toLowerCase().replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim()
}
function findCol(headers, ...terms) {
  return headers.findIndex(h => terms.some(t => h.includes(t)))
}
function parseXlsxDate(val) {
  if (!val) return null
  if (val instanceof Date) return val.toISOString().slice(0,10)
  if (typeof val === 'number') return new Date((val-25569)*86400000).toISOString().slice(0,10)
  const s = String(val).trim()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) { const y=m[3].length===2?'20'+m[3]:m[3]; return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10)
  return null
}
const CNPJ_LOJA_NF = Object.fromEntries(LOJAS.map(l=>[l.cnpjRaw, l.cnpjRaw]))
function normCnpjStr(v) { return String(v||'').replace(/\D/g,'') }

function parseNFXlsx(file, fallbackLoja) {
  return new Promise((res,rej)=>{
    const fr = new FileReader()
    fr.onload = e => {
      try {
        const wb = XLSX.read(e.target.result,{type:'array',cellDates:true})
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws,{header:1,defval:''})
        if (raw.length < 2) return rej(new Error('Planilha vazia'))
        const headers = raw[0].map(normH)
        const iNF    = findCol(headers,'nota fiscal','nf','numero','nota')
        const iData  = findCol(headers,'data')
        const iOrdem = findCol(headers,'ordem de compra','ordem compra','ordem','pedido')
        const iCod   = findCol(headers,'cod material','c d material','codigo material','codigo')
        const iQtd   = findCol(headers,'quantidade','qtd')
        const iVal   = findCol(headers,'valor faturado','valor')
        // CNPJ destinatário = the store that received the goods
        const iCnpj  = findCol(headers,'cnpj destinat','cnpj comprador','cnpj empresa','cnpj filial','cnpj','destinat','comprador')
        if (iNF<0||iCod<0) throw new Error('Colunas "Nota Fiscal" e "Cód. Material" não encontradas. Use o export padrão da Intelbras.')
        const grouped = {}
        const nfOrder = []
        let cnpjDetected = false
        for (let r=1; r<raw.length; r++) {
          const row = raw[r]
          const nf = String(row[iNF]||'').trim()
          if (!nf) continue
          const cod = String(row[iCod]||'').trim()
          if (!cod) continue

          let lojaCnpj = fallbackLoja || ''
          if (iCnpj >= 0) {
            const detected = normCnpjStr(row[iCnpj])
            if (CNPJ_LOJA_NF[detected]) { lojaCnpj = detected; cnpjDetected = true }
          }
          if (!lojaCnpj)
            throw new Error('CNPJ da loja não detectado na planilha. Selecione a loja manualmente antes de importar.')

          const key = `${nf}__${lojaCnpj}`
          if (!grouped[key]) {
            grouped[key] = {
              numero: nf,
              lojaCnpj,
              data: iData>=0 ? parseXlsxDate(row[iData]) : null,
              ordemCompra: iOrdem>=0 ? String(row[iOrdem]||'').trim() : '',
              itens: [],
            }
            nfOrder.push(key)
          }
          const qtd = parseFloat(String(row[iQtd]||'0').replace(',','.')) || 0
          const val = parseFloat(String(row[iVal]||'0').replace(',','.')) || 0
          grouped[key].itens.push({ codigo:cod, quantidade:qtd, valorFaturado:val })
        }
        res({ grupos: nfOrder.map(k=>grouped[k]), cnpjDetected })
      } catch(err) { rej(err) }
    }
    fr.onerror = () => rej(new Error('Falha ao ler arquivo'))
    fr.readAsArrayBuffer(file)
  })
}

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
  const [importLoja, setImportLoja]= useState('')
  const [importing,  setImporting] = useState(false)
  const [importMsg,  setImportMsg] = useState(null)
  const nfFileRef = useRef(null)

  const doImportNF = async file => {
    setImporting(true); setImportMsg(null)
    try {
      const { grupos, cnpjDetected } = await parseNFXlsx(file, importLoja)
      if (!grupos.length) throw new Error('Nenhuma nota encontrada na planilha.')

      // Load existing NFs across all lojas in file to skip duplicates
      const lojasCnpj = [...new Set(grupos.map(g=>g.lojaCnpj))]
      const numeros   = grupos.map(g=>g.numero)
      const { data: existing } = await sb.from('notas_fiscais')
        .select('id,numero,loja_cnpj')
        .in('loja_cnpj', lojasCnpj)
        .in('numero', numeros)
      const existSet = new Set((existing||[]).map(n=>`${n.numero}__${n.loja_cnpj}`))

      // Load Intelbras pedidos for all lojas to enable direct linking
      const pedidosLoja = await sbFetchAll(() => sb.from('pedidos')
        .select('id,numero,loja_cnpj,status')
        .in('loja_cnpj', lojasCnpj)
        .eq('fornecedor','Intelbras')
        .order('id',{ascending:true}))
      // key: `${numero}__${loja_cnpj}`
      const pedidoMap = new Map((pedidosLoja||[]).map(p=>[`${p.numero}__${p.loja_cnpj}`,p]))

      let inserted=0, skipped=0, linked=0
      for (const g of grupos) {
        const existKey = `${g.numero}__${g.lojaCnpj}`
        if (existSet.has(existKey)) { skipped++; continue }
        const totalCents = g.itens.reduce((s,i)=>s+Math.round(i.valorFaturado*100),0)
        const pedido = g.ordemCompra ? pedidoMap.get(`${g.ordemCompra}__${g.lojaCnpj}`) : null
        const previsao = pedido ? calcPrevisaoChegada(g.data,'SC') : null

        const { data: nfIns, error: e1 } = await sb.from('notas_fiscais').insert({
          numero:               g.numero,
          data_emissao:         g.data,
          emit_nome:            'Intelbras',
          emit_cnpj:            '82901000000127',
          emit_uf:              'SC',
          loja_cnpj:            g.lojaCnpj,
          valor_total_centavos: totalCents,
          status_vinculo:       pedido ? 'vinculado' : 'pendente',
          pedido_id:            pedido?.id || null,
          vinculo_motivo:       pedido ? 'Vínculo direto por Ordem de Compra' : '',
          previsao_chegada:     previsao,
          acao_necessaria:      pedido ? '' : (g.ordemCompra ? `Pedido "${g.ordemCompra}" não encontrado` : 'Sem Ordem de Compra'),
        }).select('id').maybeSingle()
        if (e1) throw e1
        inserted++

        const itensRows = g.itens
          .filter(i=>i.codigo&&i.quantidade>0)
          .map(i=>({ nf_id:nfIns.id, codigo:i.codigo, descricao:'', quantidade:i.quantidade, valor_total_centavos:Math.round(i.valorFaturado*100) }))
        if (itensRows.length) await sb.from('nf_itens').insert(itensRows)

        if (pedido) {
          linked++
          await sb.from('pedidos').update({ status:'faturado', previsao_entrega:previsao, updated_at:new Date().toISOString() }).eq('id',pedido.id)
          await sb.from('vinculo_log').insert({ nf_id:nfIns.id, pedido_id:pedido.id, evento:'vinculado', score_confianca:100, detalhe:'Vínculo automático por Ordem de Compra (import Excel)' })
        }
      }
      const lojaNames = lojasCnpj.map(c=>LOJAS.find(l=>l.cnpjRaw===c)?.nome||c).join(', ')
      setImportMsg({type:'success',text:`✅ ${inserted} NF(s) importada(s) — ${linked} vinculada(s) automaticamente, ${skipped} já existia(m)` + (cnpjDetected?` — loja(s): ${lojaNames}`:'')})
      load()
      loadSupabasePedidosForStatus().catch(()=>{})
    } catch(err) {
      setImportMsg({type:'error',text:'Erro: '+err.message})
    } finally {
      setImporting(false)
      if (nfFileRef.current) nfFileRef.current.value=''
    }
  }

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
          <div style={{display:'flex',gap:4,alignItems:'center',borderRight:'1px solid var(--border)',paddingRight:8,marginRight:4}}>
            <select className="filter-input" value={importLoja} onChange={e=>setImportLoja(e.target.value)} title="Loja manual (caso não detectada automaticamente pelo CNPJ no arquivo)">
              <option value=''>Loja (auto)</option>
              {LOJAS.map(l=><option key={l.id} value={l.cnpjRaw}>{l.nome}</option>)}
            </select>
            <button className="btn btn-sm btn-yellow" onClick={()=>nfFileRef.current?.click()} disabled={importing} title="Importar planilha de NF da Intelbras — loja detectada automaticamente pelo CNPJ">
              {importing?'⏳ Importando...':'📥 Importar NF'}
            </button>
            <input ref={nfFileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}}
              onChange={e=>{if(e.target.files[0])doImportNF(e.target.files[0])}}/>
          </div>
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

      {importMsg && (
        <div style={{
          background:importMsg.type==='success'?'var(--success-bg)':'var(--danger-bg)',
          border:`1px solid ${importMsg.type==='success'?'var(--success)':'var(--danger)'}`,
          borderRadius:'var(--r)',padding:'10px 16px',fontSize:13,
          color:importMsg.type==='success'?'var(--success)':'var(--danger)',
          display:'flex',justifyContent:'space-between',alignItems:'center',
        }}>
          <span>{importMsg.text}</span>
          <button className="btn btn-sm btn-ghost" onClick={()=>setImportMsg(null)}>✕</button>
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

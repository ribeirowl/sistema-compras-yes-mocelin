import { useState, useEffect, useRef, Fragment } from 'react'
import * as XLSX from 'xlsx'
import { sb } from '../supabase.js'
import { LOJAS, lojaNome, fmtCents } from '../constants.js'

function mapSituacao(sit) {
  const s = (sit||'').toLowerCase()
  if (s.includes('faturad') || s.includes('total') || s.includes('encerrad')) return 'faturado'
  if (s.includes('parcial')) return 'parcial'
  if (s.includes('cancel')) return 'cancelado'
  return 'aguardando'
}

function parseXlsxDate(val) {
  if (!val) return null
  if (val instanceof Date) return val.toISOString().slice(0,10)
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400000)
    return d.toISOString().slice(0,10)
  }
  const s = String(val).trim()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    const y = m[3].length===2 ? '20'+m[3] : m[3]
    return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10)
  return null
}

function normH(h) {
  return (h||'').toString().trim().toLowerCase().replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim()
}

function findCol(headers, ...terms) {
  return headers.findIndex(h => terms.some(t => h.includes(t)))
}

function parsePedidosXlsx(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, {type:'array',cellDates:true})
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, {header:1,defval:''})
        if (raw.length < 2) return rej(new Error('Planilha vazia'))
        const headers = raw[0].map(normH)
        const iOrdem = findCol(headers,'ordem de pedido','ordem pedido','ordem')
        const iSit   = findCol(headers,'situa','status')
        const iCod   = findCol(headers,'cod material','c d material','c d. material','material','codigo')
        const iMat   = findCol(headers,'material','descri','produto')
        const iQtd   = findCol(headers,'qtd total','quantidade total','qtd','quantidade')
        const iVal   = findCol(headers,'valor total','valor')
        const iData  = findCol(headers,'data pedido','data','dt pedido')
        if (iOrdem < 0 || iCod < 0)
          throw new Error('Colunas "Ordem de Pedido" e "Cód. Material" não encontradas. Use o export padrão da Intelbras.')

        // Separate iMat from iCod: if same column matched, try a secondary pass for descricao
        const iMatReal = (iMat === iCod)
          ? findCol(headers.map((h,i)=>i===iCod?'':h),'material','descri','produto')
          : iMat

        const grouped = {}
        const ordemOrder = []
        for (let r=1; r<raw.length; r++) {
          const row = raw[r]
          const ordem = String(row[iOrdem]||'').trim()
          if (!ordem) continue
          const cod = String(row[iCod]||'').trim()
          if (!cod) continue
          if (!grouped[ordem]) {
            grouped[ordem] = {
              ordem,
              situacao: iSit>=0 ? String(row[iSit]||'') : '',
              dataPedido: iData>=0 ? parseXlsxDate(row[iData]) : null,
              itens: [],
            }
            ordemOrder.push(ordem)
          }
          const qtd = parseFloat(String(row[iQtd]||'0').replace(',','.')) || 0
          const val = parseFloat(String(row[iVal]||'0').replace(',','.')) || 0
          grouped[ordem].itens.push({
            codigo:    cod,
            descricao: iMatReal>=0 ? String(row[iMatReal]||'').trim() : '',
            quantidade: qtd,
            valorTotal: val,
          })
        }
        res(ordemOrder.map(k => grouped[k]))
      } catch(err) { rej(err) }
    }
    fr.onerror = () => rej(new Error('Falha ao ler arquivo'))
    fr.readAsArrayBuffer(file)
  })
}

const STATUS_CFG = {
  aguardando: { label:'Aguardando', color:'var(--warning)', bg:'var(--warning-bg)' },
  parcial:    { label:'Parcial',    color:'var(--info)',    bg:'var(--info-bg)'    },
  faturado:   { label:'Faturado',   color:'var(--success)', bg:'var(--success-bg)' },
  cancelado:  { label:'Cancelado',  color:'var(--danger)',  bg:'var(--danger-bg)'  },
}

function StatusBadge({ s }) {
  const cfg = STATUS_CFG[s] || { label:s||'—', color:'var(--muted)', bg:'var(--card2)' }
  return <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:4,background:cfg.bg,color:cfg.color}}>{cfg.label}</span>
}

export default function PedidosIntelbrasTab({ userName }) {
  const [pedidos,    setPedidos]    = useState([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [statusFilt, setStatusFilt] = useState('')
  const [lojaFilt,   setLojaFilt]   = useState('')
  const [search,     setSearch]     = useState('')
  const [importing,  setImporting]  = useState(false)
  const [importLoja, setImportLoja] = useState('')
  const [importMsg,  setImportMsg]  = useState(null)
  const [expanded,   setExpanded]   = useState(new Set())
  const fileRef = useRef(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      let q = sb.from('pedidos')
        .select('*, pedido_itens(*), notas_fiscais(id,numero,data_emissao,status_vinculo)')
        .eq('fornecedor','Intelbras')
        .order('created_at', {ascending:false})
      if (lojaFilt) q = q.eq('loja_cnpj', lojaFilt)
      if (statusFilt) q = q.eq('status', statusFilt)
      const { data, error: e } = await q
      if (e) throw e
      let rows = data || []
      if (search) {
        const q2 = search.toLowerCase()
        rows = rows.filter(p =>
          p.numero.toLowerCase().includes(q2) ||
          (p.pedido_itens||[]).some(i => (i.codigo||'').toLowerCase().includes(q2) || (i.descricao||'').toLowerCase().includes(q2))
        )
      }
      setPedidos(rows)
    } catch(err) { setError(err.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [lojaFilt, statusFilt])

  useEffect(() => {
    const t = setTimeout(() => load(), 350)
    return () => clearTimeout(t)
  }, [search])

  const toggleExpand = id => setExpanded(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s
  })

  const doImport = async file => {
    if (!importLoja) { setImportMsg({type:'error',text:'Selecione a loja antes de importar.'}); return }
    setImporting(true); setImportMsg(null)
    try {
      const grupos = await parsePedidosXlsx(file)
      if (!grupos.length) throw new Error('Nenhum pedido encontrado na planilha.')

      const { data: existing } = await sb.from('pedidos')
        .select('id,numero')
        .eq('loja_cnpj', importLoja)
        .eq('fornecedor', 'Intelbras')
      const existMap = new Map((existing||[]).map(p => [p.numero, p.id]))

      const today = new Date().toISOString().slice(0,10)
      let inserted = 0, updated = 0

      for (const g of grupos) {
        const status = mapSituacao(g.situacao)
        let pedidoId = existMap.get(g.ordem)

        if (pedidoId) {
          await sb.from('pedidos').update({
            status,
            updated_at: new Date().toISOString(),
          }).eq('id', pedidoId)
          updated++
        } else {
          const { data: ins, error: e1 } = await sb.from('pedidos').insert({
            numero:      g.ordem,
            data_pedido: g.dataPedido || today,
            loja_cnpj:   importLoja,
            fornecedor:  'Intelbras',
            status,
            created_by:  userName || '',
          }).select('id').maybeSingle()
          if (e1) throw e1
          pedidoId = ins.id
          inserted++
        }

        await sb.from('pedido_itens').delete().eq('pedido_id', pedidoId)
        const itensRows = g.itens
          .filter(i => i.codigo && i.quantidade > 0)
          .map(i => ({
            pedido_id:           pedidoId,
            codigo:              i.codigo,
            descricao:           i.descricao,
            quantidade:          i.quantidade,
            valor_unit_centavos: i.quantidade > 0 ? Math.round(i.valorTotal * 100 / i.quantidade) : 0,
          }))
        if (itensRows.length) await sb.from('pedido_itens').insert(itensRows)
      }

      setImportMsg({ type:'success', text:`✅ ${inserted} novo(s) pedido(s) importado(s), ${updated} atualizado(s).` })
      load()
    } catch(err) {
      setImportMsg({type:'error', text:'Erro: '+err.message})
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const localFmt = d => d ? new Date(d+'T00:00:00').toLocaleDateString('pt-BR') : '—'
  const totals = pedidos.reduce((s,p) => {
    s.ag  += p.status==='aguardando' ? 1 : 0
    s.fat += p.status==='faturado'   ? 1 : 0
    s.par += p.status==='parcial'    ? 1 : 0
    return s
  }, {ag:0,fat:0,par:0})

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div className="page-header" style={{marginBottom:0}}>
        <div>
          <h2 className="page-title">📦 Pedidos Intelbras</h2>
          <p className="page-subtitle">
            {pedidos.length} pedido(s)
            {totals.ag>0&&<span style={{color:'var(--warning)',marginLeft:8}}>· {totals.ag} aguardando</span>}
            {totals.par>0&&<span style={{color:'var(--info)',marginLeft:8}}>· {totals.par} parcial</span>}
            {totals.fat>0&&<span style={{color:'var(--success)',marginLeft:8}}>· {totals.fat} faturado</span>}
          </p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <input className="filter-search" style={{minWidth:160}} placeholder="Buscar pedido ou código..." value={search} onChange={e=>setSearch(e.target.value)}/>
          <select className="filter-input" value={lojaFilt} onChange={e=>setLojaFilt(e.target.value)}>
            <option value=''>Todas as lojas</option>
            {LOJAS.map(l=><option key={l.id} value={l.cnpjRaw}>{l.nome}</option>)}
          </select>
          <select className="filter-input" value={statusFilt} onChange={e=>setStatusFilt(e.target.value)}>
            <option value=''>Todos os status</option>
            {Object.entries(STATUS_CFG).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
          </select>
          <button className="btn btn-sm btn-ghost" onClick={load} title="Recarregar">🔄</button>
          <div style={{display:'flex',gap:4,alignItems:'center',borderLeft:'1px solid var(--border)',paddingLeft:8}}>
            <select className="filter-input" value={importLoja} onChange={e=>setImportLoja(e.target.value)}>
              <option value=''>Loja p/ importar...</option>
              {LOJAS.map(l=><option key={l.id} value={l.cnpjRaw}>{l.nome}</option>)}
            </select>
            <button className="btn btn-sm btn-yellow" onClick={()=>fileRef.current?.click()} disabled={importing || !importLoja}>
              {importing ? '⏳ Importando...' : '📥 Importar Excel'}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}}
              onChange={e=>{ if(e.target.files[0]) doImport(e.target.files[0]) }}/>
          </div>
        </div>
      </div>

      {importMsg && (
        <div style={{
          background: importMsg.type==='success'?'var(--success-bg)':'var(--danger-bg)',
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

      {loading ? (
        <div style={{padding:32,textAlign:'center',color:'var(--muted)'}}>Carregando...</div>
      ) : pedidos.length===0 ? (
        <div className="table-empty">
          <div className="table-empty-icon">📭</div>
          <p>Nenhum pedido encontrado.</p>
          <p style={{color:'var(--muted)',fontSize:12}}>
            Selecione a loja e importe a planilha de pedidos da Intelbras (Portal do Parceiro → Pedidos → Exportar Excel).
          </p>
        </div>
      ) : (
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,minWidth:700}}>
            <thead>
              <tr style={{borderBottom:'2px solid var(--border)'}}>
                <th style={{padding:'8px 6px',width:24}}/>
                <th style={{padding:'8px 10px',textAlign:'left',fontSize:11,color:'var(--muted)',fontWeight:700}}>Ordem de Pedido</th>
                <th style={{padding:'8px 10px',textAlign:'left',fontSize:11,color:'var(--muted)',fontWeight:700}}>Loja</th>
                <th style={{padding:'8px 10px',textAlign:'left',fontSize:11,color:'var(--muted)',fontWeight:700}}>Data</th>
                <th style={{padding:'8px 10px',textAlign:'left',fontSize:11,color:'var(--muted)',fontWeight:700}}>Status</th>
                <th style={{padding:'8px 10px',textAlign:'right',fontSize:11,color:'var(--muted)',fontWeight:700}}>Itens</th>
                <th style={{padding:'8px 10px',textAlign:'left',fontSize:11,color:'var(--muted)',fontWeight:700}}>NF Vinculada</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.map(p => {
                const isOpen  = expanded.has(p.id)
                const itCount = (p.pedido_itens||[]).length
                const nfList  = (p.notas_fiscais||[])
                const totalCents = (p.pedido_itens||[]).reduce((s,i)=>(s+(i.valor_unit_centavos||0)*i.quantidade),0)
                return (
                  <Fragment key={p.id}>
                    <tr
                      style={{borderBottom:'1px solid var(--border)',cursor:'pointer',transition:'background .1s'}}
                      onClick={()=>toggleExpand(p.id)}
                    >
                      <td style={{padding:'8px 6px',color:'var(--muted)',fontSize:12,userSelect:'none'}}>{isOpen?'▾':'▸'}</td>
                      <td style={{padding:'8px 10px',fontWeight:700,color:'var(--accent)',whiteSpace:'nowrap'}}>{p.numero}</td>
                      <td style={{padding:'8px 10px',whiteSpace:'nowrap'}}>{lojaNome(p.loja_cnpj)}</td>
                      <td style={{padding:'8px 10px',whiteSpace:'nowrap',color:'var(--muted)',fontSize:12}}>
                        {p.data_pedido ? localFmt(p.data_pedido) : localFmt(p.created_at?.slice(0,10))}
                      </td>
                      <td style={{padding:'8px 10px'}}><StatusBadge s={p.status}/></td>
                      <td style={{padding:'8px 10px',textAlign:'right',color:'var(--muted)'}}>
                        {itCount}&nbsp;<span style={{fontSize:11}}>({fmtCents(totalCents)})</span>
                      </td>
                      <td style={{padding:'8px 10px'}}>
                        {nfList.length > 0
                          ? <span style={{fontSize:12,color:'var(--success)',fontWeight:600}}>✓ {nfList.map(n=>n.numero).join(', ')}</span>
                          : <span style={{fontSize:11,color:'var(--muted)'}}>—</span>
                        }
                      </td>
                    </tr>
                    {isOpen && itCount > 0 && (
                      <tr style={{background:'var(--card2)'}}>
                        <td colSpan={7} style={{padding:'8px 28px 14px'}}>
                          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                            <thead>
                              <tr style={{borderBottom:'1px solid var(--border)'}}>
                                <th style={{padding:'4px 8px',textAlign:'left',color:'var(--muted)',fontWeight:700}}>Código</th>
                                <th style={{padding:'4px 8px',textAlign:'left',color:'var(--muted)',fontWeight:700}}>Material</th>
                                <th style={{padding:'4px 8px',textAlign:'right',color:'var(--muted)',fontWeight:700}}>Qtd</th>
                                <th style={{padding:'4px 8px',textAlign:'right',color:'var(--muted)',fontWeight:700}}>Vlr. Unit.</th>
                                <th style={{padding:'4px 8px',textAlign:'right',color:'var(--muted)',fontWeight:700}}>Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(p.pedido_itens||[]).map((it,i)=>(
                                <tr key={i} style={{borderBottom:'1px solid var(--border2)'}}>
                                  <td style={{padding:'4px 8px',fontFamily:'monospace',color:'var(--accent)'}}>{it.codigo||'—'}</td>
                                  <td style={{padding:'4px 8px'}}>{it.descricao||'—'}</td>
                                  <td style={{padding:'4px 8px',textAlign:'right'}}>{it.quantidade}</td>
                                  <td style={{padding:'4px 8px',textAlign:'right'}}>{fmtCents(it.valor_unit_centavos)}</td>
                                  <td style={{padding:'4px 8px',textAlign:'right',fontWeight:700}}>{fmtCents((it.valor_unit_centavos||0)*it.quantidade)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useRef, Fragment } from 'react'
import * as XLSX from 'xlsx'
import { sb } from '../supabase.js'
import { loadSupabasePedidosForStatus, calcPrevisaoChegada, checkFaturamentoParcial, aplicarFaturamentoParcial } from '../nf-logic.js'
import { LOJAS, lojaNome, fmtCents } from '../constants.js'

// Known CNPJ → loja mapping (full CNPJ and Intelbras portal customer codes)
const CNPJ_LOJA = {
  ...Object.fromEntries(LOJAS.map(l => [l.cnpjRaw, l.cnpjRaw])),
  '1014906': '35369505000102', // Cód. cliente Intelbras — Francisco Beltrão
  '1020765': '35369505000374', // Cód. cliente Intelbras — Toledo
}

function normCnpjStr(v) { return String(v||'').replace(/\D/g,'') }

function mapSituacao(sit) {
  const s = (sit||'').toLowerCase()
  if (s.includes('faturad') || s.includes('encerrad')) return 'faturado'
  if (s.includes('parcial')) return 'parcial'
  if (s.includes('cancel')) return 'cancelado'
  return 'aguardando'
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

function normH(h) {
  return (h||'').toString().trim().toLowerCase().replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim()
}
function findCol(headers, ...terms) {
  for (const t of terms) {
    const idx = headers.findIndex(h => h.includes(t))
    if (idx >= 0) return idx
  }
  return -1
}

function parsePedidosXlsx(file, fallbackLoja) {
  return new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, {type:'array',cellDates:true})
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, {header:1,defval:''})
        if (raw.length < 2) return rej(new Error('Planilha vazia'))
        const headers = raw[0].map(normH)

        const iOrdem   = findCol(headers,'ordem de pedido','ordem pedido','ordem')
        const iSit     = findCol(headers,'situa','status')
        const iCod     = findCol(headers,'cod material','c d material','c d. material','codigo material')
        const iMat     = headers.findIndex(h => (h.includes('material')||h.includes('descri')||h.includes('produto')) && !h.includes('cod'))
        const iQtd     = findCol(headers,'qtd total','quantidade total','qtd pedida','qt pedida','qtd faturada','qtd','quantidade')
        const iRemessa = findCol(headers,'qtd remessa','quantidade remessa','remessa')
        const iVal     = findCol(headers,'vlr total','valor total','vlr unit','valor unit','vlr','valor')
        const iData    = findCol(headers,'data pedido','data','dt pedido')
        const iCnpj    = findCol(headers,'cnpj destinat','cnpj comprador','cnpj empresa','cnpj filial','cnpj','destinat','comprador','cod cliente','codigo cliente','c d cliente','cliente','codigo')
        const iDev     = findCol(headers,'devolu')

        if (iOrdem < 0 || iCod < 0)
          throw new Error('Colunas "Ordem de Pedido" e "Cód. Material" não encontradas. Use o export padrão da Intelbras.')

        const iMatReal = (iMat >= 0 && iMat !== iCod) ? iMat : -1

        const grouped = {}
        const keyOrder = []
        let cnpjDetected = false

        for (let r=1; r<raw.length; r++) {
          const row = raw[r]
          const ordem = String(row[iOrdem]||'').trim()
          if (!ordem) continue
          const cod = String(row[iCod]||'').trim()
          if (!cod) continue

          // Fix 1: pular devoluções e quantidades negativas/zero
          if (iDev >= 0) {
            const dv = normH(String(row[iDev]||''))
            if (dv === 'sim' || dv === 's') continue
          }
          const qtd = parseFloat(String(row[iQtd]||'0').replace(',','.')) || 0
          if (qtd <= 0) continue

          let lojaCnpj = fallbackLoja || ''
          if (!lojaCnpj && iCnpj >= 0) {
            const rawCell = String(row[iCnpj]||'').trim()
            const mapped = CNPJ_LOJA[normCnpjStr(rawCell)] || CNPJ_LOJA[rawCell]
            if (mapped) { lojaCnpj = mapped; cnpjDetected = true }
          }
          if (!lojaCnpj) {
            for (const cell of row) {
              const v = String(cell||'').trim()
              const mapped = CNPJ_LOJA[normCnpjStr(v)] || CNPJ_LOJA[v]
              if (mapped) { lojaCnpj = mapped; cnpjDetected = true; break }
            }
          }
          if (!lojaCnpj)
            throw new Error('Loja não identificada. Selecione a loja no campo "Loja (auto)" antes de importar.')

          const key = `${ordem}__${lojaCnpj}`
          if (!grouped[key]) {
            grouped[key] = {
              ordem, lojaCnpj,
              situacao:    iSit >= 0 ? String(row[iSit]||'') : '',
              dataPedido:  iData >= 0 ? parseXlsxDate(row[iData]) : null,
              hasRemessa:  iRemessa >= 0,
              totalQtd:    0,
              totalRemessa:0,
              itens: [],
            }
            keyOrder.push(key)
          }
          const val     = parseFloat(String(row[iVal]||'0').replace(',','.')) || 0
          const remessa = iRemessa >= 0 ? (parseFloat(String(row[iRemessa]||'0').replace(',','.')) || 0) : 0
          grouped[key].totalQtd      += qtd
          grouped[key].totalRemessa  += remessa
          grouped[key].itens.push({
            codigo:    cod,
            descricao: iMatReal >= 0 ? String(row[iMatReal]||'').trim() : '',
            quantidade: qtd,
            valorTotal: val,
          })
        }

        // Fix 3: calcular status via Qtd. Remessa quando disponível
        for (const key of keyOrder) {
          const g = grouped[key]
          if (g.hasRemessa) {
            if      (g.totalRemessa <= 0)                      g.statusCalc = 'aguardando'
            else if (g.totalRemessa < g.totalQtd * 0.99)      g.statusCalc = 'parcial'
            else                                               g.statusCalc = 'faturado'
          } else {
            g.statusCalc = mapSituacao(g.situacao)
          }
        }

        res({ grupos: keyOrder.map(k=>grouped[k]), cnpjDetected })
      } catch(err) { rej(err) }
    }
    fr.onerror = () => rej(new Error('Falha ao ler arquivo'))
    fr.readAsArrayBuffer(file)
  })
}

function parseNFXlsx(file, fallbackLoja) {
  return new Promise((res,rej) => {
    const fr = new FileReader()
    fr.onload = e => {
      try {
        const wb = XLSX.read(e.target.result,{type:'array',cellDates:true})
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws,{header:1,defval:''})
        if (raw.length < 2) return rej(new Error('Planilha vazia'))
        const hdrs = raw[0].map(normH)
        const iNF    = findCol(hdrs,'nota fiscal','nf','numero','nota')
        const iData  = findCol(hdrs,'data')
        const iOrdem = findCol(hdrs,'ordem de compra','ordem compra','ordem','pedido')
        const iCod   = findCol(hdrs,'cod material','c d material','codigo material','codigo')
        const iMat   = hdrs.findIndex(h => (h.includes('material')||h.includes('descri')) && !h.includes('cod'))
        const iQtd   = findCol(hdrs,'quantidade','qtd')
        const iVal   = findCol(hdrs,'valor faturado','valor')
        const iCnpj  = findCol(hdrs,'cnpj','destinat','comprador','cod cliente','codigo cliente','cliente')
        const iUF    = findCol(hdrs,'uf emit','uf emitente','uf origem','uf forn','uf')
        if (iNF<0||iCod<0) throw new Error('Colunas "Nota Fiscal" e "Cód. Material" não encontradas.')
        const grouped = {}, order = []
        let lojaDetected = false
        for (let r=1; r<raw.length; r++) {
          const row = raw[r]
          const nf  = String(row[iNF]||'').trim(); if (!nf) continue
          const cod = String(row[iCod]||'').trim(); if (!cod) continue
          let loja = fallbackLoja || ''
          if (!loja && iCnpj>=0) { const raw2=String(row[iCnpj]||'').trim(); const mapped=CNPJ_LOJA[normCnpjStr(raw2)]||CNPJ_LOJA[raw2]; if(mapped){loja=mapped;lojaDetected=true} }
          if (!loja) { for(const c of row){const v=String(c||'').trim();const mapped=CNPJ_LOJA[normCnpjStr(v)]||CNPJ_LOJA[v];if(mapped){loja=mapped;lojaDetected=true;break}} }
          if (!loja) throw new Error('Loja não identificada. Selecione a loja no campo "Loja (auto)" antes de importar.')
          const key = `${nf}__${loja}`
          const ufRow = iUF >= 0 ? String(row[iUF]||'').trim().toUpperCase() : ''
          if (!grouped[key]) { grouped[key]={ numero:nf, loja, uf:'', data:iData>=0?parseXlsxDate(row[iData]):null, ordemCompra:iOrdem>=0?String(row[iOrdem]||'').trim():'', itens:[] }; order.push(key) }
          if (!grouped[key].uf && ufRow) grouped[key].uf = ufRow
          const qtd = parseFloat(String(row[iQtd]||'0').replace(',','.'))||0
          const val = parseFloat(String(row[iVal]||'0').replace(',','.'))||0
          grouped[key].itens.push({
            codigo: cod,
            descricao: iMat >= 0 && iMat !== iCod ? String(row[iMat]||'').trim() : '',
            quantidade: qtd,
            valorFaturado: val,
            valorUnit: qtd > 0 ? val / qtd : 0,
          })
        }
        res({ grupos: order.map(k=>grouped[k]), lojaDetected })
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

export default function PedidosIntelbrasTab({ userName, rawItems, priceMap }) {
  const [pedidos,    setPedidos]    = useState([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [statusFilt, setStatusFilt] = useState('')
  const [lojaFilt,   setLojaFilt]   = useState('')
  const [search,     setSearch]     = useState('')
  const [importing,    setImporting]    = useState(false)
  const [importingNF,  setImportingNF]  = useState(false)
  const [fallbackLoja, setFallbackLoja] = useState('')
  const [importMsg,    setImportMsg]    = useState(null)
  const [expanded,     setExpanded]     = useState(new Set())
  const fileRef   = useRef(null)
  const nfFileRef = useRef(null)

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
  useEffect(() => { const t=setTimeout(()=>load(),350); return ()=>clearTimeout(t) }, [search])

  const toggleExpand = id => setExpanded(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s
  })

  const doImport = async file => {
    setImporting(true); setImportMsg(null)
    try {
      const { grupos, cnpjDetected } = await parsePedidosXlsx(file, fallbackLoja)
      if (!grupos.length) throw new Error('Nenhum pedido encontrado na planilha.')

      const lojasCnpj = [...new Set(grupos.map(g=>g.lojaCnpj))]
      const { data: existing } = await sb.from('pedidos')
        .select('id,numero,loja_cnpj,status')
        .in('loja_cnpj', lojasCnpj)
        .eq('fornecedor','Intelbras')
      const existMap = new Map((existing||[]).map(p=>[`${p.numero}__${p.loja_cnpj}`, p]))

      // Fix 2: só avança status, nunca rebaixa
      const STATUS_RANK = { cancelado:-1, aguardando:0, parcial:1, faturado:2 }

      const today = new Date().toISOString().slice(0,10)
      let inserted=0, updated=0

      for (const g of grupos) {
        const status = g.statusCalc
        const key = `${g.ordem}__${g.lojaCnpj}`
        const existPedido = existMap.get(key)
        let pedidoId = existPedido?.id

        if (pedidoId) {
          const existRank = STATUS_RANK[existPedido.status] ?? 0
          const newRank   = STATUS_RANK[status] ?? 0
          if (newRank > existRank)
            await sb.from('pedidos').update({ status, updated_at:new Date().toISOString() }).eq('id',pedidoId)
          updated++
        } else {
          const { data:ins, error:e1 } = await sb.from('pedidos').insert({
            numero:      g.ordem,
            data_pedido: g.dataPedido || today,
            loja_cnpj:   g.lojaCnpj,
            fornecedor:  'Intelbras',
            status,
            created_by:  userName || '',
          }).select('id').maybeSingle()
          if (e1) throw e1
          pedidoId = ins.id
          inserted++
        }

        await sb.from('pedido_itens').delete().eq('pedido_id',pedidoId)
        const itensRows = g.itens
          .filter(i => i.codigo && i.quantidade > 0)
          .map(i => ({
            pedido_id:           pedidoId,
            codigo:              i.codigo,
            descricao:           i.descricao,
            quantidade:          i.quantidade,
            valor_unit_centavos: Math.round(i.valorTotal * 100 / i.quantidade),
          }))
        if (itensRows.length) await sb.from('pedido_itens').insert(itensRows)
      }

      const lojaNames = lojasCnpj.map(c=>LOJAS.find(l=>l.cnpjRaw===c)?.nome||c).join(', ')
      setImportMsg({
        type:'success',
        text:`✅ ${inserted} novo(s) pedido(s) importado(s), ${updated} atualizado(s)` +
             (cnpjDetected ? ` — loja(s) detectada(s): ${lojaNames}` : ''),
      })
      load()
      loadSupabasePedidosForStatus().catch(()=>{})
    } catch(err) {
      setImportMsg({type:'error', text:'Erro: '+err.message})
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value=''
    }
  }

  const doImportNF = async file => {
    setImportingNF(true); setImportMsg(null)
    try {
      const { grupos, lojaDetected } = await parseNFXlsx(file, fallbackLoja)
      if (!grupos.length) throw new Error('Nenhuma nota encontrada na planilha.')
      const lojasCnpj = [...new Set(grupos.map(g=>g.loja))]
      const { data: existing } = await sb.from('notas_fiscais')
        .select('id,numero,loja_cnpj')
        .in('loja_cnpj', lojasCnpj)
        .in('numero', grupos.map(g=>g.numero))
      const existSet = new Set((existing||[]).map(n=>`${n.numero}__${n.loja_cnpj}`))
      const { data: pedidosLoja } = await sb.from('pedidos')
        .select('id,numero,loja_cnpj,status,data_pedido,fornecedor,fornecedor_cnpj,created_by,pedido_itens(id,codigo,quantidade,descricao,valor_unit_centavos)')
        .in('loja_cnpj', lojasCnpj)
        .eq('fornecedor','Intelbras')
      const pedidoMap = new Map((pedidosLoja||[]).map(p=>[`${p.numero}__${p.loja_cnpj}`,p]))
      let inserted=0, skipped=0, linked=0, parciais=0
      for (const g of grupos) {
        const key = `${g.numero}__${g.loja}`
        if (existSet.has(key)) { skipped++; continue }
        const totalCents = g.itens.reduce((s,i)=>s+Math.round(i.valorFaturado*100),0)
        const pedido  = g.ordemCompra ? pedidoMap.get(`${g.ordemCompra}__${g.loja}`) : null
        const emitUF  = g.uf || 'SC'
        const previsao = calcPrevisaoChegada(g.data, emitUF)
        const { data: nfIns, error: e1 } = await sb.from('notas_fiscais').insert({
          numero: g.numero, data_emissao: g.data,
          emit_nome: 'Intelbras', emit_cnpj: '82901000000127', emit_uf: emitUF,
          loja_cnpj: g.loja, valor_total_centavos: totalCents,
          status_vinculo: pedido ? 'vinculado' : 'sem_pedido',
          pedido_id: pedido?.id || null,
          vinculo_motivo: pedido ? 'Vínculo por Ordem de Compra (import Excel)' : '',
          previsao_chegada: previsao,
          acao_necessaria: '',
        }).select('id').maybeSingle()
        if (e1) throw e1
        inserted++
        // #1 preço unit + #2 descrição
        const itens = g.itens.filter(i=>i.codigo&&i.quantidade>0).map(i=>({
          nf_id: nfIns.id,
          codigo: i.codigo,
          descricao: i.descricao || '',
          quantidade: i.quantidade,
          valor_unit_centavos: Math.round(i.valorUnit * 100),
          valor_total_centavos: Math.round(i.valorFaturado * 100),
        }))
        if (itens.length) await sb.from('nf_itens').insert(itens)
        if (pedido) {
          linked++
          const nfLike = { id:nfIns.id, numero:g.numero, data_emissao:g.data, emit_cnpj:'82901000000127', emit_uf:emitUF, nf_itens:itens }
          const isPartial = checkFaturamentoParcial(nfLike, pedido.pedido_itens)
          if (isPartial) {
            parciais++
            await aplicarFaturamentoParcial(nfLike, pedido)
          } else {
            await sb.from('pedidos').update({ status:'faturado', previsao_entrega:previsao, updated_at:new Date().toISOString() }).eq('id',pedido.id)
            await sb.from('vinculo_log').insert({ nf_id:nfIns.id, pedido_id:pedido.id, evento:'vinculado', score_confianca:100, detalhe:'Vínculo por Ordem de Compra (import Excel)' })
          }
          // #4 atualizar valor_unit_centavos dos pedido_itens com o preço real faturado
          const nfPriceMap = {}
          itens.forEach(i => { if (i.codigo && i.valor_unit_centavos > 0) nfPriceMap[i.codigo] = i.valor_unit_centavos })
          for (const pi of (pedido.pedido_itens || [])) {
            if (pi.id && nfPriceMap[pi.codigo])
              await sb.from('pedido_itens').update({ valor_unit_centavos: nfPriceMap[pi.codigo] }).eq('id', pi.id)
          }
        }
      }
      const lojaNames = lojasCnpj.map(c=>LOJAS.find(l=>l.cnpjRaw===c)?.nome||c).join(', ')
      setImportMsg({ type:'success', text:`✅ NF: ${inserted} importada(s) — ${linked} vinculada(s)${parciais>0?` (${parciais} parcial)`:''}, ${skipped} já existia(m)` + (lojaDetected ? ` — loja(s): ${lojaNames}` : '') })
      load()
      loadSupabasePedidosForStatus().catch(()=>{})
    } catch(err) {
      setImportMsg({type:'error', text:'Erro NF: '+err.message})
    } finally {
      setImportingNF(false)
      if (nfFileRef.current) nfFileRef.current.value=''
    }
  }

  const localFmt = d => d ? new Date(d+'T00:00:00').toLocaleDateString('pt-BR') : '—'
  const totals = pedidos.reduce((s,p)=>({ ag:s.ag+(p.status==='aguardando'?1:0), fat:s.fat+(p.status==='faturado'?1:0), par:s.par+(p.status==='parcial'?1:0) }),{ag:0,fat:0,par:0})

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
            <select className="filter-input" value={fallbackLoja} onChange={e=>setFallbackLoja(e.target.value)} title="Loja manual (caso não detectada automaticamente no arquivo)">
              <option value=''>Loja (auto)</option>
              {LOJAS.map(l=><option key={l.id} value={l.cnpjRaw}>{l.nome}</option>)}
            </select>
            <button className="btn btn-sm btn-yellow" onClick={()=>fileRef.current?.click()} disabled={importing||importingNF}>
              {importing ? '⏳ Pedidos...' : '📥 Importar Pedidos'}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}}
              onChange={e=>{ if(e.target.files[0]) doImport(e.target.files[0]) }}/>
            <button className="btn btn-sm btn-yellow" onClick={()=>nfFileRef.current?.click()} disabled={importing||importingNF}>
              {importingNF ? '⏳ NF...' : '📥 Importar NF'}
            </button>
            <input ref={nfFileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}}
              onChange={e=>{ if(e.target.files[0]) doImportNF(e.target.files[0]) }}/>
          </div>
        </div>
      </div>

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

      {loading ? (
        <div style={{padding:32,textAlign:'center',color:'var(--muted)'}}>Carregando...</div>
      ) : pedidos.length===0 ? (
        <div className="table-empty">
          <div className="table-empty-icon">📭</div>
          <p>Nenhum pedido encontrado.</p>
          <p style={{color:'var(--muted)',fontSize:12}}>Importe a planilha de pedidos exportada do Portal Intelbras. A loja é detectada automaticamente pelo CNPJ.</p>
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
                <th style={{padding:'8px 10px',textAlign:'right',fontSize:11,color:'var(--muted)',fontWeight:700}}>Itens / Total</th>
                <th style={{padding:'8px 10px',textAlign:'left',fontSize:11,color:'var(--muted)',fontWeight:700}}>NF Vinculada</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.map(p => {
                const isOpen  = expanded.has(p.id)
                const itCount = (p.pedido_itens||[]).length
                const nfList  = (p.notas_fiscais||[])
                const totalCents = (p.pedido_itens||[]).reduce((s,i)=>s+(i.valor_unit_centavos||0)*i.quantidade,0)
                return (
                  <Fragment key={p.id}>
                    <tr style={{borderBottom:'1px solid var(--border)',cursor:'pointer'}} onClick={()=>toggleExpand(p.id)}>
                      <td style={{padding:'8px 6px',color:'var(--muted)',fontSize:12,userSelect:'none'}}>{isOpen?'▾':'▸'}</td>
                      <td style={{padding:'8px 10px',fontWeight:700,color:'var(--accent)',whiteSpace:'nowrap'}}>{p.numero}</td>
                      <td style={{padding:'8px 10px',whiteSpace:'nowrap'}}>{lojaNome(p.loja_cnpj)}</td>
                      <td style={{padding:'8px 10px',whiteSpace:'nowrap',color:'var(--muted)',fontSize:12}}>
                        {p.data_pedido ? localFmt(p.data_pedido) : localFmt(p.created_at?.slice(0,10))}
                      </td>
                      <td style={{padding:'8px 10px'}}><StatusBadge s={p.status}/></td>
                      <td style={{padding:'8px 10px',textAlign:'right',color:'var(--muted)'}}>
                        {itCount} <span style={{fontSize:11}}>({fmtCents(totalCents)})</span>
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
                                  <td style={{padding:'4px 8px'}}>{it.descricao || rawItems?.find(r=>r.code===it.codigo)?.description || priceMap?.get(it.codigo)?.description || '—'}</td>
                                  <td style={{padding:'4px 8px',textAlign:'right'}}>{it.quantidade}</td>
                                  <td style={{padding:'4px 8px',textAlign:'right'}}>{fmtCents(it.valor_unit_centavos)}</td>
                                  <td style={{padding:'4px 8px',textAlign:'right',fontWeight:700}}>{fmtCents((it.valor_unit_centavos||0)*it.quantidade)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {nfList.length>0&&(
                            <div style={{marginTop:8,fontSize:12,color:'var(--success)'}}>
                              NF(s) vinculada(s): {nfList.map(n=>n.numero).join(', ')}
                            </div>
                          )}
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

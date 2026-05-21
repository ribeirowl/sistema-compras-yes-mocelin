import { useState, useEffect, useRef, useMemo, Fragment } from 'react'
import * as XLSX from 'xlsx'
import { sb, getHistory, saveHistory, getFullPriceMap } from '../supabase.js'
import { todayStr, addBizDays } from '../utils.js'
import { loadSupabasePedidosForStatus, calcPrevisaoChegada, checkFaturamentoParcial, aplicarFaturamentoParcial } from '../nf-logic.js'
import { LOJAS, lojaNome, fmtCents } from '../constants.js'

// Known CNPJ → loja mapping (full CNPJ and Intelbras portal customer codes)
const CNPJ_LOJA = {
  ...Object.fromEntries(LOJAS.map(l => [l.cnpjRaw, l.cnpjRaw])),
  '1014906': '35369505000102', // Cód. cliente Intelbras — Francisco Beltrão
  '1020765': '35369505000374', // Cód. cliente Intelbras — Toledo
}

const CITY_FROM_CNPJ = {
  '35369505000102': 'BELTRAO',
  '35369505000374': 'TOLEDO',
}

function normCnpjStr(v) { return String(v||'').replace(/\D/g,'') }


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

function parseCarteiraXlsx(file, fallbackLoja) {
  return new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, {type:'array', cellDates:true})
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, {header:1, defval:''})
        if (raw.length < 2) return rej(new Error('Planilha vazia'))
        const headers = raw[0].map(normH)

        const iPedido  = findCol(headers, 'pedido parceiro', 'pedido')
        const iCnpj    = findCol(headers, 'cnpj parceiro', 'cnpj')
        const iCod     = findCol(headers, 'c d material', 'cod material', 'codigo material')
        // Strict match: only pure "material" column or known description patterns;
        // exclude any column whose header also mentions dates, qty, remessa, etc.
        const iDesc    = headers.findIndex(h => {
          if (h.includes('c d') || h.includes('cod')) return false
          if (h.includes('data') || h.includes('previs') || h.includes('entrega') ||
              h.includes('remessa') || h.includes('desej') || h.includes('qtd') ||
              h.includes('quantidade') || h.includes('valor')) return false
          return h === 'material' || h.includes('texto breve') || h.includes('descri')
        })
        const iQtdTot  = findCol(headers, 'qtd total', 'quantidade total')
        const iQtdNC   = findCol(headers, 'n o confirmada', 'nao confirmada', 'nconfirmada')
        const iQtdPrev = findCol(headers, 'cart prevista', 'qtd prevista')
        const iRemessa = findCol(headers, 'qtd remessa', 'remessa')
        const iEntrega = findCol(headers, 'entrega calculada', 'data entrega')
        const iDesej   = findCol(headers, 'desej cliente', 'desej inicial', 'data desej')

        if (iPedido < 0 || iCod < 0)
          throw new Error('Colunas "Pedido Parceiro" e "Cód. Material" não encontradas. Use o export Carteira Detalhado do Portal Intelbras.')

        const today   = todayStr()
        const plus5ts = Date.now() + 5 * 86400000
        const itens   = []    // flat list for sc_orders
        const grouped = {}    // keyed by pedido__cnpj for Supabase
        const keyOrder = []

        let lastPedido = ''
        for (let r = 1; r < raw.length; r++) {
          const row = raw[r]
          // Carteira uses merged cells for Pedido Parceiro — carry last non-empty value forward
          const rawPed = String(row[iPedido]||'').trim()
          if (rawPed && rawPed !== '-') lastPedido = rawPed
          const pedido = lastPedido
          if (!pedido) continue
          const cod = String(row[iCod]||'').trim()
          if (!cod) continue

          let qtdTot = iQtdTot >= 0 ? (parseFloat(String(row[iQtdTot]||'0').replace(',','.')) || 0) : 0
          if (qtdTot <= 0) {
            const nc  = iQtdNC    >= 0 ? (parseFloat(String(row[iQtdNC   ]||'0').replace(',','.'))||0) : 0
            const pv2 = iQtdPrev  >= 0 ? (parseFloat(String(row[iQtdPrev ]||'0').replace(',','.'))||0) : 0
            const rem = iRemessa   >= 0 ? (parseFloat(String(row[iRemessa ]||'0').replace(',','.'))||0) : 0
            qtdTot = nc + pv2 + rem
          }
          if (qtdTot <= 0) continue

          const remQtd = iRemessa >= 0 ? (parseFloat(String(row[iRemessa]||'0').replace(',','.')) || 0) : 0

          let lojaCnpj = fallbackLoja || ''
          if (!lojaCnpj && iCnpj >= 0) {
            const rawCell = String(row[iCnpj]||'').trim()
            const mapped = CNPJ_LOJA[normCnpjStr(rawCell)] || CNPJ_LOJA[rawCell]
            if (mapped) lojaCnpj = mapped
          }
          if (!lojaCnpj) {
            for (const cell of row) {
              const v = String(cell||'').trim()
              const mapped = CNPJ_LOJA[normCnpjStr(v)] || CNPJ_LOJA[v]
              if (mapped) { lojaCnpj = mapped; break }
            }
          }
          if (!lojaCnpj)
            throw new Error('Loja não identificada. Selecione a loja no campo "Loja (auto)" ou inclua a coluna "CNPJ Parceiro Negócio".')

          const cityGroup   = CITY_FROM_CNPJ[lojaCnpj] || 'BELTRAO'
          const desc        = iDesc >= 0 ? String(row[iDesc]||'').trim() : ''
          const entregaStr  = iEntrega >= 0 ? parseXlsxDate(row[iEntrega]) : null
          const desejadaStr = iDesej   >= 0 ? parseXlsxDate(row[iDesej])   : null
          const isProgrammed = desejadaStr ? new Date(desejadaStr).getTime() >= plus5ts : false

          let arrivalDate = entregaStr || null
          if (!arrivalDate && isProgrammed) arrivalDate = desejadaStr
          if (!arrivalDate) arrivalDate = addBizDays(today, 7).toISOString().slice(0,10)

          itens.push({
            id:             `carteira_${pedido}_${cod}`,
            code:           cod,
            description:    desc,
            brand:          'Intelbras',
            cityGroup,
            qty:            qtdTot,
            pv:             0,
            date:           today,
            availType:      'SEM_DISPONIBILIDADE',
            ufOrigem:       'SC',
            arrivalDate,
            isProgrammed,
            source:         'carteira',
            pedidoParceiro: pedido,
          })

          // Group by Pedido Parceiro for Supabase upsert
          const key = `${pedido}__${lojaCnpj}`
          if (!grouped[key]) {
            grouped[key] = {
              ordem: pedido, lojaCnpj, dataPedido: today,
              hasRemessa: iRemessa >= 0,
              totalQtd: 0, totalRemessa: 0, previsaoEntrega: null,
              itens: [],
            }
            keyOrder.push(key)
          }
          grouped[key].totalQtd     += qtdTot
          grouped[key].totalRemessa += remQtd
          if (entregaStr && (!grouped[key].previsaoEntrega || entregaStr > grouped[key].previsaoEntrega))
            grouped[key].previsaoEntrega = entregaStr
          grouped[key].itens.push({ codigo: cod, descricao: desc, quantidade: qtdTot, valorTotal: 0 })
        }

        for (const key of keyOrder) {
          const g = grouped[key]
          if (g.hasRemessa) {
            if      (g.totalRemessa <= 0)                  g.statusCalc = 'aguardando'
            else if (g.totalRemessa < g.totalQtd * 0.99)  g.statusCalc = 'parcial'
            else                                           g.statusCalc = 'faturado'
          } else {
            g.statusCalc = 'aguardando'
          }
        }

        if (!itens.length) throw new Error('Nenhum item encontrado. Verifique se é o relatório Carteira Detalhado correto.')
        res({ itens, grupos: keyOrder.map(k => grouped[k]) })
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

export default function PedidosIntelbrasTab({ userName, rawItems, priceMap, orders, onUpdateOrders, onUpdateHistory }) {
  const [pedidos,    setPedidos]    = useState([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [statusFilt, setStatusFilt] = useState('')
  const [lojaFilt,   setLojaFilt]   = useState('')
  const [search,     setSearch]     = useState('')
  const [importingNF,  setImportingNF]  = useState(false)
  const [fallbackLoja, setFallbackLoja] = useState('')
  const [importMsg,           setImportMsg]           = useState(null)
  const [importingCarteira,   setImportingCarteira]   = useState(false)
  const [showCarteira,        setShowCarteira]        = useState(false)
  const [confirmClearManuais, setConfirmClearManuais] = useState(false)
  const [expanded,            setExpanded]            = useState(new Set())
  const nfFileRef       = useRef(null)
  const carteiraFileRef = useRef(null)

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
      let inserted=0, skipped=0, linked=0, parciais=0, pedidosCriados=0
      for (const g of grupos) {
        const key = `${g.numero}__${g.loja}`
        if (existSet.has(key)) { skipped++; continue }
        const totalCents = g.itens.reduce((s,i)=>s+Math.round(i.valorFaturado*100),0)
        let pedido  = g.ordemCompra ? pedidoMap.get(`${g.ordemCompra}__${g.loja}`) : null
        const emitUF  = g.uf || 'SC'
        const previsao = calcPrevisaoChegada(g.data, emitUF)

        // Se há ordem de compra mas nenhum pedido existe, cria automaticamente
        if (g.ordemCompra && !pedido) {
          const { data: newPed, error: ePed } = await sb.from('pedidos').insert({
            numero:           g.ordemCompra,
            data_pedido:      g.data,
            loja_cnpj:        g.loja,
            fornecedor:       'Intelbras',
            status:           'faturado',
            previsao_entrega: previsao,
            created_by:       userName || '',
          }).select('id').maybeSingle()
          if (!ePed && newPed) {
            const piRows = g.itens.filter(i => i.codigo && i.quantidade > 0).map(i => ({
              pedido_id:           newPed.id,
              codigo:              i.codigo,
              descricao:           i.descricao || '',
              quantidade:          i.quantidade,
              valor_unit_centavos: Math.round(i.valorUnit * 100),
            }))
            if (piRows.length) await sb.from('pedido_itens').insert(piRows)
            pedido = { id: newPed.id, pedido_itens: piRows }
            pedidoMap.set(`${g.ordemCompra}__${g.loja}`, pedido)
            pedidosCriados++
          }
        }
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
      setImportMsg({ type:'success', text:`✅ NF: ${inserted} importada(s) — ${linked} vinculada(s)${parciais>0?` (${parciais} parcial)`:''}, ${skipped} já existia(m)${pedidosCriados>0?` · ${pedidosCriados} pedido(s) criado(s) automaticamente`:''}` + (lojaDetected ? ` — loja(s): ${lojaNames}` : '') })
      load()
      loadSupabasePedidosForStatus().catch(()=>{})
    } catch(err) {
      setImportMsg({type:'error', text:'Erro NF: '+err.message})
    } finally {
      setImportingNF(false)
      if (nfFileRef.current) nfFileRef.current.value=''
    }
  }

  const carteiraItems = useMemo(() => (orders||[]).filter(o => o.source === 'carteira'), [orders])
  const manualCount   = useMemo(() => (orders||[]).filter(o => o.source !== 'carteira' && !o.receivedAt).length, [orders])

  const doImportCarteira = async file => {
    setImportingCarteira(true); setImportMsg(null)
    try {
      const { itens: rawNewItems, grupos } = await parseCarteiraXlsx(file, fallbackLoja)

      // Enrich with catalog prices — priceMap is filtered to rawItems codes, so also
      // check the full price map (saved separately) for Carteira items not in stock report
      const fullPM = getFullPriceMap()
      const getPrice = code => priceMap?.get(code)?.pv || fullPM.get(code)?.pv || 0
      const newItems = rawNewItems.map(item => ({
        ...item,
        pv: getPrice(item.code),
      }))

      // 1. Update sc_orders for suggestion calculation
      const kept = (orders||[]).filter(o => o.source !== 'carteira')
      onUpdateOrders?.([...kept, ...newItems])

      // 2. Retroactive linking: update arrivalDate on approved history entries that match carteira (±2 days)
      const currentHistory = getHistory()
      let historyChanged = false
      const updatedHistory = currentHistory.map(h => {
        if (!h.fromRequest || h.arrivalDate) return h
        const ts = new Date(h.date).getTime()
        const match = newItems.find(o =>
          o.code === h.code && o.cityGroup === h.cityGroup &&
          Math.abs(new Date(o.date).getTime() - ts) <= 2 * 86400000
        )
        if (match?.arrivalDate) { historyChanged = true; return { ...h, arrivalDate: match.arrivalDate } }
        return h
      })
      if (historyChanged) {
        saveHistory(updatedHistory)
        onUpdateHistory?.(updatedHistory)
      }

      // 2. Upsert to Supabase pedidos for NF linking
      const lojasCnpj = [...new Set(grupos.map(g => g.lojaCnpj))]
      const { data: existing } = await sb.from('pedidos')
        .select('id,numero,loja_cnpj,status')
        .in('loja_cnpj', lojasCnpj)
        .eq('fornecedor','Intelbras')
      const existMap    = new Map((existing||[]).map(p => [`${p.numero}__${p.loja_cnpj}`, p]))
      const STATUS_RANK = { cancelado:-1, aguardando:0, parcial:1, faturado:2 }
      let inserted = 0, updated = 0

      for (const g of grupos) {
        const status = g.statusCalc
        const key    = `${g.ordem}__${g.lojaCnpj}`
        const exist  = existMap.get(key)
        let pedidoId = exist?.id

        if (pedidoId) {
          const existRank = STATUS_RANK[exist.status] ?? 0
          const newRank   = STATUS_RANK[status] ?? 0
          if (newRank > existRank || g.previsaoEntrega)
            await sb.from('pedidos').update({
              ...(newRank > existRank ? { status } : {}),
              ...(g.previsaoEntrega   ? { previsao_entrega: g.previsaoEntrega } : {}),
              updated_at: new Date().toISOString(),
            }).eq('id', pedidoId)
          updated++
        } else {
          const { data: ins, error: e1 } = await sb.from('pedidos').insert({
            numero:           g.ordem,
            data_pedido:      g.dataPedido,
            loja_cnpj:        g.lojaCnpj,
            fornecedor:       'Intelbras',
            status,
            previsao_entrega: g.previsaoEntrega || null,
            created_by:       userName || '',
          }).select('id').maybeSingle()
          if (e1) throw e1
          pedidoId = ins.id
          inserted++
        }

        await sb.from('pedido_itens').delete().eq('pedido_id', pedidoId)
        const itensRows = g.itens
          .filter(i => i.codigo && i.quantidade > 0)
          .map(i => ({ pedido_id: pedidoId, codigo: i.codigo, descricao: i.descricao, quantidade: i.quantidade, valor_unit_centavos: Math.round(getPrice(i.codigo) * 100) }))
        if (itensRows.length) await sb.from('pedido_itens').insert(itensRows)
      }

      const belCount = newItems.filter(i => i.cityGroup === 'BELTRAO').length
      const tolCount = newItems.filter(i => i.cityGroup === 'TOLEDO').length
      const progCnt  = newItems.filter(i => i.isProgrammed).length
      setImportMsg({ type:'success',
        text:`✅ Carteira: ${newItems.length} item(s) — Beltrão: ${belCount}, Toledo: ${tolCount}${progCnt>0?` · ${progCnt} programado(s)`:''} · ${inserted} pedido(s) criado(s), ${updated} atualizado(s)`,
      })
      load()
      loadSupabasePedidosForStatus().catch(()=>{})
    } catch(err) {
      setImportMsg({ type:'error', text:'Erro Carteira: '+err.message })
    } finally {
      setImportingCarteira(false)
      if (carteiraFileRef.current) carteiraFileRef.current.value = ''
    }
  }

  const doLimparManuais = () => {
    // IDs dos pedidos manuais (não-carteira, não-recebidos)
    const manualIds = new Set((orders||[]).filter(o => o.source !== 'carteira' && !o.receivedAt).map(o => o.id))
    const kept = (orders||[]).filter(o => o.source === 'carteira' || o.receivedAt)
    onUpdateOrders?.(kept)

    // Remove também do purchaseHistory para não aparecer no Financeiro
    // Preserva entradas com fromRequest (solicitações aprovadas) mesmo que estejam em manualIds
    const currentHistory = getHistory()
    const newHistory = currentHistory.filter(h => !manualIds.has(h.id) || h.fromRequest)
    if (newHistory.length < currentHistory.length) {
      saveHistory(newHistory)
      onUpdateHistory?.(newHistory)
    }

    setConfirmClearManuais(false)
    setImportMsg({ type:'success', text:`✅ ${manualIds.size} pedido(s) manual(is) removido(s). ${kept.filter(o=>o.source==='carteira').length} item(s) da Carteira mantido(s).` })
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
            <button className="btn btn-sm btn-yellow" onClick={()=>nfFileRef.current?.click()} disabled={importingNF||importingCarteira}>
              {importingNF ? '⏳ NF...' : '📥 Importar NF'}
            </button>
            <input ref={nfFileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}}
              onChange={e=>{ if(e.target.files[0]) doImportNF(e.target.files[0]) }}/>
            <button className="btn btn-sm btn-yellow" onClick={()=>carteiraFileRef.current?.click()} disabled={importingNF||importingCarteira}>
              {importingCarteira ? '⏳ Carteira...' : '📋 Importar Carteira'}
            </button>
            <input ref={carteiraFileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}}
              onChange={e=>{ if(e.target.files[0]) doImportCarteira(e.target.files[0]) }}/>
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

      {/* ── CARTEIRA DETALHADO ── */}
      <div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:'var(--r)',padding:'12px 16px'}}>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <span style={{fontFamily:'var(--mono)',fontSize:11,fontWeight:700,color:'var(--accent)',letterSpacing:'0.05em'}}>CARTEIRA DETALHADO</span>
          {carteiraItems.length > 0 && (
            <>
              <span style={{fontSize:11,color:'var(--success)',background:'var(--success-bg)',border:'1px solid var(--success)',padding:'1px 6px',fontFamily:'var(--mono)'}}>
                {carteiraItems.length}
              </span>
              <span style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--mono)'}}>
                Beltrão: {carteiraItems.filter(i=>i.cityGroup==='BELTRAO').length} · Toledo: {carteiraItems.filter(i=>i.cityGroup==='TOLEDO').length}
                {carteiraItems.filter(i=>i.isProgrammed).length > 0 && ` · ${carteiraItems.filter(i=>i.isProgrammed).length} programado(s)`}
              </span>
            </>
          )}
          <div style={{flex:1}}/>
          {carteiraItems.length > 0 && (
            <button className="btn btn-sm btn-ghost" onClick={()=>setShowCarteira(v=>!v)}>
              {showCarteira ? '▲ Ocultar' : '▼ Ver itens'}
            </button>
          )}
          {manualCount > 0 && (
            <button className="btn btn-sm btn-ghost" style={{color:'var(--danger)',borderColor:'var(--danger)'}}
              onClick={()=>setConfirmClearManuais(true)}>
              🗑 Limpar Manuais ({manualCount})
            </button>
          )}
        </div>

        {confirmClearManuais && (
          <div style={{marginTop:10,background:'var(--danger-bg)',border:'1px solid var(--danger)',borderRadius:'var(--r)',padding:'10px 14px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
            <span style={{fontSize:12,color:'var(--danger)',flex:1}}>
              Remover {manualCount} pedido(s) manual(is) do cálculo de sugestão? Itens da Carteira e recebidos serão mantidos.
            </span>
            <button className="btn btn-sm btn-danger" onClick={doLimparManuais}>Confirmar</button>
            <button className="btn btn-sm btn-ghost" onClick={()=>setConfirmClearManuais(false)}>Cancelar</button>
          </div>
        )}

        {showCarteira && carteiraItems.length > 0 && (
          <div style={{marginTop:12,overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth:620}}>
              <thead>
                <tr style={{borderBottom:'1px solid var(--border)'}}>
                  <th style={{padding:'5px 8px',textAlign:'left',color:'var(--muted)',fontWeight:700,fontSize:11}}>Pedido</th>
                  <th style={{padding:'5px 8px',textAlign:'left',color:'var(--muted)',fontWeight:700,fontSize:11}}>Código</th>
                  <th style={{padding:'5px 8px',textAlign:'left',color:'var(--muted)',fontWeight:700,fontSize:11}}>Descrição</th>
                  <th style={{padding:'5px 8px',textAlign:'left',color:'var(--muted)',fontWeight:700,fontSize:11}}>Cidade</th>
                  <th style={{padding:'5px 8px',textAlign:'right',color:'var(--muted)',fontWeight:700,fontSize:11}}>Qtd</th>
                  <th style={{padding:'5px 8px',textAlign:'left',color:'var(--muted)',fontWeight:700,fontSize:11}}>Tipo</th>
                </tr>
              </thead>
              <tbody>
                {carteiraItems.map((item, idx) => (
                  <tr key={item.id} style={{borderBottom:'1px solid var(--border2)',background:idx%2===0?'var(--card)':'var(--card2)'}}>
                    <td style={{padding:'4px 8px',fontFamily:'var(--mono)',color:'var(--accent)',whiteSpace:'nowrap',fontSize:11}}>{item.pedidoParceiro}</td>
                    <td style={{padding:'4px 8px',fontFamily:'var(--mono)',fontSize:11}}>{item.code}</td>
                    <td style={{padding:'4px 8px',maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={item.description}>{item.description||'—'}</td>
                    <td style={{padding:'4px 8px',whiteSpace:'nowrap',fontSize:11}}>{item.cityGroup==='BELTRAO'?'Beltrão':'Toledo'}</td>
                    <td style={{padding:'4px 8px',textAlign:'right',fontWeight:700}}>{item.qty}</td>
                    <td style={{padding:'4px 8px'}}>
                      {item.isProgrammed
                        ? <span style={{fontSize:10,color:'var(--info)',background:'var(--info-bg)',padding:'1px 6px',borderRadius:3,fontWeight:600}}>Programado</span>
                        : <span style={{fontSize:10,color:'var(--muted)',background:'var(--card2)',padding:'1px 6px',borderRadius:3}}>Normal</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {carteiraItems.length === 0 && (
          <div style={{marginTop:8,fontSize:11,color:'var(--muted)',fontFamily:'var(--mono)'}}>
            Nenhuma Carteira importada. Exporte do Portal Intelbras → Relatórios → Carteira Detalhado e importe o arquivo Excel aqui.
          </div>
        )}
      </div>

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

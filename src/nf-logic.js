import { normCnpj, UF_DAYS } from './constants.js'
import { sb, sbFetchAll } from './supabase.js'

// Cache de pedidos Supabase para status dos vendedores (código__cityGroup → {status, previsao_entrega})
export let _supabasePedidosCodeMap = new Map()
// Ordens faturadas com previsão de entrega futura — descontam da sugestão de compra
// (cada item é uma "ordem" sintética: {code, cityGroup, qty, arrivalDate, source:'faturado', pedido})
export let _supabaseFaturadoOrders = []
// Mapeamento direto CNPJ → cityGroup (mesmo padrão usado em getProductStatus)
export const CNPJ_TO_CITYGROUP = {
  '35369505000102': 'BELTRAO', // Francisco Beltrão
  '35369505000374': 'TOLEDO',  // Toledo
}
export async function loadSupabasePedidosForStatus() {
  const since = new Date(); since.setDate(since.getDate() - 90)
  const sinceIso = since.toISOString().slice(0,10)
  const map = new Map()

  const nowTs = Date.now()
  const faturadoOrders = []

  // Pedidos mais recentes primeiro; status pendente tem prioridade sobre faturado
  const STATUS_PRIORITY = { aguardando: 0, parcial: 1, faturado: 2 }
  const pedidos = await sbFetchAll(() => sb.from('pedidos')
    .select('numero, status, loja_cnpj, data_pedido, previsao_entrega, pedido_itens(codigo, quantidade), notas_fiscais(data_emissao)')
    .in('status', ['aguardando','parcial','faturado'])
    .gte('data_pedido', sinceIso)
    .order('id', { ascending: true }))
  for (const p of (pedidos||[])) {
    const cityGroup = CNPJ_TO_CITYGROUP[normCnpj(p.loja_cnpj||'')] || ''
    if (!cityGroup) continue
    // Data de faturamento = emissão da NF vinculada mais recente (fallback: data do pedido)
    const nfDates = (p.notas_fiscais||[]).map(n=>n.data_emissao).filter(Boolean).sort()
    const faturadoEm = nfDates.length ? nfDates[nfDates.length-1] : (p.data_pedido || null)
    for (const it of (p.pedido_itens||[])) {
      if (!it.codigo) continue
      const key = `${it.codigo}__${cityGroup}`
      const ex = map.get(key)
      const exPri = ex ? (STATUS_PRIORITY[ex.status] ?? 99) : 99
      const newPri = STATUS_PRIORITY[p.status] ?? 99
      // Pendente bate faturado; dentro do mesmo status, o mais recente (DESC) já vem primeiro
      if (!ex || newPri < exPri) map.set(key, { status: p.status, previsao_entrega: p.previsao_entrega, faturado_em: faturadoEm })
    }
    // Desconto: só pedidos faturados com previsão de entrega futura (ainda em trânsito)
    if (p.status === 'faturado' && p.previsao_entrega && new Date(p.previsao_entrega).getTime() > nowTs) {
      for (const it of (p.pedido_itens||[])) {
        if (!it.codigo || !(it.quantidade > 0)) continue
        faturadoOrders.push({
          id: `faturado_${p.numero}_${it.codigo}`,
          code: it.codigo, cityGroup, qty: it.quantidade,
          arrivalDate: p.previsao_entrega, source: 'faturado', pedido: String(p.numero||''),
          date: faturadoEm || p.data_pedido || null,
        })
      }
    }
  }

  // NFs sem pedido vinculado — também geram previsão de chegada
  const nfsSemPedido = await sbFetchAll(() => sb.from('notas_fiscais')
    .select('numero, loja_cnpj, data_emissao, previsao_chegada, nf_itens(codigo, quantidade)')
    .eq('status_vinculo', 'sem_pedido')
    .gte('data_emissao', sinceIso)
    .order('id', { ascending: true }))
  for (const nf of (nfsSemPedido||[])) {
    const cityGroup = CNPJ_TO_CITYGROUP[normCnpj(nf.loja_cnpj||'')] || ''
    if (!cityGroup) continue
    for (const it of (nf.nf_itens||[])) {
      if (!it.codigo) continue
      const key = `${it.codigo}__${cityGroup}`
      if (!map.has(key)) map.set(key, { status: 'faturado', previsao_entrega: nf.previsao_chegada, faturado_em: nf.data_emissao||null })
    }
    // Desconto: NF sem pedido com previsão de chegada futura
    if (nf.previsao_chegada && new Date(nf.previsao_chegada).getTime() > nowTs) {
      for (const it of (nf.nf_itens||[])) {
        if (!it.codigo || !(it.quantidade > 0)) continue
        faturadoOrders.push({
          id: `faturado_nf_${nf.numero}_${it.codigo}`,
          code: it.codigo, cityGroup, qty: it.quantidade,
          arrivalDate: nf.previsao_chegada, source: 'faturado', pedido: `NF${nf.numero}`,
          date: nf.data_emissao || null,
        })
      }
    }
  }

  _supabasePedidosCodeMap = map
  _supabaseFaturadoOrders = faturadoOrders
  return faturadoOrders
}

// CNPJ de fornecedores conhecidos → UF (fallback quando XML não traz enderEmit)
export const CNPJ_UF_MAP = {
  '82901000000127': 'SC', // Intelbras São José SC (fábrica)
  '82901000000208': 'AM', // Intelbras Manaus AM (ZFM)
  '82901000001441': 'SC', // Intelbras filial SC
  '82901000001522': 'SC', // Intelbras filial SC
  '82901000001603': 'SC', // Intelbras filial SC
  '82901000002413': 'SC', // Intelbras filial SC
  '82901000002928': 'SC', // Intelbras filial SC
}

export function detectarUF(emitCnpj, emitUfXml) {
  if (emitUfXml) return emitUfXml.toUpperCase()
  return CNPJ_UF_MAP[normCnpj(emitCnpj||'')] || 'SC'
}

export function addDiasUteis(dataIso, dias) {
  if (!dataIso) return null
  let d = new Date(dataIso + 'T12:00:00')
  let added = 0
  while (added < dias) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() !== 0 && d.getDay() !== 6) added++
  }
  return d.toISOString().slice(0,10)
}

export function calcPrevisaoChegada(dataEmissao, emitUf) {
  if (!dataEmissao) return null
  const uf = (emitUf||'SC').toUpperCase()
  return addDiasUteis(dataEmissao, UF_DAYS[uf] || UF_DAYS.SC)
}

export function calcScoreVinculo(nf, pedido) {
  let score = 0; const motivos = []

  const nfCods  = new Set((nf.nf_itens||[]).map(i=>i.codigo).filter(Boolean))
  const pedCods = new Set((pedido.pedido_itens||[]).map(i=>i.codigo).filter(Boolean))
  const match   = [...nfCods].filter(c=>pedCods.has(c))
  if (match.length === 0) return { score: 0, motivos: [], codsMatch: [] }
  score += 50; motivos.push(`Código(s) ${match.slice(0,3).join(',')}`)

  const nfQ={}, pedQ={}
  ;(nf.nf_itens||[]).forEach(i=>{ if(i.codigo) nfQ[i.codigo]=(nfQ[i.codigo]||0)+(parseFloat(i.quantidade)||0) })
  ;(pedido.pedido_itens||[]).forEach(i=>{ if(i.codigo) pedQ[i.codigo]=(pedQ[i.codigo]||0)+(parseFloat(i.quantidade)||0) })
  const qtdOk = match.every(c => nfQ[c] > 0 && nfQ[c] <= (pedQ[c]||0) * 1.05)
  if (qtdOk) { score += 30; motivos.push('Qtd ≤ pedido') }
  else        { motivos.push('Qtd excede pedido') }

  if (nf.data_emissao && pedido.data_pedido) {
    const diff = (new Date(nf.data_emissao) - new Date(pedido.data_pedido)) / 86400000
    if (diff >= 0 && diff <= 90) { score += 20; motivos.push(`Data +${Math.round(diff)}d`) }
  }

  return { score, motivos, codsMatch: match }
}

export function calcScoreManual(nf, pedido) {
  let score = 0; const motivos = []

  if (!nf.data_emissao || !pedido.data_pedido) return { score: 0, motivos: [] }
  const diff = (new Date(nf.data_emissao) - new Date(pedido.data_pedido)) / 86400000
  if (diff < 0 || diff > 90) return { score: 0, motivos: [] }
  score += 40; motivos.push(`Data +${Math.round(diff)}d após pedido`)

  const nfQtd  = (nf.nf_itens||[]).reduce((s,i)=>s+(parseFloat(i.quantidade)||0), 0)
  const pedQtd = (pedido.pedido_itens||[]).reduce((s,i)=>s+(parseFloat(i.quantidade)||0), 0)
  if (nfQtd > 0 && pedQtd > 0 && Math.abs(nfQtd-pedQtd)/pedQtd <= 0.05) {
    score += 60; motivos.push(`Qtd total ${nfQtd}/${pedQtd}`)
  }

  return { score, motivos }
}

export function checkFaturamentoParcial(nf, pedidoItens) {
  const nfQ = {}
  ;(nf.nf_itens||[]).forEach(i=>{ if(i.codigo) nfQ[i.codigo]=parseFloat(i.quantidade)||0 })
  return (pedidoItens||[]).some(pi=>{
    const q = nfQ[pi.codigo]||0
    return q > 0 && q < (parseFloat(pi.quantidade)||0)
  })
}

export async function aplicarFaturamentoParcial(nf, pedido) {
  const nfQ = {}
  ;(nf.nf_itens||[]).forEach(i=>{ if(i.codigo) nfQ[i.codigo]=parseFloat(i.quantidade)||0 })
  const itensA=[], itensB=[]
  for (const it of (pedido.pedido_itens||[])) {
    const q = nfQ[it.codigo]||0, qp = parseFloat(it.quantidade)||0
    if (q >= qp)       itensA.push({...it})
    else if (q > 0)  { itensA.push({...it,quantidade:q}); itensB.push({...it,quantidade:qp-q}) }
    else               itensB.push({...it})
  }
  const previsao = calcPrevisaoChegada(nf.data_emissao, detectarUF(nf.emit_cnpj, nf.emit_uf))
  await sb.from('pedidos').update({ status:'faturado', previsao_entrega:previsao, updated_at:new Date().toISOString() }).eq('id',pedido.id)
  if (itensB.length) {
    const { data:pedB } = await sb.from('pedidos').insert({
      numero: pedido.numero+'-R', data_pedido:pedido.data_pedido,
      loja_cnpj:pedido.loja_cnpj, fornecedor:pedido.fornecedor,
      fornecedor_cnpj:pedido.fornecedor_cnpj||'', status:'aguardando',
      observacoes:`Restante do pedido ${pedido.numero} após faturamento parcial em ${new Date().toLocaleDateString('pt-BR')}`,
      created_by:pedido.created_by||'',
    }).select('id').maybeSingle()
    if (pedB?.id) await sb.from('pedido_itens').insert(itensB.map(i=>({
      pedido_id:pedB.id, codigo:i.codigo||'', descricao:i.descricao||'',
      quantidade:i.quantidade, valor_unit_centavos:i.valor_unit_centavos||0,
    })))
  }
  await sb.from('vinculo_log').insert({ nf_id:nf.id, pedido_id:pedido.id,
    evento:'faturamento_parcial', detalhe:`NF ${nf.numero} faturamento parcial — restante criado como ${pedido.numero}-R` })
}

export async function executarMotorVinculo(onProgress, incluirSemPedido=true, incluirVinculados=false) {
  const statusFiltro = incluirVinculados
    ? ['pendente','sem_pedido','sugerido','vinculado']
    : ['pendente','sem_pedido']
  const pedidoStatus = incluirVinculados
    ? ['aguardando','parcial','faturado']
    : ['aguardando','parcial']

  const sinceNf  = new Date(); sinceNf.setDate(sinceNf.getDate() - 90)
  const sincePed = new Date(); sincePed.setDate(sincePed.getDate() - 120)

  const { data: notas } = await sb.from('notas_fiscais')
    .select('*, nf_itens(*)')
    .in('status_vinculo', statusFiltro)
    .gte('data_emissao', sinceNf.toISOString().slice(0,10))
    .not('data_emissao','is',null)

  const { data: todosPedidos } = await sb.from('pedidos')
    .select('*, pedido_itens(*)')
    .gte('data_pedido', sincePed.toISOString().slice(0,10))
    .in('status', pedidoStatus)

  const pedidosPDF     = (todosPedidos||[]).filter(p =>  p.fornecedor_cnpj)
  const pedidosManuais = (todosPedidos||[]).filter(p => !p.fornecedor_cnpj)

  const results = []; const total = (notas||[]).length
  for (let i=0; i<total; i++) {
    const nf = notas[i]
    onProgress?.(i+1, total, nf.numero||'?')

    const nfLoja   = normCnpj(nf.loja_cnpj||'')
    const uf       = detectarUF(nf.emit_cnpj, nf.emit_uf)
    const previsao = calcPrevisaoChegada(nf.data_emissao, uf)
    const byLoja   = p => { const pl = normCnpj(p.loja_cnpj||''); return !nfLoja || !pl || pl === nfLoja }

    const scores1 = pedidosPDF.filter(byLoja)
      .map(p => ({ pedido:p, ...calcScoreVinculo(nf,p) }))
      .filter(s => s.score > 0)
      .sort((a,b) => b.score - a.score)

    const melhor1  = scores1[0]
    const score1   = melhor1?.score || 0

    let statusVinculo, pedidoId=null, acaoNecessaria='', faturamentoParcial=false
    let scoreEf=0, motivoEf='Sem candidato', pedidoEf=null

    const ambiguo1 = score1 >= 40 && scores1[1]?.score === score1

    if (ambiguo1) {
      statusVinculo = 'sugerido'; pedidoId = melhor1.pedido.id
      acaoNecessaria = `Múltiplos candidatos PDF (score ${score1}) — escolha manual`
      scoreEf = score1; motivoEf = melhor1.motivos.join(' + '); pedidoEf = melhor1.pedido
    } else if (score1 >= 80) {
      pedidoId = melhor1.pedido.id; pedidoEf = melhor1.pedido
      faturamentoParcial = checkFaturamentoParcial(nf, melhor1.pedido.pedido_itens)
      if (faturamentoParcial) {
        await aplicarFaturamentoParcial(nf, melhor1.pedido)
      } else {
        await sb.from('pedidos').update({ status:'faturado', previsao_entrega:previsao, updated_at:new Date().toISOString() }).eq('id',pedidoId)
      }
      statusVinculo = 'vinculado'; acaoNecessaria = ''
      scoreEf = score1; motivoEf = melhor1.motivos.join(' + ')
    } else if (score1 >= 40) {
      pedidoId = melhor1.pedido.id; statusVinculo = 'sugerido'
      acaoNecessaria = 'Confirmar vínculo (xPed encontrado)'
      scoreEf = score1; motivoEf = melhor1.motivos.join(' + '); pedidoEf = melhor1.pedido
    } else {
      const scores2 = pedidosManuais.filter(byLoja)
        .map(p => ({ pedido:p, ...calcScoreManual(nf,p) }))
        .filter(s => s.score >= 60)
        .sort((a,b) => b.score - a.score)

      const melhor2 = scores2[0]
      if (melhor2) {
        pedidoId = melhor2.pedido.id; statusVinculo = 'sugerido'
        acaoNecessaria = 'Pedido manual — data e qtd batem, confirme'
        scoreEf = melhor2.score; motivoEf = melhor2.motivos.join(' + ') + ' [manual]'
        pedidoEf = melhor2.pedido
        await sb.from('pedidos').update({ previsao_entrega: previsao, updated_at:new Date().toISOString() }).eq('id',pedidoId)
      } else {
        statusVinculo = 'sem_pedido'; acaoNecessaria = ''
      }
    }

    await sb.from('notas_fiscais').update({
      pedido_id: pedidoId, status_vinculo: statusVinculo,
      score_confianca: scoreEf, vinculo_motivo: motivoEf,
      previsao_chegada: previsao, acao_necessaria: acaoNecessaria,
      emit_uf: uf,
    }).eq('id',nf.id)
    await sb.from('vinculo_log').insert({ nf_id:nf.id, pedido_id:pedidoId,
      evento:statusVinculo, score_confianca:scoreEf, detalhe:motivoEf })

    results.push({ nf_numero:`${nf.numero}/${nf.serie}`, status:statusVinculo,
      pedido_vinculado:pedidoEf?.numero||null, score_confianca:scoreEf, motivo:motivoEf,
      faturamento_parcial:faturamentoParcial, previsao_chegada:previsao,
      acao_necessaria:acaoNecessaria||null })
  }
  return results
}

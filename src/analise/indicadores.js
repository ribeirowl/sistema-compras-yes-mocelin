// Indicadores do "Resumo do turno". TODO número que a IA cita sai daqui —
// ela só redige e prioriza; não calcula nada. Mantém as listas curtas (top N)
// para o pedido ao Claude ficar pequeno e barato.
import { consolidateRawItems } from '../rules.js'

const LIMITE_PCT = 0.725
const COBERTURA_ALVO = 45
const r1 = v => Math.round(v * 10) / 10
const r0 = v => Math.round(v)
const fromC = v => (parseInt(v) || 0) / 100
const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const ehUtil = d => d.getDay() !== 0 && d.getDay() !== 6
const LOJAS = { BELTRAO: 'Beltrão + DV', TOLEDO: 'Toledo' }

// Dias úteis do mês até hoje (inclusive) e no mês inteiro
export function diasUteisMes(hoje = new Date()) {
  const y = hoje.getFullYear(), m = hoje.getMonth()
  let total = 0, passados = 0
  for (let d = new Date(y, m, 1); d.getMonth() === m; d.setDate(d.getDate() + 1)) {
    if (!ehUtil(d)) continue
    total++
    if (d.getDate() <= hoje.getDate()) passados++
  }
  return { total, passados: Math.max(1, passados) }
}

// ── 1. Ritmo do limite ─────────────────────────────────────────────
// finData: { 'AAAA-MM': {BELTRAO, TOLEDO, outrosX, reaisX} } em centavos
// nfs:     [{data:'AAAA-MM-DD', loja:'BELTRAO'|'TOLEDO', valor:R$}] (NFs Intelbras importadas)
export function ritmoLimite(finData, nfs, hoje = new Date()) {
  const mesAtual = isoLocal(hoje).slice(0, 7)
  const { total, passados } = diasUteisMes(hoje)
  const fracMes = passados / total

  // NFs por loja/mês e por dia (mês atual)
  const nfMes = {}, nfDia = { BELTRAO: {}, TOLEDO: {} }
  for (const n of nfs || []) {
    const m = n.data.slice(0, 7)
    nfMes[m] ??= { BELTRAO: 0, TOLEDO: 0 }
    nfMes[m][n.loja] += n.valor
    if (m === mesAtual) nfDia[n.loja][n.data] = (nfDia[n.loja][n.data] || 0) + n.valor
  }

  // Ritmo dos últimos 5 dias úteis (Intelbras, por NF)
  const ult5 = []
  for (let d = new Date(hoje); ult5.length < 5 && d.getMonth() === hoje.getMonth(); d.setDate(d.getDate() - 1))
    if (ehUtil(d)) ult5.push(isoLocal(d))

  const lojas = {}
  for (const k of ['BELTRAO', 'TOLEDO']) {
    const fin = finData?.[mesAtual] || {}
    const fat = fromC(fin[k])
    const limite = fat * LIMITE_PCT
    // Faturamento digitado é o acumulado do mês: projeta o fechamento pelo ritmo
    const fatProj = fracMes > 0 ? fat / fracMes : fat
    const limiteProj = fatProj * LIMITE_PCT
    const nf = nfMes[mesAtual]?.[k] || 0
    const outros = fromC(fin[`outros${k}`])
    const intelbras = nf + outros
    const ritmoDia5 = ult5.reduce((s, d) => s + (nfDia[k][d] || 0), 0) / Math.max(1, ult5.length)
    const restantes = total - passados
    const intelbrasProj = intelbras + ritmoDia5 * restantes
    let diaEstouro = null
    if (limiteProj > 0 && ritmoDia5 > 0 && intelbrasProj > limiteProj) {
      let acum = intelbras
      for (let d = new Date(hoje); d.getMonth() === hoje.getMonth(); ) {
        d.setDate(d.getDate() + 1)
        if (!ehUtil(d)) continue
        acum += ritmoDia5
        if (acum > limiteProj) { diaEstouro = d.getDate(); break }
      }
    }
    const reais = fromC(fin[`reais${k}`])
    lojas[k] = {
      loja: LOJAS[k],
      faturamento_mes_ate_hoje: r0(fat),
      faturamento_projetado_fechamento: r0(fatProj),
      limite_ate_hoje: r0(limite),
      limite_projetado_fechamento: r0(limiteProj),
      compras_intelbras: {
        total_ate_hoje: r0(intelbras),
        pct_do_limite_usado: limite > 0 ? r1(intelbras / limite * 100) : null,
        ritmo_medio_dia_util_ultimos_5: r0(ritmoDia5),
        projecao_fechamento: r0(intelbrasProj),
        projecao_pct_do_limite: limiteProj > 0 ? r1(intelbrasProj / limiteProj * 100) : null,
        dia_estimado_para_estourar: diaEstouro,
      },
      entradas_todos_fornecedores: {
        total_ate_hoje: r0(reais),
        pct_do_limite_usado: limite > 0 && reais > 0 ? r1(reais / limite * 100) : null,
        uso_do_faturamento_pct: fat > 0 && reais > 0 ? r1(reais / fat * 100) : null,
      },
    }
  }

  // Histórico mensal (últimos 6 meses fechados) para comparar
  const meses = Object.keys(finData || {}).filter(m => m < mesAtual).sort().slice(-6)
  const historico = meses.map(m => {
    const f = finData[m]
    const fat = fromC(f.BELTRAO) + fromC(f.TOLEDO)
    const ent = fromC(f.reaisBELTRAO) + fromC(f.reaisTOLEDO)
    const intel = (nfMes[m]?.BELTRAO || 0) + (nfMes[m]?.TOLEDO || 0) + fromC(f.outrosBELTRAO) + fromC(f.outrosTOLEDO)
    return {
      mes: m, faturamento: r0(fat), entradas: r0(ent), compras_intelbras: r0(intel),
      uso_entradas_pct: fat > 0 && ent > 0 ? r1(ent / fat * 100) : null,
      uso_intelbras_pct: fat > 0 ? r1(intel / fat * 100) : null,
    }
  })
  const comUso = historico.filter(h => h.uso_entradas_pct != null)
  const mediaUso = comUso.length ? r1(comUso.reduce((s, h) => s + h.uso_entradas_pct, 0) / comUso.length) : null
  const comFat = historico.filter(h => h.faturamento > 0)
  const mediaFat = comFat.length ? r0(comFat.reduce((s, h) => s + h.faturamento, 0) / comFat.length) : null

  return {
    mes: mesAtual,
    dias_uteis: { passados, total, pct_mes_decorrido: r1(fracMes * 100) },
    limite_pct_faturamento: 72.5, atencao_pct_faturamento: 62,
    lojas, historico_mensal: historico,
    media_uso_entradas_ultimos_meses_pct: mediaUso,
    media_faturamento_mensal_ultimos_meses: mediaFat,
  }
}

// ── Curva ABC por valor de giro (média mês × preço), por loja ─────────
function curvaABC(itens, priceMap) {
  const curva = new Map()
  for (const loja of ['BELTRAO', 'TOLEDO']) {
    const l = itens.filter(i => i.cityGroup === loja)
      .map(i => ({ i, v: (i.avgMonthly || 0) * (priceMap?.get(i.code)?.pv || 0) }))
      .filter(x => x.v > 0).sort((a, b) => b.v - a.v)
    const tot = l.reduce((s, x) => s + x.v, 0)
    // Classe pelo acumulado ANTES do item: quem cruza os 80% ainda é A
    let antes = 0
    for (const x of l) {
      curva.set(`${loja}__${x.i.code}`, antes / tot < 0.8 ? 'A' : antes / tot < 0.95 ? 'B' : 'C')
      antes += x.v
    }
  }
  return curva
}

const cobertura = i => {
  const disp = Math.max(0, (i.stock || 0) - (i.reserved || 0))
  const dia = (i.avgMonthly || 0) / 30
  return dia > 0 ? disp / dia : Infinity
}

// ── 2. Ruptura: curva A acabando em até 7 dias ───────────────────────
export function ruptura(rawItems, priceMap, tabItems, discMap) {
  const itens = consolidateRawItems(rawItems || []).filter(i => !discMap?.has(i.code))
  const curva = curvaABC(itens, priceMap)
  const sugestao = new Map(Object.values(tabItems || {}).flat().map(t => [t.id, t]))
  const lista = itens
    .filter(i => curva.get(`${i.cityGroup}__${i.code}`) === 'A' && cobertura(i) <= 7)
    .map(i => {
      const t = sugestao.get(`${i.cityGroup}__${i.code}`)
      return {
        loja: LOJAS[i.cityGroup], codigo: i.code, descricao: (i.description || '').slice(0, 60),
        dias_de_estoque: r1(cobertura(i)), media_mes: r0(i.avgMonthly),
        a_caminho: r0(t?.orderedQty || 0), sugestao_compra: r0(t?.adjustedQty || 0),
      }
    })
    .sort((a, b) => a.dias_de_estoque - b.dias_de_estoque)
  const semPedido = lista.filter(x => x.a_caminho <= 0)
  return {
    total_curva_a_ate_7_dias: lista.length,
    sem_pedido_nem_nf_a_caminho: semPedido.length,
    por_loja: { 'Beltrão + DV': lista.filter(x => x.loja === LOJAS.BELTRAO).length, Toledo: lista.filter(x => x.loja === LOJAS.TOLEDO).length },
    itens_sem_pedido: semPedido.slice(0, 15),
    itens_com_pedido: lista.filter(x => x.a_caminho > 0).slice(0, 8),
  }
}

// ── 3. Conferências ─────────────────────────────────────────────────
export function conferencias({ nfs, faturadoOrders, fatRecebidos, discMap, dataDate, tabItems }, hoje = new Date()) {
  // a) Dias úteis recentes sem nenhuma NF importada (ex.: o 30/09 que faltou)
  const dias = new Set((nfs || []).map(n => n.data))
  const semNF = []
  for (let d = new Date(hoje), n = 0; n < 12; ) {
    d.setDate(d.getDate() - 1)
    if (!ehUtil(d)) continue
    n++
    if (!dias.has(isoLocal(d))) semNF.push(isoLocal(d))
  }
  // b) NFs faturadas com previsão vencida que ainda não deram entrada (subida de estoque)
  const hojeIso = isoLocal(hoje)
  const vencidas = (faturadoOrders || [])
    .filter(f => f.arrivalDate && String(f.arrivalDate).slice(0, 10) < hojeIso && !fatRecebidos?.[f.id])
    .map(f => ({ nf: f.nf || f.pedido, codigo: f.code, loja: LOJAS[f.cityGroup], qtd: f.qty, previsao: String(f.arrivalDate).slice(0, 10) }))
  // c) Relatório de estoque desatualizado
  let diasSemAtualizar = null
  if (dataDate) {
    diasSemAtualizar = 0
    for (let d = new Date(dataDate + 'T12:00:00'); isoLocal(d) < hojeIso; ) {
      d.setDate(d.getDate() + 1)
      if (ehUtil(d)) diasSemAtualizar++
    }
  }
  // d) Substituto que também saiu de linha (ex.: 4675050 → 4685000 → 4301425)
  const cadeias = []
  discMap?.forEach((v, code) => {
    let s = v.substitute, passos = [code], guard = 0
    while (s && discMap.has(s) && guard++ < 5) { passos.push(s); s = discMap.get(s).substitute }
    if (passos.length > 1) cadeias.push({ cadeia: [...passos, s || '(sem substituto)'].join(' → '), descricao: (v.description || '').slice(0, 50) })
  })
  // e) Substituto encerrado ainda com sugestão de compra
  const sugeridos = Object.values(tabItems || {}).flat().filter(t => t.adjustedQty > 0)
  const encerradosSugeridos = sugeridos.filter(t => discMap?.has(t.code)).map(t => ({ codigo: t.code, loja: LOJAS[t.cityGroup] }))
  return {
    dias_uteis_sem_nf_importada_ultimos_12: semNF,
    nfs_previsao_vencida_sem_entrada: { total: vencidas.length, itens: vencidas.slice(0, 10) },
    relatorio_estoque: { data_ultimo_upload: dataDate, dias_uteis_sem_atualizar: diasSemAtualizar },
    cadeias_de_substituicao: { total: cadeias.length, exemplos: cadeias.slice(0, 8) },
    encerrados_com_sugestao: encerradosSugeridos.slice(0, 10),
  }
}

// ── 4. Oportunidade: transferir entre lojas em vez de comprar ─────────
export function transferencias(rawItems, priceMap, discMap) {
  const itens = consolidateRawItems(rawItems || []).filter(i => !discMap?.has(i.code))
  const porCodigo = new Map()
  for (const i of itens) {
    porCodigo.set(i.code, { ...(porCodigo.get(i.code) || {}), [i.cityGroup]: i })
  }
  const lista = []
  for (const [code, p] of porCodigo) {
    if (!p.BELTRAO || !p.TOLEDO) continue
    for (const [de, para] of [['BELTRAO', 'TOLEDO'], ['TOLEDO', 'BELTRAO']]) {
      const o = p[de], d = p[para]
      const cobO = cobertura(o), cobD = cobertura(d)
      if (cobO < 90 || cobD >= 15) continue
      const dispO = Math.max(0, o.stock - o.reserved), dispD = Math.max(0, d.stock - d.reserved)
      const sobra = dispO - (o.avgMonthly / 30) * COBERTURA_ALVO
      const falta = (d.avgMonthly / 30) * COBERTURA_ALVO - dispD
      const qtd = Math.floor(Math.min(sobra, falta))
      if (qtd <= 0) continue
      const pv = priceMap?.get(code)?.pv || 0
      lista.push({
        codigo: code, descricao: (o.description || '').slice(0, 60),
        de: LOJAS[de], para: LOJAS[para], qtd_sugerida: qtd,
        dias_estoque_origem: cobO === Infinity ? 'sem giro' : r0(cobO), dias_estoque_destino: r1(cobD),
        valor_que_deixa_de_comprar: r0(qtd * pv),
      })
    }
  }
  lista.sort((a, b) => b.valor_que_deixa_de_comprar - a.valor_que_deixa_de_comprar)
  return {
    total: lista.length,
    valor_total_que_deixa_de_comprar: r0(lista.reduce((s, x) => s + x.valor_que_deixa_de_comprar, 0)),
    itens: lista.slice(0, 12),
  }
}

export function montarIndicadores(ctx, hoje = new Date()) {
  return {
    gerado_em: hoje.toISOString(),
    ritmo_do_limite: ritmoLimite(ctx.finData, ctx.nfs, hoje),
    ruptura: ruptura(ctx.rawItems, ctx.priceMap, ctx.tabItems, ctx.discMap),
    conferencias: conferencias(ctx, hoje),
    transferencias: transferencias(ctx.rawItems, ctx.priceMap, ctx.discMap),
  }
}

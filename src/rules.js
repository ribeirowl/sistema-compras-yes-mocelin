import { UF_DAYS, DAILY_LIMITS, DIAS_FATURAMENTO, DIAS_TOLERANCIA } from './constants.js'
import { normStr, addBizDays, todayStr, parseLocalDate } from './utils.js'
import { _supabasePedidosCodeMap } from './nf-logic.js'

export function getCityGroup(empresa) {
  const n = normStr(empresa)
  if (/^3\s*[-–]/.test(n) || n.includes('toled')) return 'TOLEDO'
  return 'BELTRAO'
}

export function consolidateRawItems(rawItems) {
  const groups = new Map()
  for (const item of rawItems) {
    const cityGroup = getCityGroup(item.empresa)
    const key = `${cityGroup}__${item.code}`
    if (!groups.has(key)) {
      groups.set(key, {
        ...item, cityGroup,
        suggestion:0, stock:0, reserved:0, avgMonthly:0, currentMonthSales:0,
        lastEntry: '',
        breakdown: [],
      })
    }
    const g = groups.get(key)
    g.suggestion          += item.suggestion
    g.stock               += item.stock
    g.reserved            += item.reserved
    g.avgMonthly          += item.avgMonthly
    g.currentMonthSales   += item.currentMonthSales || 0
    if ((item.lastEntry||'') > g.lastEntry) g.lastEntry = item.lastEntry
    g.breakdown.push({ label:item.empresa, suggestion:item.suggestion, stock:item.stock })
  }
  return [...groups.values()]
}

// ─── Fabricante ────────────────────────────────────────────
// A marca do relatório de estoque (coluna "Marca") é a fonte oficial. Tabela de preços, disponibilidade,
// encerramentos, carteira e prazos por UF são da Intelbras e só valem para itens Intelbras —
// códigos curtos de outros fabricantes podem coincidir com códigos Intelbras.
const _brandCache = new WeakMap()
export function stockBrandOf(code, rawItems) {
  if (!rawItems?.length) return ''
  let m = _brandCache.get(rawItems)
  if (!m) {
    m = new Map()
    for (const i of rawItems) if (i.brand && !m.has(i.code)) m.set(i.code, i.brand)
    _brandCache.set(rawItems, m)
  }
  return m.get(code) || ''
}
export const isIntelbrasBrand = b => normStr(b).includes('intelbras')
export function isIntelbrasItem(code, rawItems, priceMap, fallbackBrand='') {
  const b = stockBrandOf(code, rawItems) || fallbackBrand
  if (b) return isIntelbrasBrand(b)
  return !!priceMap?.has(code)   // sem marca no estoque: está na tabela Intelbras?
}

export function roundToMultiple(qty, mul) {
  return mul <= 1 ? qty : Math.ceil(qty / mul) * mul
}

export function getPriority(suggestion) {
  if (suggestion > 30) return 'ALTA'
  if (suggestion > 15) return 'MEDIA'
  if (suggestion > 5)  return 'NORMAL'
  return 'BAIXA'
}

// Prazo de trânsito (dias ÚTEIS) — regra única usada em todo o sistema:
// UF conhecida → UF_DAYS; UF desconhecida → SC para Intelbras, 10 para outras marcas.
export function transitDays(ufOrigem, brand) {
  const d = UF_DAYS[ufOrigem]
  if (d) return d
  return normStr(brand).includes('intelbras') ? UF_DAYS.SC : 10
}

// Previsão de chegada de algo AINDA NÃO FATURADO: dias para faturar + prazo de entrega da UF
export function previsaoAntesFaturar(dataBase, ufOrigem, brand) {
  return addBizDays(dataBase || todayStr(), DIAS_FATURAMENTO + transitDays(ufOrigem, brand))
}

const isoDate = d => d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : String(d||'').slice(0,10)

// Previsão vencida há mais de DIAS_TOLERANCIA dias úteis → sai do status/trânsito
export function previsaoExpirada(arrivalDate) {
  if (!arrivalDate) return false
  return todayStr() > isoDate(addBizDays(isoDate(arrivalDate), DIAS_TOLERANCIA))
}

// Última entrada (coluna "DT Ult Compra" do relatório de estoque) por código + loja
const _lastEntryCache = new WeakMap()
export function lastEntryOf(code, cityGroup, rawItems) {
  if (!rawItems?.length) return ''
  let m = _lastEntryCache.get(rawItems)
  if (!m) {
    m = new Map()
    for (const i of rawItems) {
      if (!i.lastEntry) continue
      const k = `${i.code}__${getCityGroup(i.empresa)}`
      if (i.lastEntry > (m.get(k)||'')) m.set(k, i.lastEntry)
    }
    _lastEntryCache.set(rawItems, m)
  }
  return m.get(`${code}__${cityGroup}`) || ''
}

// Houve entrada no ERP DEPOIS da compra? (faturado: a partir da data da NF)
export function entradaApos(lastEntry, refDate, inclusive=false) {
  if (!lastEntry || !refDate) return false
  const r = isoDate(refDate)
  return inclusive ? lastEntry >= r : lastEntry > r
}

export function orderedInTransit(code, cityGroup, orders, ufOrigem, brand, lastEntry='', intelbras=true) {
  const now = Date.now()
  return orders
    .filter(o => o.code === code && o.cityGroup === cityGroup && !o.receivedAt)
    .filter(o => !entradaApos(lastEntry, o.date, o.source === 'faturado'))
    .filter(o => {
      // Outro fabricante: carteira/NF Intelbras com o mesmo código não contam; compra vale 30 dias
      if (!intelbras) {
        if (o.source === 'carteira' || o.source === 'faturado') return false
        return (now - parseLocalDate(o.date).getTime()) / 86400000 < 30
      }
      if (o.source === 'carteira' || o.source === 'faturado') {
        if (o.arrivalDate) return !previsaoExpirada(o.arrivalDate)
        return true
      }
      const age = (now - parseLocalDate(o.date).getTime()) / 86400000
      // Pedido disponível imediato: conta como "em trânsito" até a MESMA previsão de chegada
      // mostrada nas telas (data do pedido + dias úteis). Antes comparava dias corridos com
      // dias úteis e o item voltava para a sugestão antes de chegar.
      if (o.availType === 'DISPONIVEL_IMEDIATO')
        return !previsaoExpirada(previsaoAntesFaturar(o.date, ufOrigem||o.ufOrigem, o.brand||brand))
      if (o.availType === 'DISPONIVEL_MES')      return age < 22
      return age < 30
    })
    .reduce((s, o) => s + (o.qty || 0), 0)
}

export function applyRules(rawItems, priceMap, discontinuedMap, orders) {
  const consolidated = consolidateRawItems(rawItems)
  const result = { BELTRAO:[], TOLEDO:[], OUTROS:[], MANUAL:[], SEM_PRECO:[] }

  for (const item of consolidated) {
    // Marca do estoque manda; sem marca, cai na tabela de preços / descrição
    const stockBrand = item.brand || ''
    const rawPrice   = priceMap.get(item.code)
    const isIntelbras= stockBrand ? isIntelbrasBrand(stockBrand)
      : (isIntelbrasBrand(rawPrice?.brand) || (!rawPrice?.brand && (!!rawPrice || normStr(item.description).includes('intelbras'))))
    // Encerramentos são da Intelbras: não esconder item de outro fabricante com código coincidente
    if (isIntelbras && discontinuedMap.has(item.code)) continue
    // Outro fabricante só usa a linha da tabela se ela for da MESMA marca (evita preço/UF/múltiplo de código Intelbras coincidente)
    const price      = isIntelbras || (rawPrice?.brand && normStr(rawPrice.brand) === normStr(stockBrand)) ? rawPrice : undefined
    const pv         = price?.pv ?? 0
    const brand      = stockBrand || price?.brand || ''
    const ufOrigem   = isIntelbras ? (price?.ufOrigem || '') : ''
    const multiple   = Math.max(1, price?.multiple ?? item.multiple ?? 1)
    const family     = price?.family || item.family || ''

    const inTransit    = orders?.length ? orderedInTransit(item.code, item.cityGroup, orders, ufOrigem, brand, item.lastEntry, isIntelbras) : 0
    const netSuggestion= Math.max(0, item.suggestion - inTransit)

    const adjustedQty= roundToMultiple(netSuggestion, multiple)
    const itemValue  = adjustedQty * pv

    const enriched = {
      ...item,
      id:            `${item.cityGroup}__${item.code}`,
      pv, brand, ufOrigem, multiple, family,
      suggestion:    netSuggestion,
      adjustedQty,
      orderedQty:    inTransit,
      isExpensive:   pv > 2500,
      priority:      netSuggestion <= 0 ? 'BAIXA' : getPriority(netSuggestion),
    }

    if (!isIntelbras) {
      result.OUTROS.push({ ...enriched, tab:'OUTROS' }); continue
    }
    if (!pv || pv === 0) {
      result.SEM_PRECO.push({ ...enriched, tab:'SEM_PRECO' }); continue
    }
    if (itemValue > 30000) {
      result.MANUAL.push({ ...enriched, tab:'MANUAL' }); continue
    }
    if (item.cityGroup === 'BELTRAO') {
      result.BELTRAO.push({ ...enriched, tab:'BELTRAO' })
    } else {
      result.TOLEDO.push({ ...enriched, tab:'TOLEDO' })
    }
  }
  return result
}

// Dias úteis de trânsito conforme a UF de origem (tabela de preços).
// Fallback único e padronizado para UF vazia/desconhecida: SC (mesmo padrão do import de NF).
export function originDays(ufOrigem) {
  return UF_DAYS[ufOrigem] || UF_DAYS.SC
}

// Previsão para compra feita hoje (ainda não faturada): 3 dias p/ faturar + prazo da UF
export function getArrivalDate(ufOrigem /*, brand */) {
  return addBizDays(todayStr(), DIAS_FATURAMENTO + originDays(ufOrigem))
}

export function calcOrderSplit(totalValue, cityGroup) {
  const limit = DAILY_LIMITS[cityGroup] ?? 35000
  const days  = Math.ceil(totalValue / limit)
  return { days, limit, totalValue }
}

// Estimativa MÍNIMA de chegada a partir da planilha de disponibilidade Intelbras.
// Serve só de complemento: nunca substitui uma previsão real (arrivalDate).
function minArrivalFromAvail(code, availMap, priceMap) {
  const av = availMap?.get(code)
  if (!av) return null
  if (av.origemImediato) {
    const uf = priceMap?.get(code)?.ufOrigem || ''
    return getArrivalDate(uf).toISOString().slice(0,10)
  }
  if (av.origemMes) {
    const d = new Date(); d.setDate(d.getDate() + 30)
    return d.toISOString().slice(0,10)
  }
  return null
}

// Tipos em que uma estimativa de chegada não faz sentido (produto fora de linha / outra marca)
const NO_MIN_TYPES = new Set(['ENCERRADO','ENCERRADO_COM_SUB','CONSULTAR_COMPRAS','COMPRADO_OUTRO_FORN'])

// Wrapper aditivo: mantém o retorno original e, quando o status não traz previsão
// própria, anexa `minArrival` com a estimativa pela disponibilidade. Nenhum campo
// existente é alterado, então os consumidores atuais seguem funcionando igual.
export function getProductStatus(code, cityGroup, rawItems, purchaseHistory, purchaseRequests, discontinuedMap, productOverrides, availMap, priceMap, orders) {
  const res = computeProductStatus(code, cityGroup, rawItems, purchaseHistory, purchaseRequests, discontinuedMap, productOverrides, availMap, priceMap, orders)
  if (!res || res.arrivalDate || NO_MIN_TYPES.has(res.type)) return res
  if (!isIntelbrasItem(code, rawItems, priceMap)) return res   // disponibilidade Intelbras não vale p/ outra marca
  const minArrival = minArrivalFromAvail(code, availMap, priceMap)
  return minArrival ? { ...res, minArrival } : res
}

function computeProductStatus(code, cityGroup, rawItems, purchaseHistory, purchaseRequests, discontinuedMap, productOverrides, availMap, priceMap, orders) {
  const intelbras = isIntelbrasItem(code, rawItems, priceMap)

  // 1. Encerrado — sempre tem prioridade (lista de encerramentos é da Intelbras)
  if (intelbras && discontinuedMap.has(code)) {
    const d = discontinuedMap.get(code)
    return { type: d.substitute ? 'ENCERRADO_COM_SUB' : 'ENCERRADO', ...d }
  }

  // 2. Override manual do Gabriel
  const overrideKey = `${code}__${cityGroup}`
  if (productOverrides?.[overrideKey]) {
    const ov = productOverrides[overrideKey]
    return { type: ov.status, arrivalDate: ov.arrivalDate||null, notes: ov.notes||'' }
  }

  const now = new Date()

  const isFuture = d => d && new Date(d + 'T23:59:59') >= now

  // 2b. Pedido Intelbras registrado (Supabase): em carteira (aguardando/parcial) ou faturado
  const sbPed = _supabasePedidosCodeMap.get(`${code}__${cityGroup}`)
  if (sbPed && intelbras) {
    if (sbPed.status === 'faturado') {
      // Previsão recalculada: data de emissão da NF + dias úteis da UF de origem (tabela de preços)
      const uf   = priceMap?.get(code)?.ufOrigem || ''
      const days = originDays(uf)
      const arrivalDate = sbPed.faturado_em
        ? addBizDays(sbPed.faturado_em, days).toISOString().slice(0,10)
        : (sbPed.previsao_entrega || null)
      // Faturado: some quando houver entrada no ERP após a NF, ou DIAS_TOLERANCIA dias úteis após a previsão
      const recebido = entradaApos(lastEntryOf(code, cityGroup, rawItems), sbPed.faturado_em, true)
      if (!recebido && !previsaoExpirada(arrivalDate))
        return { type: isFuture(arrivalDate) || !arrivalDate ? 'COMPRADO_FATURADO' : 'COMPRADO_VENCIDO', arrivalDate }
    } else {
      // aguardando / parcial → consta em carteira (previsão vencida vira "sem previsão")
      const localCart = (orders||[]).find(o =>
        o.source === 'carteira' && o.code === code && o.cityGroup === cityGroup && !o.receivedAt)
      const cartArr = localCart?.arrivalDate || sbPed.previsao_entrega || null
      return { type: 'COMPRADO_CARTEIRA', arrivalDate: isFuture(cartArr) ? cartArr : null }
    }
  }

  // 2c. Pedido em carteira local (planilha) sem registro no Supabase
  const carteiraOrder = intelbras && (orders||[]).find(o =>
    o.source === 'carteira' && o.code === code && o.cityGroup === cityGroup &&
    !o.receivedAt && !previsaoExpirada(o.arrivalDate) &&
    !entradaApos(lastEntryOf(code, cityGroup, rawItems), o.date)
  )
  if (carteiraOrder) {
    return {
      type: isFuture(carteiraOrder.arrivalDate) || !carteiraOrder.arrivalDate ? 'COMPRADO_CARTEIRA' : 'COMPRADO_VENCIDO',
      arrivalDate: carteiraOrder.arrivalDate || null,
    }
  }

  // 3. Comprado recentemente (histórico de compras)
  const recentPurchase = (purchaseHistory||[])
    .filter(h => h.code===code && h.cityGroup===cityGroup)
    .sort((a,b) => new Date(b.date) - new Date(a.date))[0]
  // Entrada no ERP depois da compra = recebido → não mostra mais como comprado
  const recebidoHist = recentPurchase && entradaApos(lastEntryOf(code, cityGroup, rawItems), recentPurchase.date)
  if (recentPurchase && !recebidoHist) {
    const daysSince = Math.floor((now - parseLocalDate(recentPurchase.date)) / 86400000)
    if (daysSince <= 30) {
      const arrDate = recentPurchase.arrivalDate
        ? parseLocalDate(recentPurchase.arrivalDate)
        : (recentPurchase.availType === 'SEM_DISPONIBILIDADE' ? null : (() => {
            const ufOrig = recentPurchase.ufOrigem || priceMap?.get(code)?.ufOrigem || ''
            const br     = recentPurchase.brand    || priceMap?.get(code)?.brand    || ''
            let days = UF_DAYS[ufOrig]
            if (!days) {
              const nb = normStr(br)
              if (nb.includes('intelbras') || availMap?.has(code)) days = UF_DAYS.SC
            }
            // Compra registrada no sistema ainda não faturada: soma os dias para faturar
            return days ? addBizDays(recentPurchase.date, DIAS_FATURAMENTO + days) : null
          })())
      // Outro fabricante: sem previsão automática (prazos por UF são da Intelbras)
      if (!intelbras) return {
        type: 'COMPRADO_OUTRO_FORN', purchaseDate: recentPurchase.date, arrivalDate: null, qty: recentPurchase.qty,
      }
      // Com previsão: após DIAS_TOLERANCIA dias úteis do vencimento sai do status (cai para disponibilidade)
      if (!(arrDate && previsaoExpirada(arrDate))) return {
        type: !arrDate ? 'COMPRADO_SEM_PREV' : (isoDate(arrDate) >= todayStr() ? 'COMPRADO_COM_PREV' : 'COMPRADO_VENCIDO'),
        purchaseDate: recentPurchase.date,
        arrivalDate:  arrDate ? isoDate(arrDate) : null,
        qty: recentPurchase.qty,
      }
    }
  }

  // 4. Solicitação pendente
  const pendingReq = (purchaseRequests||[]).find(r => r.code===code && r.cityGroup===cityGroup && r.status==='PENDENTE')
  if (pendingReq) return { type:'AGUARDANDO_COMPRA', requestDate:pendingReq.createdAt, obs:pendingReq.observation }

  // 5. Produto de outro fabricante → consultar compras (não usa disponibilidade Intelbras)
  if (!intelbras) return { type: 'CONSULTAR_COMPRAS' }

  // 6. Disponibilidade Intelbras (planilha de disponibilidade)
  if (!availMap || availMap.size === 0) {
    return { type: 'SEM_INFORMACAO' }
  }
  const av = availMap.get(code)
  if (!av) return { type: 'SEM_ESTOQUE' }

  const price = priceMap?.get(code)
  const ufOrigem = price?.ufOrigem || ''
  const days = originDays(ufOrigem)

  const hasImediato = av.origemImediato
  const hasMes      = av.origemMes

  if (hasImediato) {
    const arr = addBizDays(todayStr(), DIAS_FATURAMENTO + days)
    return {
      type: 'DISPONIVEL_IMEDIATO',
      arrivalDate: arr.toISOString().slice(0,10),
      qtdImediato: av.nordesteImediato + av.origemImediato,
      qtdMes:      av.nordesteMes + av.origemMes,
    }
  }
  if (hasMes) {
    const arr = new Date(); arr.setDate(arr.getDate() + 30)
    return {
      type: 'DISPONIVEL_MES',
      arrivalDate: arr.toISOString().slice(0,10),
      qtdMes: av.nordesteMes + av.origemMes,
    }
  }
  return { type: 'SEM_ESTOQUE' }
}

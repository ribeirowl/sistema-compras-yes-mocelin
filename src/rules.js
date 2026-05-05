import { UF_DAYS, DAILY_LIMITS } from './constants.js'
import { normStr, addBizDays, todayStr } from './utils.js'
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
        breakdown: [],
      })
    }
    const g = groups.get(key)
    g.suggestion          += item.suggestion
    g.stock               += item.stock
    g.reserved            += item.reserved
    g.avgMonthly          += item.avgMonthly
    g.currentMonthSales   += item.currentMonthSales || 0
    g.breakdown.push({ label:item.empresa, suggestion:item.suggestion, stock:item.stock })
  }
  return [...groups.values()]
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

export function orderedInTransit(code, cityGroup, orders, ufOrigem) {
  const now = Date.now()
  return orders
    .filter(o => o.code === code && o.cityGroup === cityGroup)
    .filter(o => {
      const age = (now - new Date(o.date).getTime()) / 86400000
      if (o.availType === 'DISPONIVEL_IMEDIATO') return age < (UF_DAYS[ufOrigem||o.ufOrigem] || 10)
      if (o.availType === 'DISPONIVEL_MES')      return age < 22
      return age < 30
    })
    .reduce((s, o) => s + (o.qty || 0), 0)
}

export function applyRules(rawItems, priceMap, discontinuedMap, orders) {
  const consolidated = consolidateRawItems(rawItems)
  const result = { BELTRAO:[], TOLEDO:[], OUTROS:[], MANUAL:[], SEM_PRECO:[] }

  for (const item of consolidated) {
    if (discontinuedMap.has(item.code)) continue

    const price      = priceMap.get(item.code)
    const pv         = price?.pv ?? 0
    const brand      = price?.brand || item.brand || ''
    const ufOrigem   = price?.ufOrigem || ''
    const multiple   = Math.max(1, price?.multiple ?? item.multiple ?? 1)
    const family     = price?.family || item.family || ''
    const isIntelbras= normStr(brand).includes('intelbras') ||
      (!brand && normStr(item.description).includes('intelbras'))

    const inTransit    = orders?.length ? orderedInTransit(item.code, item.cityGroup, orders, ufOrigem) : 0
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

export function getArrivalDate(ufOrigem, brand) {
  let days = UF_DAYS[ufOrigem]
  if (!days) {
    const nb = normStr(brand)
    if (nb.includes('intelbras')) days = UF_DAYS.SC
    else days = 10
  }
  return addBizDays(todayStr(), days)
}

export function calcOrderSplit(totalValue, cityGroup) {
  const limit = DAILY_LIMITS[cityGroup] ?? 35000
  const days  = Math.ceil(totalValue / limit)
  return { days, limit, totalValue }
}

export function getProductStatus(code, cityGroup, rawItems, purchaseHistory, purchaseRequests, discontinuedMap, productOverrides, availMap, priceMap) {
  // 1. Encerrado — sempre tem prioridade
  if (discontinuedMap.has(code)) {
    const d = discontinuedMap.get(code)
    return { type: d.substitute ? 'ENCERRADO_COM_SUB' : 'ENCERRADO', ...d }
  }

  // 2. Override manual do Gabriel
  const overrideKey = `${code}__${cityGroup}`
  if (productOverrides?.[overrideKey]) {
    const ov = productOverrides[overrideKey]
    return { type: ov.status, arrivalDate: ov.arrivalDate||null, notes: ov.notes||'' }
  }

  // 2b. Supabase pedido (Faturado / Aguardando Faturamento)
  const sbPed = _supabasePedidosCodeMap.get(`${code}__${cityGroup}`)
  if (sbPed) {
    if (sbPed.status === 'faturado')
      return { type: 'COMPRADO_FATURADO', arrivalDate: sbPed.previsao_entrega || null }
    return { type: 'COMPRADO_AGUARD_FAT' }
  }

  // 3. Comprado recentemente (histórico de compras)
  const now = new Date()
  const recentPurchase = (purchaseHistory||[])
    .filter(h => h.code===code && h.cityGroup===cityGroup)
    .sort((a,b) => new Date(b.date) - new Date(a.date))[0]
  if (recentPurchase) {
    const daysSince = Math.floor((now - new Date(recentPurchase.date)) / 86400000)
    if (daysSince <= 30) {
      const arrDate = recentPurchase.arrivalDate
        ? new Date(recentPurchase.arrivalDate)
        : (recentPurchase.availType === 'SEM_DISPONIBILIDADE' ? null : (() => {
            const ufOrig = recentPurchase.ufOrigem || priceMap?.get(code)?.ufOrigem || ''
            const br     = recentPurchase.brand    || priceMap?.get(code)?.brand    || ''
            let days = UF_DAYS[ufOrig]
            if (!days) {
              const nb = normStr(br)
              if (nb.includes('intelbras') || availMap?.has(code)) days = UF_DAYS.SC
            }
            return days ? addBizDays(recentPurchase.date, days) : null
          })())
      return {
        type: (arrDate && arrDate > now) ? 'COMPRADO_COM_PREV' : 'COMPRADO_SEM_PREV',
        purchaseDate: recentPurchase.date,
        arrivalDate:  arrDate ? arrDate.toISOString().slice(0,10) : null,
        qty: recentPurchase.qty,
      }
    }
  }

  // 4. Solicitação pendente
  const pendingReq = (purchaseRequests||[]).find(r => r.code===code && r.cityGroup===cityGroup && r.status==='PENDENTE')
  if (pendingReq) return { type:'AGUARDANDO_COMPRA', requestDate:pendingReq.createdAt, obs:pendingReq.observation }

  // 5. Produto de outra marca não cadastrado na tabela de preços → consultar compras
  if (!priceMap?.has(code)) {
    const rawItem = rawItems?.find(i => i.code === code)
    const brand = normStr(rawItem?.brand || '')
    if (!brand.includes('intelbras')) {
      return { type: 'CONSULTAR_COMPRAS' }
    }
  }

  // 6. Disponibilidade Intelbras (planilha de disponibilidade)
  if (!availMap || availMap.size === 0) {
    return { type: 'SEM_INFORMACAO' }
  }
  const av = availMap.get(code)
  if (!av) return { type: 'SEM_ESTOQUE' }

  const price = priceMap?.get(code)
  const ufOrigem = price?.ufOrigem || ''
  const days = UF_DAYS[ufOrigem] || 10

  const hasImediato = av.origemImediato
  const hasMes      = av.origemMes

  if (hasImediato) {
    const arr = addBizDays(todayStr(), days)
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

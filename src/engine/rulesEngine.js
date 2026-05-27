export const LIMITS = { FB: 35000, TOLEDO: 20000 }

// Determine if empresa belongs to FB or Toledo group
function getEmpresaGroup(empresa) {
  const n = String(empresa).trim()
  if (/^3\s*[-–]|toled/i.test(n)) return 'TOLEDO'
  return 'FB'
}

// Round qty UP to nearest multiple
function roundUpToMultiple(qty, multiple) {
  if (!multiple || multiple <= 1) return qty
  return Math.ceil(qty / multiple) * multiple
}

// Priority tier based on suggestion quantity
function calcPriority(suggestion) {
  if (suggestion > 30) return 'ALTA'
  if (suggestion > 15) return 'MEDIA'
  if (suggestion > 5)  return 'NORMAL'
  return 'BAIXA'
}

let _counter = 0

export function processItems(stockItems, priceMap, discontinuedCodes = new Set()) {
  _counter = 0
  const result = []

  for (const item of stockItems) {
    // Filter discontinued from price table
    if (discontinuedCodes.has(item.code)) continue

    const priceInfo   = priceMap.get(item.code) ?? null
    const isIntelbras = item.brand.toUpperCase().includes('INTELBRAS')
    const hasPrice    = priceInfo !== null && priceInfo.pv > 0

    const pv       = hasPrice ? priceInfo.pv       : 0
    const multiple = hasPrice ? Math.max(1, priceInfo.multiple ?? 1) : 1
    const family   = priceInfo?.family   ?? ''
    const segment  = priceInfo?.segment  ?? ''

    const adjustedQty  = roundUpToMultiple(item.suggestion, multiple)
    const totalValue   = adjustedQty * pv
    const priority     = calcPriority(item.suggestion)
    const empresaGroup = getEmpresaGroup(item.empresa)

    // ---- Tab assignment ----
    let tab
    if (isIntelbras && !hasPrice) {
      tab = 'SEM_PRECO'
    } else if (totalValue > 30000) {
      tab = 'MANUAL'
    } else if (!isIntelbras) {
      tab = 'OUTROS'
    } else {
      tab = empresaGroup // 'FB' or 'TOLEDO'
    }

    result.push({
      id:          `${item.code}_${++_counter}`,
      code:        item.code,
      description: item.description,
      empresa:     item.empresa,
      empresaGroup,
      brand:       item.brand || 'DESCONHECIDA',
      secao:       item.secao,
      family,
      segment,

      suggestion:  item.suggestion,
      stock:       item.stock,
      available:   item.available,
      avgMonthly:  item.avgMonthly,
      status:      item.status,
      coverage:    item.coverage,

      pv,
      multiple,
      hasPrice,
      isIntelbras,

      adjustedQty,
      totalValue,

      priority,
      isExpensive: pv > 2500,

      tab,
      // For OUTROS grouping: use brand name as subGroup
      subGroup: isIntelbras ? empresaGroup : (item.brand || 'DESCONHECIDA'),
    })
  }

  return result
}

// Compute per-tab totals for dashboard
export function calcTabSummary(items, selections) {
  const tabs = ['FB', 'TOLEDO', 'OUTROS', 'MANUAL', 'SEM_PRECO']
  const summary = {}

  for (const tab of tabs) {
    const tabItems = items.filter(i => i.tab === tab)
    const selItems = tabItems.filter(i => {
      const sel = selections[i.id]
      return sel ? sel.selected : false
    })
    summary[tab] = {
      total:         tabItems.length,
      totalValue:    tabItems.reduce((s, i) => s + i.totalValue, 0),
      selectedCount: selItems.length,
      selectedValue: selItems.reduce((s, i) => {
        const qty = selections[i.id]?.qty ?? i.adjustedQty
        return s + qty * i.pv
      }, 0),
    }
  }

  return summary
}

// Get unique brands in the OUTROS tab
export function getOutrosBrands(items) {
  const brands = new Set()
  items.filter(i => i.tab === 'OUTROS').forEach(i => brands.add(i.brand || 'DESCONHECIDA'))
  return [...brands].sort()
}

// Build initial selections object from processed items
export function buildInitialSelections(items) {
  const sel = {}
  for (const item of items) {
    sel[item.id] = {
      selected: item.tab !== 'SEM_PRECO' && item.tab !== 'MANUAL',
      qty:      item.adjustedQty,
    }
  }
  return sel
}

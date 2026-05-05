import * as XLSX from 'xlsx'

// Normalize string for comparison: lowercase, no accents
const norm = s =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

// Find column index by matching any of the given patterns
function findCol(headers, patterns) {
  const normed = headers.map(norm)
  for (const pat of patterns) {
    const p = norm(pat)
    const idx = normed.findIndex(h => h.includes(p))
    if (idx !== -1) return idx
  }
  return -1
}

// Parse numeric value - handles Brazilian format (1.234,56) and regular (1234.56)
function toNum(v) {
  if (v === null || v === undefined || v === '') return 0
  if (typeof v === 'number') return isNaN(v) ? 0 : v
  const s = String(v)
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(,|$))/g, '') // remove thousands dot
    .replace(',', '.')
  return parseFloat(s) || 0
}

export function parseStockReport(workbook) {
  const sheetName = workbook.SheetNames[0]
  const ws = workbook.Sheets[sheetName]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

  if (!raw || raw.length < 2)
    throw new Error('Planilha de estoque vazia ou inválida.')

  // Find header row — look for "empresa" or "sugest"
  let headerIdx = -1
  for (let i = 0; i < Math.min(10, raw.length); i++) {
    const rowStr = norm(raw[i].join(' '))
    if (rowStr.includes('empresa') || rowStr.includes('sugest')) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) headerIdx = 0

  const headers = raw[headerIdx]

  const cols = {
    empresa:     findCol(headers, ['empresa']),
    secao:       findCol(headers, ['secao', 'seção', 'secção']),
    code:        findCol(headers, ['produto - c', 'cod.', 'cód.', 'código produto', 'codigo produto', 'código', 'codigo']),
    description: findCol(headers, ['produto - d', 'descricao', 'descrição', 'desc']),
    suggestion:  findCol(headers, ['sugest']),
    stock:       findCol(headers, ['estoque (c', 'estoque c', 'estoq (', 'estoque at']),
    available:   findCol(headers, ['disponiv', 'dispon']),
    avgMonthly:  findCol(headers, ['media mes', 'média mes', 'med. mes', 'med mes', 'media mês', 'média mês']),
    status:      findCol(headers, ['status est', 'status cod', 'status']),
    brand:       findCol(headers, ['marca']),
    coverage:    findCol(headers, ['dias de c', 'cobertura']),
    reserved:    findCol(headers, ['reservado']),
  }

  const items = []

  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i]
    if (!row || row.every(c => c === '' || c === null || c === undefined)) continue

    const code = String(cols.code !== -1 ? (row[cols.code] ?? '') : '').trim()
    if (!code || code.length < 3) continue

    const suggestion = toNum(cols.suggestion !== -1 ? row[cols.suggestion] : 0)
    if (suggestion <= 0) continue

    // Filter discontinued
    const statusVal = norm(cols.status !== -1 ? row[cols.status] : '')
    if (
      statusVal.includes('fora de linha') ||
      statusVal.includes('encerrado') ||
      statusVal.includes('descontinuado') ||
      statusVal.includes('inativo')
    ) continue

    const empresa = String(cols.empresa !== -1 ? (row[cols.empresa] ?? '') : '').trim()
    const brand   = String(cols.brand !== -1   ? (row[cols.brand]   ?? '') : '').trim().toUpperCase()

    items.push({
      code,
      description: String(cols.description !== -1 ? (row[cols.description] ?? '') : code).trim() || code,
      empresa,
      secao:      String(cols.secao !== -1      ? (row[cols.secao]      ?? '') : '').trim(),
      suggestion,
      stock:      toNum(cols.stock      !== -1 ? row[cols.stock]      : 0),
      available:  toNum(cols.available  !== -1 ? row[cols.available]  : 0),
      avgMonthly: toNum(cols.avgMonthly !== -1 ? row[cols.avgMonthly] : 0),
      status:     String(cols.status !== -1     ? (row[cols.status]     ?? '') : '').trim(),
      brand,
      coverage:   toNum(cols.coverage  !== -1 ? row[cols.coverage]  : 0),
      reserved:   toNum(cols.reserved  !== -1 ? row[cols.reserved]  : 0),
    })
  }

  if (items.length === 0)
    throw new Error('Nenhum item com sugestão > 0 encontrado. Verifique se o arquivo é o relatório de estoque correto.')

  return items
}

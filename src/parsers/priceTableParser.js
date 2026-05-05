import * as XLSX from 'xlsx'

const norm = s =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

function findCol(headers, patterns) {
  const normed = headers.map(norm)
  for (const pat of patterns) {
    const p = norm(pat)
    // Exact match first
    const exact = normed.findIndex(h => h === p)
    if (exact !== -1) return exact
    // Partial match
    const partial = normed.findIndex(h => h.includes(p))
    if (partial !== -1) return partial
  }
  return -1
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return 0
  if (typeof v === 'number') return isNaN(v) ? 0 : v
  const s = String(v).replace(/\s/g, '').replace(/\.(?=\d{3}(,|$))/g, '').replace(',', '.')
  return parseFloat(s) || 0
}

// Find the row index that contains table headers
function findHeaderRow(rows, searchTerms) {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const rowNorm = norm(rows[i].join(' '))
    if (searchTerms.some(t => rowNorm.includes(norm(t)))) return i
  }
  return -1
}

// Sheets to skip (not price data)
const SKIP_SHEETS = ['orientacoes', 'locacao', 'lancamentos', 'troca de codigo', 'comparativo', 'khomp']

export function parsePriceTable(workbook) {
  const priceMap = new Map()        // code → { pv, multiple, family, segment }
  const discontinuedCodes = new Set()

  for (const sheetName of workbook.SheetNames) {
    const sn = norm(sheetName)

    // --- Encerramentos sheet: collect discontinued codes ---
    if (sn.includes('encerr') || sn.includes('fora de linha') || sn.includes('descont')) {
      const ws   = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      const hIdx = findHeaderRow(rows, ['codigo produto', 'codigo', 'cod.'])
      if (hIdx !== -1) {
        const headers = rows[hIdx]
        const cCol = findCol(headers, ['codigo produto', 'cod. produto', 'codigo do produto', 'codigo', 'cod.'])
        if (cCol !== -1) {
          for (let i = hIdx + 1; i < rows.length; i++) {
            const code = String(rows[i][cCol] ?? '').trim()
            if (code && code.length >= 4) discontinuedCodes.add(code)
          }
        }
      }
      continue
    }

    // --- Skip non-price sheets ---
    if (SKIP_SHEETS.some(s => sn.includes(s))) continue

    const ws   = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

    // Find header row — must contain code AND either "pv" or "preco"
    const hIdx = findHeaderRow(rows, ['codigo produto', 'codigo do produto', 'pv', 'preco de venda'])
    if (hIdx === -1) continue

    const headers = rows[hIdx]

    const codeCol     = findCol(headers, ['codigo produto', 'cod. produto', 'codigo do produto', 'codigo', 'cod.'])
    const pvCol       = findCol(headers, ['pv'])  // exact "pv" first
    const multipleCol = findCol(headers, ['qtd. multipla', 'qtd multipla', 'qtd.multipla', 'multiplo', 'multipla', 'qtd. múltipla'])
    const familyCol   = findCol(headers, ['familia', 'família'])
    const segmentCol  = findCol(headers, ['segmento'])

    if (codeCol === -1) continue

    for (let i = hIdx + 1; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.every(c => c === '' || c === null || c === undefined)) continue

      const code = String(row[codeCol] ?? '').trim()
      if (!code || code.length < 4) continue

      const pv       = pvCol       !== -1 ? toNum(row[pvCol])       : 0
      const multiple = multipleCol !== -1 ? Math.max(1, toNum(row[multipleCol]) || 1) : 1
      const family   = familyCol   !== -1 ? String(row[familyCol]   ?? '').trim() : ''
      const segment  = segmentCol  !== -1 ? String(row[segmentCol]  ?? '').trim() : ''

      // Keep entry with best price data
      if (!priceMap.has(code) || (pv > 0 && priceMap.get(code).pv === 0)) {
        priceMap.set(code, { pv, multiple, family, segment })
      }
    }
  }

  return { priceMap, discontinuedCodes }
}

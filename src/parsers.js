import * as XLSX from 'xlsx'
import { normStr } from './utils.js'
import { fmtExcelDate } from './utils.js'

export function readWb(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = e => {
      try { res(XLSX.read(e.target.result, {type:'array',cellDates:true})) }
      catch(err) { rej(new Error('Erro ao ler arquivo: ' + err.message)) }
    }
    fr.onerror = () => rej(new Error('Falha ao ler o arquivo'))
    fr.readAsArrayBuffer(file)
  })
}

export function sheetRows(ws) {
  const ref = ws['!ref']
  if (!ref) return []
  const range = XLSX.utils.decode_range(ref)
  const rows = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({r,c})]
      row.push(cell ? (cell.v??'') : '')
    }
    rows.push(row)
  }
  return rows
}

export function findColIdx(headers, patterns) {
  const nh = headers.map(normStr)
  for (const p of patterns) {
    const np = normStr(p)
    const idx = nh.findIndex(h => h.includes(np))
    if (idx >= 0) return idx
  }
  return -1
}

export function parseStockReport(wb) {
  for (const shName of wb.SheetNames) {
    const sn = normStr(shName)
    if (['orient','locat','troca','khomp','comparat'].some(x => sn.includes(x))) continue
    const ws = wb.Sheets[shName]
    const rows = sheetRows(ws)
    if (rows.length < 3) continue

    let hIdx = -1
    for (let i = 0; i < Math.min(12, rows.length); i++) {
      const r = rows[i].map(normStr)
      if (r.some(c => c.includes('codigo') || c.includes('produto') || c.includes('descri'))) {
        hIdx = i; break
      }
    }
    if (hIdx < 0) continue

    const hdr = rows[hIdx].map(normStr)
    const C = {
      code:      findColIdx(hdr, ['codigo','cod.','cod ','product code']),
      desc:      findColIdx(hdr, ['descri','produto','nome do produto','nome prod']),
      empresa:   findColIdx(hdr, ['empresa','filial','loja','empr']),
      stock:     findColIdx(hdr, ['estoque (qt','estoque at','estoque (c','estoq (','estoque c','estoque']),
      reserved:  findColIdx(hdr, ['reservado','reserv']),
      suggestion:findColIdx(hdr, ['sugest','sugestao','sug ']),
      multiple:  findColIdx(hdr, ['qtd. multipla','qtd multipla','qtd.multipla','multiplo','multipla','multiplic','lote min','minimo','mult ']),
      avgMonthly:findColIdx(hdr, ['media mes','media men','media','med.','consumo med','cons.med']),
      family:    findColIdx(hdr, ['familia','family','grupo']),
      brand:     findColIdx(hdr, ['marca','fabric','brand']),
      currentMonthSales: (()=>{ for(let i=0;i<hdr.length;i++){ if(/fat\.?\s*[a-z]{3}[\\/. ]\d{2}/.test(hdr[i])&&!/[a-z]{3}[-–][a-z]{3}/.test(hdr[i])) return i } return -1 })(),
    }
    if (C.code < 0 || C.desc < 0) continue

    const items = []
    for (let r = hIdx+1; r < rows.length; r++) {
      const row = rows[r]
      const code = String(row[C.code]??'').trim()
      if (!code || code==='0') continue
      const desc = String(row[C.desc]??'').trim()
      if (!desc) continue

      const descLow = normStr(desc)
      if (descLow.includes('fora de linha') || descLow.includes('encerrado') || descLow.includes('descontinuado')) continue

      const toN = v => {
        const s = String(v??'').replace(/[^\d,.-]/g,'').replace(/\.(?=\d{3}(,|$))/g,'').replace(',','.')
        return Math.max(0, parseFloat(s) || 0)
      }

      items.push({
        code,
        description:       desc,
        empresa:           C.empresa >= 0            ? String(row[C.empresa]??'').trim()              : '',
        stock:             C.stock >= 0              ? toN(row[C.stock])                              : 0,
        reserved:          C.reserved >= 0           ? toN(row[C.reserved])                           : 0,
        suggestion:        C.suggestion >= 0         ? Math.max(0, toN(row[C.suggestion]))            : 0,
        multiple:          C.multiple >= 0           ? Math.max(1, parseInt(row[C.multiple])||1)      : 1,
        avgMonthly:        C.avgMonthly >= 0         ? toN(row[C.avgMonthly])                        : 0,
        currentMonthSales: C.currentMonthSales >= 0  ? toN(row[C.currentMonthSales])                 : 0,
        family:            C.family >= 0             ? String(row[C.family]??'').trim()               : '',
        brand:             C.brand >= 0              ? String(row[C.brand]??'').trim().toUpperCase()  : '',
      })
    }
    if (items.length > 0) return items
  }
  return []
}

export function parsePriceTable(wb) {
  const priceMap       = new Map()
  const discontinuedMap= new Map()

  for (const shName of wb.SheetNames) {
    const sn = normStr(shName)
    const isEncerr = sn.includes('encerr') || sn.includes('fora de linha') || sn.includes('descont')
    if (['orient','locat','lancam','troca','khomp','comparat'].some(x=>sn.includes(x))) continue

    const ws = wb.Sheets[shName]
    const rows = sheetRows(ws)
    if (rows.length < 2) continue

    let hIdx = -1
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const r = rows[i].map(normStr)
      if (r.some(c => c.includes('codigo') || c.includes('cod.') || c.includes('pv') || c.includes('preco'))) {
        hIdx = i; break
      }
    }
    if (hIdx < 0) continue

    const hdr = rows[hIdx].map(normStr)
    const codeCol   = findColIdx(hdr, ['codigo produto','cod. produto','codigo do produto','codigo','cod.','code'])
    if (codeCol < 0) continue

    if (isEncerr) {
      const subDirCol = findColIdx(hdr, ['substitut direto','substituto direto','substitut','sub direto'])
      const subExpCol = findColIdx(hdr, ['troca expre','subs. troca','indicac'])
      const descCol   = findColIdx(hdr, ['descricao','descricão','descricao do produto','desc.','description','produto'])
      const dateCol   = findColIdx(hdr, ['data encerr','dt encerr','data de encerr','data descont','data fora','data','date','dt'])
      const isDash = t => /^[-–—\s]*$/.test(t)
      for (let r = hIdx+1; r < rows.length; r++) {
        const row = rows[r]
        const code = String(row[codeCol]??'').trim()
        if (!code || code.length < 3) continue
        const subDirText = subDirCol >= 0 ? String(row[subDirCol]??'').trim() : ''
        const subExpText = subExpCol >= 0 ? String(row[subExpCol]??'').trim() : ''
        const subText = !isDash(subDirText) ? subDirText : (!isDash(subExpText) ? subExpText : '')
        const firstCode = (subText.match(/\b\d{6,8}\b/)||[])[0]||''
        const desc = descCol >= 0 ? String(row[descCol]??'').trim() : ''
        const closedAt = dateCol >= 0 ? fmtExcelDate(row[dateCol]) : ''
        discontinuedMap.set(code, {
          substitute:     firstCode,
          substituteName: subText,
          description:    desc,
          closedAt,
        })
      }
    } else {
      const pvCol    = findColIdx(hdr, ['pv','preco venda','p. venda','valor venda','vlr venda'])
      const brandCol = findColIdx(hdr, ['marca','fabricante','brand'])
      const ufCol    = findColIdx(hdr, ['uf origem','uf de origem','origem uf','uf orig'])
      const multCol  = findColIdx(hdr, ['qtd. multipla','qtd multipla','qtd.multipla','multiplo','multipla','multiplic','lote min','minimo','mult '])
      const famCol   = findColIdx(hdr, ['familia','family','grupo'])

      const toN = v => parseFloat(String(v||0).replace(/[^\d.,]/g,'').replace(',','.')) || 0

      for (let r = hIdx+1; r < rows.length; r++) {
        const row = rows[r]
        const code = String(row[codeCol]??'').trim()
        if (!code || code.length < 3) continue
        const pv = pvCol >= 0 ? toN(row[pvCol]) : 0
        if (!priceMap.has(code) || (pv > 0 && priceMap.get(code).pv === 0)) {
          priceMap.set(code, {
            pv,
            brand:     brandCol >= 0 ? String(row[brandCol]??'').trim().toUpperCase() : '',
            ufOrigem:  ufCol    >= 0 ? String(row[ufCol]??'').trim().toUpperCase()   : '',
            multiple:  multCol  >= 0 ? Math.max(1, parseInt(row[multCol])||1)        : 1,
            family:    famCol   >= 0 ? String(row[famCol]??'').trim()                : '',
          })
        }
      }
    }
  }
  return { priceMap, discontinuedMap }
}

export function parseAvailability(wb) {
  const availMap = new Map()
  for (const shName of wb.SheetNames) {
    const ws = wb.Sheets[shName]
    const rows = sheetRows(ws)
    if (rows.length < 3) continue

    let hIdx = -1
    for (let i = 0; i < Math.min(8, rows.length); i++) {
      const r = rows[i].map(normStr)
      if (r.some(c => c.includes('cod. material') || c.includes('cod material') || (c.includes('cod') && c.includes('mat')))) {
        hIdx = i; break
      }
    }
    if (hIdx < 0) continue

    const hdr = rows[hIdx].map(normStr)
    const codeCol = findColIdx(hdr, ['cod. material','cod material','codigo material','codigo'])
    if (codeCol < 0) continue
    const descAvCol = findColIdx(hdr, ['descricao','descricão','descricao do produto','desc.','description','nome do produto','produto','nome'])

    let nordMesCol = -1, origMesCol = -1, nordImmCol = -1, origImmCol = -1
    if (hIdx > 0) {
      const pHdr = rows[hIdx-1].map(normStr)
      let mesStart = -1, immStart = -1
      for (let c = 0; c < pHdr.length; c++) {
        const v = pHdr[c]
        if (mesStart < 0 && (v.includes('mes') || v.includes('mensal') || v.includes('p/ o mes') || v.includes('p/o mes') || v.includes('disponibilidade p'))) mesStart = c
        if (immStart < 0 && (v.includes('imediato') || v.includes('imediata'))) immStart = c
      }
      if (mesStart >= 0) { nordMesCol = mesStart; origMesCol = mesStart + 1 }
      if (immStart >= 0) { nordImmCol = immStart; origImmCol = immStart + 1 }
    }
    if (nordMesCol < 0) {
      nordMesCol = codeCol + 2; origMesCol = codeCol + 3
      nordImmCol = codeCol + 4; origImmCol = codeCol + 5
    }

    const toAvail = v => {
      const s = normStr(String(v??'').trim())
      if (s === 'sim' || s === 's' || s === 'yes' || s === 'y' || s === 'x') return true
      if (s === 'nao' || s === 'n' || s === 'no' || s === '') return false
      const n = parseFloat(s.replace(/[^\d.,]/g,'').replace(',','.')) || 0
      return n > 0
    }

    for (let r = hIdx + 1; r < rows.length; r++) {
      const row = rows[r]
      const rawCode = String(row[codeCol]??'').trim()
      if (!rawCode || rawCode.length < 4) continue
      const code = rawCode.replace(/[^\d]/g, '')
      if (!code) continue
      availMap.set(code, {
        description:      descAvCol >= 0 ? String(row[descAvCol]??'').trim() : '',
        origemImediato:   toAvail(row[origImmCol]),
        origemMes:        toAvail(row[origMesCol]),
        nordesteImediato: toAvail(row[nordImmCol]),
        nordesteMes:      toAvail(row[nordMesCol]),
      })
    }
    if (availMap.size > 0) break
  }
  return availMap
}

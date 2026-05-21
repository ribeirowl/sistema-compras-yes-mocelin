import { useState, useEffect } from 'react'

export const normStr = s => String(s??'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim()

export function useDebounce(value, delay=300) {
  const [dv, setDv] = useState(value)
  useEffect(() => { const t = setTimeout(()=>setDv(value), delay); return ()=>clearTimeout(t) }, [value, delay])
  return dv
}
export const fmtBRL  = v => (v??0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})
// Use local time to avoid UTC-midnight shifting dates one day back in Brazil (UTC-3)
export const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// Parse a date string as local time (appends T00:00:00 to ISO date-only strings)
export function parseLocalDate(s) {
  if (!s) return new Date(NaN)
  if (s instanceof Date) return s
  if (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00')
  return new Date(s)
}

export function addBizDays(startDateStr, n) {
  const d = startDateStr ? parseLocalDate(startDateStr) : new Date()
  let count = 0
  while (count < n) {
    d.setDate(d.getDate()+1)
    if (d.getDay()!==0 && d.getDay()!==6) count++
  }
  return d
}

export function bizDaysBetween(d1, d2) {
  let count = 0
  const cur = parseLocalDate(d1)
  const end = parseLocalDate(d2)
  while (cur < end) {
    cur.setDate(cur.getDate()+1)
    if (cur.getDay()!==0 && cur.getDay()!==6) count++
  }
  return count
}

export function fmtDate(d) {
  if (!d) return '—'
  const dt = parseLocalDate(d)
  if (isNaN(dt)) return '—'
  return dt.toLocaleDateString('pt-BR')
}

export function fmtExcelDate(v) {
  if (!v && v !== 0) return ''
  if (v instanceof Date) return isNaN(v) ? '' : v.toLocaleDateString('pt-BR')
  if (typeof v === 'number' && v > 1000) {
    const dt = new Date(Math.round((v - 25569) * 86400000))
    return isNaN(dt) ? '' : dt.toLocaleDateString('pt-BR')
  }
  const s = String(v).trim()
  if (!s) return ''
  const dt = new Date(s)
  return (!isNaN(dt) && s.length >= 8) ? dt.toLocaleDateString('pt-BR') : s
}

export function dlBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

import { useState, useEffect } from 'react'

export const normStr = s => String(s??'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim()

export function useDebounce(value, delay=300) {
  const [dv, setDv] = useState(value)
  useEffect(() => { const t = setTimeout(()=>setDv(value), delay); return ()=>clearTimeout(t) }, [value, delay])
  return dv
}
export const fmtBRL  = v => (v??0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})
export const todayStr = () => new Date().toISOString().slice(0,10)

export function addBizDays(startDateStr, n) {
  const d = startDateStr ? new Date(startDateStr) : new Date()
  let count = 0
  while (count < n) {
    d.setDate(d.getDate()+1)
    if (d.getDay()!==0 && d.getDay()!==6) count++
  }
  return d
}

export function bizDaysBetween(d1, d2) {
  let count = 0
  const cur = new Date(d1)
  const end = new Date(d2)
  while (cur < end) {
    cur.setDate(cur.getDate()+1)
    if (cur.getDay()!==0 && cur.getDay()!==6) count++
  }
  return count
}

export function fmtDate(d) {
  if (!d) return '—'
  const dt = d instanceof Date ? d : new Date(d)
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

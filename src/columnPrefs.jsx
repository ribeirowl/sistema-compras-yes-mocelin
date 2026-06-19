import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { dbGetColPrefs, saveColPrefs } from './supabase.js'

const Ctx = createContext(null)

// Provider: carrega o blob de preferências do usuário (Supabase) e expõe leitura/escrita.
export function ColumnPrefsProvider({ user, children }) {
  const [prefs, setPrefs] = useState({})

  useEffect(() => {
    let active = true
    dbGetColPrefs(user).then(p => { if (active) setPrefs(p || {}) })
    return () => { active = false }
  }, [user])

  const update = useCallback((tableId, patch) => {
    setPrefs(prev => {
      const next = { ...prev, [tableId]: { ...(prev[tableId] || {}), ...patch } }
      saveColPrefs(user, next)
      return next
    })
  }, [user])

  const resetTable = useCallback((tableId) => {
    setPrefs(prev => {
      const next = { ...prev }; delete next[tableId]
      saveColPrefs(user, next)
      return next
    })
  }, [user])

  return <Ctx.Provider value={{ prefs, update, resetTable }}>{children}</Ctx.Provider>
}

// Hook por planilha: recebe a definição de colunas e devolve a visão personalizada.
// columns: [{ id, label, alwaysVisible?, defaultWidth?, ... }]
export function useColumnPrefs(tableId, columns) {
  const ctx = useContext(Ctx)
  const tp = ctx?.prefs?.[tableId] || {}

  const ids    = columns.map(c => c.id)
  const colMap = Object.fromEntries(columns.map(c => [c.id, c]))

  // ordem salva, filtrando ids que não existem mais, e acrescentando colunas novas no fim
  const savedOrder = (tp.order || []).filter(id => ids.includes(id))
  const orderIds   = [...savedOrder, ...ids.filter(id => !savedOrder.includes(id))]

  const hidden  = new Set(tp.hidden || [])
  const widths  = tp.widths || {}
  const density = tp.density || 'normal'

  const allOrdered     = orderIds.map(id => colMap[id]).filter(Boolean)
  const visibleColumns = allOrdered.filter(c => c.alwaysVisible || !hidden.has(c.id))

  const noop = () => {}
  if (!ctx) return { allOrdered, visibleColumns, hidden, widths, density,
    setHidden:noop, setWidth:noop, setOrder:noop, setDensity:noop, reset:noop }

  return {
    allOrdered, visibleColumns, hidden, widths, density,
    setHidden: (id, v) => {
      const h = new Set(hidden); v ? h.add(id) : h.delete(id)
      ctx.update(tableId, { hidden: [...h] })
    },
    setWidth:  (id, w) => ctx.update(tableId, { widths: { ...widths, [id]: Math.max(40, Math.round(w)) } }),
    setOrder:  (newOrderIds) => ctx.update(tableId, { order: newOrderIds }),
    setDensity:(d) => ctx.update(tableId, { density: d }),
    reset:     () => ctx.resetTable(tableId),
  }
}

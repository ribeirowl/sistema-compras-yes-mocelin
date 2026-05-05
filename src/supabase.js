import { createClient } from '@supabase/supabase-js'
import {
  HISTORY_KEY, REQUESTS_KEY, AVAIL_MAP_KEY, RAW_ITEMS_KEY, PRICE_MAP_KEY,
  DISC_MAP_KEY, OVERRIDES_KEY, DATA_DATE_KEY, LOGO_KEY, ORDERS_KEY, USERS_KEY,
  NOTIFS_KEY, SYNC_KEYS, normCnpj, toCents,
} from './constants.js'

export const SUPABASE_URL = 'https://addqjohxtqypmtksbrrb.supabase.co'
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkZHFqb2h4dHF5cG10a3NicnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNDQ5MTIsImV4cCI6MjA5MTcyMDkxMn0.NLynQVmItk35-MeqtQdbDxtxwG11Hbe1k5LPxoKRTxo'
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

export async function dbPull() {
  try {
    const { data, error } = await sb.from('app_data').select('key,value').in('key', SYNC_KEYS)
    if (error) throw error
    const fetched = new Set((data||[]).map(r => r.key))
    ;(data||[]).forEach(({ key, value }) => { if (value != null) localStorage.setItem(key, value) })
    for (const key of SYNC_KEYS) {
      if (fetched.has(key)) continue
      const local = localStorage.getItem(key)
      if (!local) continue
      const { error: me } = await sb.from('app_data')
        .upsert({ key, value: local, updated_at: new Date().toISOString() })
      if (me) console.warn('[Supabase] migrate failed:', key, me)
      else console.log('[Supabase] migrated:', key, `(${(local.length/1024).toFixed(1)}KB)`)
    }
    return true
  } catch(e) { console.warn('[Supabase] pull failed:', e); return false }
}

// dbPush with 3-attempt retry — Supabase is the source of truth
export async function dbPush(key, strValue) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await sb.from('app_data')
      .upsert({ key, value: strValue, updated_at: new Date().toISOString() })
    if (!error) return
    if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 800))
    else console.warn('[Supabase] push failed after 3 attempts:', key, error)
  }
}

// dbSync: write to localStorage cache immediately, then persist to Supabase
// Large blobs (rawItems, priceMap, discMap) skip localStorage to avoid 5MB limit
const LARGE_KEYS = new Set([RAW_ITEMS_KEY, PRICE_MAP_KEY, DISC_MAP_KEY])

function dbSync(key, strValue) {
  if (!LARGE_KEYS.has(key)) {
    try { localStorage.setItem(key, strValue) } catch(e) { console.warn('[localStorage] write failed:', key, e) }
  }
  dbPush(key, strValue)
}

// dbRefresh: re-fetch shared state from Supabase and update React state
// Returns an object with updated values for keys that changed
export async function dbRefresh(keys) {
  try {
    const { data, error } = await sb.from('app_data').select('key,value').in('key', keys)
    if (error) throw error
    const result = {}
    ;(data||[]).forEach(({ key, value }) => {
      if (value == null) return
      const cached = localStorage.getItem(key)
      if (cached !== value) {
        localStorage.setItem(key, value)
        result[key] = value
      }
    })
    return result
  } catch(e) { console.warn('[Supabase] refresh failed:', e); return {} }
}

// ─── Storage helpers ─────────────────────────────────────
// Reads: localStorage first (fast startup), falls back to empty default
// Writes: localStorage cache + Supabase (via dbSync)

export const getHistory   = () => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]')  } catch { return [] } }
export const saveHistory  = v  => { const s=JSON.stringify(v); dbSync(HISTORY_KEY, s) }
export const getRequests  = () => { try { return JSON.parse(localStorage.getItem(REQUESTS_KEY)||'[]') } catch { return [] } }
export const saveRequests = v  => { const s=JSON.stringify(v); dbSync(REQUESTS_KEY, s) }

// Large blobs: read from localStorage cache (populated by dbPull), write to Supabase only
export const getRawItems  = () => { try { return JSON.parse(localStorage.getItem(RAW_ITEMS_KEY)||'[]') } catch { return [] } }
export const saveRawItems = v  => { dbSync(RAW_ITEMS_KEY, JSON.stringify(v)) }
export const getPriceMap  = () => { try { return new Map(JSON.parse(localStorage.getItem(PRICE_MAP_KEY)||'[]')) } catch { return new Map() } }
export const savePriceMap = (map, ri) => { const codes=new Set((ri||[]).map(i=>i.code)); dbSync(PRICE_MAP_KEY, JSON.stringify([...map.entries()].filter(([k])=>codes.has(k)))) }
export const getDiscMap   = () => { try { return new Map(JSON.parse(localStorage.getItem(DISC_MAP_KEY)||'[]')) } catch { return new Map() } }
export const saveDiscMap  = v  => { dbSync(DISC_MAP_KEY, JSON.stringify([...v.entries()])) }

export const getOverrides = () => { try { return JSON.parse(localStorage.getItem(OVERRIDES_KEY)||'{}') } catch { return {} } }
export const saveOverrides= v  => { const s=JSON.stringify(v); dbSync(OVERRIDES_KEY, s) }
export const getDataDate  = () => localStorage.getItem(DATA_DATE_KEY)||null
export const saveDataDate = v  => { localStorage.setItem(DATA_DATE_KEY, v); dbPush(DATA_DATE_KEY, v) }
export const getAvailMap  = () => { try { return new Map(JSON.parse(localStorage.getItem(AVAIL_MAP_KEY)||'[]')) } catch { return new Map() } }
export const saveAvailMap = v  => { dbSync(AVAIL_MAP_KEY, JSON.stringify([...v.entries()])) }
export const getOrders    = () => { try { return JSON.parse(localStorage.getItem(ORDERS_KEY)||'[]') } catch { return [] } }
export const saveOrders   = v  => { const s=JSON.stringify(v); dbSync(ORDERS_KEY, s) }
export const getUsers     = () => { try { return JSON.parse(localStorage.getItem(USERS_KEY)||'[]') } catch { return [] } }
export const saveUsers    = v  => { const s=JSON.stringify(v); dbSync(USERS_KEY, s) }
export const getNotifs    = () => { try { return JSON.parse(localStorage.getItem(NOTIFS_KEY)||'[]') } catch { return [] } }
export const saveNotifs   = v  => { const s=JSON.stringify(v); dbSync(NOTIFS_KEY, s) }

// ─── Pedidos (CRUD) ───────────────────────────────────────
export async function dbLoadPedidos(lojaCnpj) {
  let q = sb.from('pedidos')
    .select('*, pedido_itens(*), notas_fiscais(id,numero,data_emissao,valor_total_centavos,status_vinculo)')
    .order('created_at',{ascending:false})
  if (lojaCnpj) q = q.eq('loja_cnpj', lojaCnpj)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function dbSavePedido(form, itens, editId) {
  const cnpjRaw = normCnpj(form.loja_cnpj)
  if (!cnpjRaw) throw new Error('Selecione a loja')
  if (!form.numero?.trim()) throw new Error('Número do pedido obrigatório')
  if (!itens.length || !itens.some(i=>i.descricao?.trim())) throw new Error('Adicione ao menos 1 item')

  const pedidoRow = {
    numero:          form.numero.trim(),
    data_pedido:     form.data_pedido || new Date().toISOString().slice(0,10),
    loja_cnpj:       cnpjRaw,
    fornecedor:      form.fornecedor?.trim() || '',
    status:          form.status || 'aguardando',
    previsao_entrega:form.previsao_entrega || null,
    observacoes:     form.observacoes?.trim() || '',
    created_by:      form.created_by || '',
  }

  let pedidoId = editId
  if (editId) {
    const { error } = await sb.from('pedidos').update(pedidoRow).eq('id', editId)
    if (error) throw error
  } else {
    const { data, error } = await sb.from('pedidos').insert(pedidoRow).select('id').maybeSingle()
    if (error) throw error
    pedidoId = data.id
  }

  await sb.from('pedido_itens').delete().eq('pedido_id', pedidoId)
  const itensFiltrados = itens.filter(i => i.descricao?.trim())
  if (itensFiltrados.length) {
    await sb.from('pedido_itens').insert(itensFiltrados.map(i => ({
      pedido_id: pedidoId,
      codigo:    i.codigo?.trim() || '',
      descricao: i.descricao.trim(),
      quantidade:     parseFloat(i.quantidade)  || 0,
      valor_unit_centavos: toCents(i.valor_unit || 0),
    })))
  }
  return pedidoId
}

export async function dbDeletePedido(id) {
  await sb.from('pedidos').delete().eq('id', id)
}

// ─── Notas Fiscais (leitura) ──────────────────────────────
export async function dbLoadNotas(lojaCnpj, statusVinculo) {
  const since = new Date(); since.setDate(since.getDate() - 90)
  const sinceIso = since.toISOString().slice(0,10)
  let q = sb.from('notas_fiscais')
    .select('*, nf_itens(*), nf_pagamentos(*), pedidos(numero,fornecedor,status)')
    .gte('data_emissao', sinceIso)
    .order('data_emissao',{ascending:false})
  if (lojaCnpj)      q = q.eq('loja_cnpj', lojaCnpj)
  if (statusVinculo)  q = q.eq('status_vinculo', statusVinculo)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function dbVincularManual(nfId, pedidoId) {
  const { data: nf } = await sb.from('notas_fiscais').select('data_emissao,emit_cnpj,emit_uf').eq('id',nfId).maybeSingle()
  // Import here to avoid circular dependency issues at module load time
  const { calcPrevisaoChegada, detectarUF } = await import('./nf-logic.js')
  const previsao = nf ? calcPrevisaoChegada(nf.data_emissao, detectarUF(nf.emit_cnpj, nf.emit_uf)) : null
  await sb.from('notas_fiscais').update({
    pedido_id: pedidoId, status_vinculo:'vinculado', vinculo_motivo:'Vínculo manual',
    acao_necessaria: '', previsao_chegada: previsao,
  }).eq('id', nfId)
  await sb.from('pedidos').update({ status:'faturado', previsao_entrega: previsao, updated_at:new Date().toISOString() })
    .eq('id', pedidoId)
  await sb.from('vinculo_log').insert({ nf_id:nfId, pedido_id:pedidoId, evento:'confirmado', detalhe:'Vínculo manual pelo usuário' })
}

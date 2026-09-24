import { useEffect, useState } from 'react'

// Fichas técnicas e manuais Intelbras (public/fichas.json, gerado do levantamento do site intelbras.com).
// Só os LINKS ficam no sistema; o PDF é buscado na hora pelo nosso servidor (/intelbras-files/ no nginx),
// o que permite exibir dentro do painel e baixar com nome padronizado.
let _cache = null
let _promise = null

export function loadFichas() {
  if (_cache) return Promise.resolve(_cache)
  if (!_promise) {
    _promise = fetch(`${import.meta.env.BASE_URL}fichas.json`, { cache: 'force-cache' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        // Quando o arquivo nao existe, o try_files do nginx devolve o index.html com status 200.
        // Sem esta checagem o parse quebra e o recurso some de todas as telas sem deixar rastro.
        const ct = r.headers.get('content-type') || ''
        if (!ct.includes('json')) throw new Error(`resposta nao e JSON (${ct || 'sem content-type'})`)
        return r.json()
      })
      .then(j => { _cache = { base: j.base || '/intelbras-files/', itens: j.itens || {} }; return _cache })
      .catch(err => {
        console.error('[fichas] indice nao carregou; nenhum produto vai exibir ficha tecnica.', err)
        _promise = null
        return { base: '/intelbras-files/', itens: {}, erro: String(err?.message || err) }
      })
  }
  return _promise
}

export function getFicha(fichas, code) {
  const e = fichas?.itens?.[String(code || '').trim()]
  if (!e) return null
  const [modelo, ficha, manual] = e
  return {
    modelo,
    ficha:  ficha  ? fichas.base + ficha  : null,
    manual: manual ? fichas.base + manual : null,
  }
}

// Hook: carrega o índice uma vez (≈80 KB compactado) e devolve o mapa
export function useFichas() {
  const [f, setF] = useState(_cache)
  useEffect(() => { if (!_cache) loadFichas().then(setF) }, [])
  return f
}

// Abre o painel de ficha técnica (montado no App)
export function abrirFicha(item) {
  window.dispatchEvent(new CustomEvent('abrir-ficha', { detail: { code: item.code, description: item.description || '' } }))
}

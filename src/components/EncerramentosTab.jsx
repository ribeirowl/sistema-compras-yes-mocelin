import { useState, useMemo } from 'react'
import { useDebounce } from '../utils.js'
import { normStr } from '../utils.js'

export default function EncerramentosTab({ discontinuedMap }) {
  const [search, setSearch] = useState('')
  const dSearch = useDebounce(search, 250)

  const items = useMemo(() => {
    const arr = []
    discontinuedMap.forEach((v, code) => arr.push({ code, ...v }))
    arr.sort((a,b) => a.code.localeCompare(b.code))
    return arr
  }, [discontinuedMap])

  const filtered = useMemo(() => {
    if (!dSearch.trim()) return items
    const q = normStr(dSearch)
    return items.filter(i =>
      normStr(i.code).includes(q) ||
      normStr(i.description||'').includes(q) ||
      normStr(i.substitute||'').includes(q) ||
      normStr(i.substituteName||'').includes(q)
    )
  }, [items, dSearch])

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">🚫 Encerramentos</h2>
          <p className="page-subtitle">Produtos fora de linha e descontinuados · {items.length} itens</p>
        </div>
      </div>
      <div className="filter-bar">
        <input className="filter-search" placeholder="Buscar código, descrição ou substituto..." value={search} onChange={e=>setSearch(e.target.value)}/>
        <span style={{fontSize:12,color:'var(--muted)'}}>{filtered.length} itens</span>
      </div>
      {filtered.length===0
        ? <div className="table-empty"><div className="table-empty-icon">🚫</div><p>Nenhum item encerrado encontrado.</p></div>
        : (
          <div className="table-scroll" style={{overflowX:'auto'}}>
            <table className="product-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th>Cód. Substituto</th>
                  <th>Info do Substituto</th>
                  <th>Data Encerramento</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, idx) => (
                  <tr key={item.code} style={{background:idx%2===0?'var(--card)':'var(--surface)'}}>
                    <td className="mono">{item.code}</td>
                    <td style={{maxWidth:260,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={item.description||''}>{item.description||<span style={{color:'var(--muted2)'}}>—</span>}</td>
                    <td className="mono" style={{color:item.substitute?'var(--info)':'var(--muted2)'}}>{item.substitute||'—'}</td>
                    <td style={{maxWidth:300,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:item.substituteName?'var(--text)':'var(--muted2)'}} title={item.substituteName||''}>{item.substituteName||'—'}</td>
                    <td style={{fontSize:12,color:item.closedAt?'var(--muted)':'var(--muted2)'}}>{item.closedAt||'—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  )
}

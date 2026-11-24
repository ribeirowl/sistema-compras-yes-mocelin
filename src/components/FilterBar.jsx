import { useState, useEffect, useRef } from 'react'
import { PRIORITY_LABELS } from '../constants.js'

export default function FilterBar({ filters, sort, brands, onFilterChange, onSortChange, showBrandFilter, qtdPrioridade = 0 }) {
  const [searchVal, setSearchVal] = useState(filters.search ?? '')
  const debounceRef  = useRef(null)
  const filtersRef   = useRef(filters)
  useEffect(() => { filtersRef.current = filters }, [filters])

  // Sync local input when parent resets filters (e.g. tab change)
  useEffect(() => { setSearchVal(filters.search ?? '') }, [filters.search])

  const handleSearch = e => {
    const val = e.target.value
    setSearchVal(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onFilterChange({ ...filtersRef.current, search: val })
    }, 250)
  }

  const SORT_OPTS = [
    ['priority-asc',   'Prioridade ↑'],
    ['suggestion-desc','Sugestão ↓'],
    ['code-asc',       'Código A→Z'],
    ['totalValue-desc','Valor ↓'],
    ['brand-asc',      'Marca A→Z'],
  ]
  const sv = `${sort.col}-${sort.dir}`

  return (
    <div className="filter-bar">
      <input className="filter-search" type="text" placeholder="Buscar código, descrição, marca..."
        value={searchVal} onChange={handleSearch}/>
      <select className="filter-select" value={filters.priority??''}
        onChange={e=>onFilterChange({...filters,priority:e.target.value})}>
        <option value="">Todas prioridades</option>
        {['ALTA','MEDIA','NORMAL','BAIXA'].map(p=><option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
      </select>
      {showBrandFilter && brands.length>0 && (
        <select className="filter-select" value={filters.brand??''}
          onChange={e=>onFilterChange({...filters,brand:e.target.value})}>
          <option value="">Todas marcas</option>
          {brands.map(b=><option key={b} value={b}>{b}</option>)}
        </select>
      )}
      <select className="filter-select" value={sv}
        onChange={e=>{const[col,dir]=e.target.value.split('-');onSortChange({col,dir})}}>
        {SORT_OPTS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
      </select>
      <label className="filter-toggle">
        <input type="checkbox" checked={filters.onlySelected??false}
          onChange={e=>onFilterChange({...filters,onlySelected:e.target.checked})}/>
        <span>Só selecionados</span>
      </label>
      <label className="filter-toggle" style={{color:'var(--danger)'}}>
        <input type="checkbox" checked={filters.onlyRupturaCritica??false}
          onChange={e=>onFilterChange({...filters,onlyRupturaCritica:e.target.checked})}/>
        <span>Ruptura crítica (&lt;15d)</span>
      </label>
      {qtdPrioridade > 0 && (
        <label className="filter-toggle filtro-prio" title="Curva A com até 7 dias de estoque, ou citados na ruptura do resumo da IA">
          <input type="checkbox" checked={filters.onlyPrioridade??false}
            onChange={e=>onFilterChange({...filters,onlyPrioridade:e.target.checked})}/>
          <span>⚡ Prioridade ({qtdPrioridade})</span>
        </label>
      )}
    </div>
  )
}

import { PRIORITY_LABELS } from '../constants.js'

export default function FilterBar({ filters, sort, brands, onFilterChange, onSortChange, showBrandFilter }) {
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
        value={filters.search} onChange={e=>onFilterChange({...filters,search:e.target.value})}/>
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
    </div>
  )
}

import { useMemo } from 'react'
import { PRIORITY_ORDER, PRIORITY_BG, PRIORITY_COLORS, PRIORITY_LABELS } from '../constants.js'
import { normStr, fmtBRL } from '../utils.js'

export default function ProductTable({ items, selections, filters, sort, activeTab, groupByBrand, caps, onToggleSelect, onSetQty, onSetPv, onSelectAll }) {
  const filtered = useMemo(() => {
    let out = items
    const q = normStr(filters.search??'')
    if (q) out = out.filter(i => normStr(i.code).includes(q)||normStr(i.description).includes(q)||normStr(i.brand).includes(q))
    if (filters.priority) out = out.filter(i=>i.priority===filters.priority)
    if (filters.brand)    out = out.filter(i=>i.brand===filters.brand)
    if (filters.onlySelected) out = out.filter(i=>selections[i.id]?.selected)
    if (filters.onlyRupturaCritica) out = out.filter(i => {
      const days = i.avgMonthly > 0 ? Math.floor((i.stock / i.avgMonthly) * 30) : null
      return days !== null && days < 15
    })
    return out
  }, [items, filters, selections])

  const sorted = useMemo(() => {
    return [...filtered].sort((a,b)=>{
      let va, vb
      switch(sort.col) {
        case 'priority':   va=PRIORITY_ORDER[a.priority];   vb=PRIORITY_ORDER[b.priority]; break
        case 'totalValue': va=(selections[a.id]?.qty??a.adjustedQty)*a.pv; vb=(selections[b.id]?.qty??b.adjustedQty)*b.pv; break
        case 'suggestion': va=a.suggestion; vb=b.suggestion; break
        case 'code':       va=a.code;       vb=b.code;       break
        case 'brand':      va=a.brand;      vb=b.brand;      break
        default:           va=a[sort.col]??0; vb=b[sort.col]??0
      }
      if (va<vb) return sort.dir==='asc'?-1:1
      if (va>vb) return sort.dir==='asc'?1:-1
      return 0
    })
  }, [filtered, sort, selections])

  if (sorted.length===0) {
    return (
      <div className="table-empty">
        <div className="table-empty-icon">🔍</div>
        <p>{items.length===0?'Nenhum item nesta aba.':'Nenhum item corresponde aos filtros.'}</p>
      </div>
    )
  }

  const showBrand = activeTab==='OUTROS'||activeTab==='MANUAL'||activeTab==='SEM_PRECO'

  if (groupByBrand && activeTab==='OUTROS') {
    const brandMap = new Map()
    for (const item of sorted) {
      const b = item.brand||'DESCONHECIDA'
      if (!brandMap.has(b)) brandMap.set(b,[])
      brandMap.get(b).push(item)
    }
    return (
      <div className="table-groups">
        {[...brandMap.entries()].map(([brand,brandItems])=>{
          const bids = brandItems.map(i=>i.id)
          const allBSel = bids.every(id=>selections[id]?.selected)
          const bTotal = brandItems.reduce((s,i)=>{const q=selections[i.id]?.qty??i.adjustedQty;return s+q*i.pv},0)
          return (
            <div key={brand} className="brand-group">
              <div className="brand-group-header">
                {caps.canEdit && (
                  <label className="checkbox-wrap">
                    <input type="checkbox" checked={allBSel} onChange={()=>onSelectAll(bids,!allBSel)}/>
                  </label>
                )}
                <span className="brand-group-name">{brand}</span>
                <span className="brand-group-count">{brandItems.length} itens</span>
                {caps.seePrices&&bTotal>0&&<span className="brand-group-value">{fmtBRL(bTotal)}</span>}
              </div>
              <TableRows items={brandItems} selections={selections} showBrand={false}
                activeTab={activeTab} caps={caps} onToggleSelect={onToggleSelect} onSetQty={onSetQty} onSetPv={onSetPv}/>
            </div>
          )
        })}
      </div>
    )
  }

  const visibleIds  = sorted.map(i=>i.id)
  const allSelected = visibleIds.length>0 && visibleIds.every(id=>selections[id]?.selected)
  const someSelected= visibleIds.some(id=>selections[id]?.selected)
  const selCount    = sorted.filter(i=>selections[i.id]?.selected).length
  const selVal      = sorted.filter(i=>selections[i.id]?.selected).reduce((s,i)=>{const q=selections[i.id]?.qty??i.adjustedQty;return s+q*i.pv},0)

  return (
    <div className="table-wrap">
      {caps.canEdit && (
        <div className="table-toolbar">
          <label className="checkbox-wrap select-all-cb">
            <input type="checkbox" checked={allSelected}
              ref={el=>{if(el)el.indeterminate=someSelected&&!allSelected}}
              onChange={()=>onSelectAll(visibleIds,!allSelected)}/>
            <span>Selecionar tudo ({sorted.length})</span>
          </label>
          <span className="table-count">
            {selCount} selecionados
            {caps.seePrices&&' · '+fmtBRL(selVal)}
          </span>
        </div>
      )}
      <TableRows items={sorted} selections={selections} showBrand={showBrand}
        activeTab={activeTab} caps={caps} onToggleSelect={onToggleSelect} onSetQty={onSetQty} onSetPv={onSetPv}/>
    </div>
  )
}

export function TableRows({ items, selections, showBrand, activeTab, caps, onToggleSelect, onSetQty, onSetPv }) {
  const isOutros = activeTab === 'OUTROS'
  const storeAbbrev = label => {
    const s = String(label||'')
    if (/^1[-\s]/i.test(s)) return 'FB'
    if (/^2[-\s]/i.test(s)) return 'DV'
    if (/^3[-\s]/i.test(s)) return 'TL'
    return s.slice(0,3)
  }
  return (
    <div className="table-scroll">
      <table className="product-table">
        <thead>
          <tr>
            {caps.canEdit && <th className="col-cb"></th>}
            <th className="col-code">Código</th>
            <th className="col-desc">Descrição</th>
            {showBrand   && <th className="col-brand">Marca</th>}
            <th className="col-num">Sugestão</th>
            {caps.canEdit && <th className="col-num">Múltiplo</th>}
            {caps.canEdit && <th className="col-qty">Qtd. Final</th>}
            {caps.canEdit && <th className="col-num">Estoque</th>}
            {caps.canEdit && <th className="col-num">Reservado</th>}
            {caps.canEdit && <th className="col-num" title="Média de vendas mensal">Média/Mês</th>}
            {caps.canEdit && <th className="col-num" title="Vendas no mês atual">Mês Atual</th>}
            {caps.canEdit && <th className="col-num" title="Dias estimados até ruptura de estoque">Risco</th>}
            {caps.seePrices && <th className="col-price">{isOutros ? 'PV (edit.)' : 'PV'}</th>}
            {caps.seePrices && <th className="col-total">Total</th>}
            <th className="col-prio">Prioridade</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item,idx) => {
            const sel = selections[item.id] ?? { selected:false, qty:item.adjustedQty }
            const qty = sel.qty ?? item.adjustedQty
            const effectivePv = sel.pv ?? item.pv ?? 0
            const rowBg = sel.selected ? PRIORITY_BG[item.priority] : (idx%2===0?'var(--card)':'var(--surface)')
            const rowTotal = qty * effectivePv
            const hasBreakdown = isOutros && item.breakdown && item.breakdown.length > 1
            return (
              <tr key={item.id} style={{background:rowBg}} className={`product-row${sel.selected?' row-selected':''}`}>
                {caps.canEdit && (
                  <td className="col-cb">
                    <input type="checkbox" className="row-checkbox"
                      checked={sel.selected} onChange={()=>onToggleSelect(item.id)}/>
                  </td>
                )}
                <td className="col-code mono">
                  {item.code}
                  {item.isExpensive&&caps.seePrices&&<span className="expensive-tag" title="PV > R$2.500">💰</span>}
                </td>
                <td className="col-desc" title={item.description}>
                  {item.description}
                  {item.family&&<span className="family-tag">{item.family}</span>}
                </td>
                {showBrand&&<td className="col-brand"><span className="brand-badge">{item.brand||'—'}</span></td>}
                <td className="col-num"><span className="suggestion-val">{item.suggestion}</span></td>
                {caps.canEdit&&<td className="col-num num">{item.multiple>1?item.multiple:'—'}</td>}
                {caps.canEdit&&(
                  <td className="col-qty">
                    <input type="number" className="qty-input" min="0"
                      step={item.multiple>1?item.multiple:1}
                      value={qty}
                      onChange={e=>onSetQty(item.id,parseInt(e.target.value,10)||0)}
                      disabled={!sel.selected}
                      title={item.multiple>1?`Múltiplo de ${item.multiple}`:''}/>
                  </td>
                )}
                {caps.canEdit&&(
                  <td className="col-num num">
                    {item.stock}
                    {hasBreakdown&&(
                      <div style={{fontSize:10,color:'var(--muted)',lineHeight:1.3,marginTop:2,whiteSpace:'nowrap'}}>
                        {item.breakdown.map(b=>`${storeAbbrev(b.label)}: ${b.stock}`).join(' | ')}
                      </div>
                    )}
                  </td>
                )}
                {caps.canEdit&&<td className="col-num num">{item.reserved}</td>}
                {caps.canEdit&&<td className="col-num num" style={{color:'var(--muted)'}}>{item.avgMonthly>0?Math.round(item.avgMonthly):'—'}</td>}
                {caps.canEdit&&<td className="col-num num" style={{color:item.currentMonthSales>0?'var(--success)':'var(--muted)'}}>{item.currentMonthSales>0?Math.round(item.currentMonthSales):'—'}</td>}
                {caps.canEdit&&(()=>{
                  const days = item.avgMonthly > 0 ? Math.floor((item.stock / item.avgMonthly) * 30) : null
                  let bg, color, label
                  if (days === null)    { bg='var(--card2)';      color='var(--muted)';   label='Sem dados' }
                  else if (days === 0) { bg='var(--danger)';     color='#fff';           label='ZERADO' }
                  else if (days < 15)  { bg='var(--danger-bg)';  color='var(--danger)';  label=`Crítico · ${days}d` }
                  else if (days <= 30) { bg='var(--warning-bg)'; color='var(--warning)'; label=`Atenção · ${days}d` }
                  else                 { bg='var(--success-bg)'; color='var(--success)'; label=`OK · ${days}d` }
                  return (
                    <td className="col-num">
                      <span style={{display:'inline-block',padding:'2px 7px',borderRadius:10,fontSize:11,fontWeight:days!==null&&days<15?'bold':'normal',background:bg,color,border:`1px solid ${color}44`,whiteSpace:'nowrap'}}>
                        {label}
                      </span>
                    </td>
                  )
                })()}
                {caps.seePrices&&(
                  <td className="col-price num">
                    {isOutros && onSetPv ? (
                      <input type="number" className="qty-input" min="0" step="0.01"
                        style={{width:80,textAlign:'right'}}
                        value={effectivePv||''}
                        placeholder="0,00"
                        onChange={e=>onSetPv(item.id, parseFloat(e.target.value)||0)}/>
                    ) : (
                      item.pv>0 ? fmtBRL(item.pv) : <span className="no-price">S/P</span>
                    )}
                  </td>
                )}
                {caps.seePrices&&(
                  <td className="col-total num">
                    {rowTotal>0?<strong className={rowTotal>30000?'value-high':''}>{fmtBRL(rowTotal)}</strong>:'—'}
                  </td>
                )}
                <td className="col-prio">
                  <span className="priority-badge"
                    style={{background:PRIORITY_BG[item.priority],color:PRIORITY_COLORS[item.priority],border:`1px solid ${PRIORITY_COLORS[item.priority]}44`}}>
                    {PRIORITY_LABELS[item.priority]}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

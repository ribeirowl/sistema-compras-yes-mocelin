import { useMemo, useState, useEffect, useRef } from 'react'
import { PRIORITY_ORDER, PRIORITY_BG, PRIORITY_COLORS, PRIORITY_LABELS } from '../constants.js'
import { normStr, fmtBRL } from '../utils.js'
import { useColumnPrefs } from '../columnPrefs.jsx'
import ColumnCustomizer from './ColumnCustomizer.jsx'

const DENSITY = {
  compact:     { padding: '2px 7px',  fontSize: 10 },
  normal:      { padding: '5px 9px',  fontSize: 10.5 },
  comfortable: { padding: '9px 12px', fontSize: 12 },
}

const storeAbbrev = label => {
  const s = String(label||'')
  if (/^1[-\s]/i.test(s)) return 'FB'
  if (/^2[-\s]/i.test(s)) return 'DV'
  if (/^3[-\s]/i.test(s)) return 'TL'
  return s.slice(0,3)
}

export default function ProductTable({ items, selections, filters, sort, activeTab, groupByBrand, caps, onToggleSelect, onSetQty, onSetPv, onSelectAll }) {
  const isOutros  = activeTab === 'OUTROS'
  const showBrand = activeTab==='OUTROS'||activeTab==='MANUAL'||activeTab==='SEM_PRECO'

  // ── Filtro + ordenação (igual ao comportamento anterior) ──
  const normalizedItems = useMemo(() =>
    items.map(i => ({ ...i, _nc: normStr(i.code), _nd: normStr(i.description), _nb: normStr(i.brand) }))
  , [items])

  const filtered = useMemo(() => {
    let out = normalizedItems
    const q = normStr(filters.search??'')
    if (q) out = out.filter(i => i._nc.includes(q)||i._nd.includes(q)||i._nb.includes(q))
    if (filters.priority) out = out.filter(i=>i.priority===filters.priority)
    if (filters.brand)    out = out.filter(i=>i.brand===filters.brand)
    if (filters.onlySelected) out = out.filter(i=>selections[i.id]?.selected)
    if (filters.onlyRupturaCritica) out = out.filter(i => {
      const days = i.avgMonthly > 0 ? Math.floor((i.stock / i.avgMonthly) * 30) : null
      return days !== null && days < 15
    })
    return out
  }, [normalizedItems, filters, selections])

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

  // ── Definição das colunas (dinâmicas conforme permissões / aba) ──
  const columns = useMemo(() => {
    const cols = []
    cols.push({ id:'code', label:'Código', alwaysVisible:true, defaultWidth:92,
      render:item=>(<span className="mono">{item.code}{item.isExpensive&&caps.seePrices&&<span className="expensive-tag" title="PV > R$2.500">💰</span>}</span>) })
    cols.push({ id:'description', label:'Descrição', defaultWidth:210,
      render:item=>(<span title={item.description}>{item.description}{item.family&&<span className="family-tag">{item.family}</span>}</span>) })
    if (showBrand) cols.push({ id:'brand', label:'Marca', defaultWidth:96,
      render:item=><span className="brand-badge">{item.brand||'—'}</span> })
    cols.push({ id:'suggestion', label:'Sugest.', align:'right', defaultWidth:70,
      render:item=><span className="suggestion-val">{item.suggestion}</span> })
    if (caps.canEdit) cols.push({ id:'multiple', label:'Múlt.', align:'right', defaultWidth:60,
      render:item=> item.multiple>1?item.multiple:'—' })
    if (caps.canEdit) cols.push({ id:'qty', label:'Qtd.', align:'right', defaultWidth:82,
      render:item=>{
        const sel = selections[item.id] ?? { selected:false, qty:item.adjustedQty }
        const qty = sel.qty ?? item.adjustedQty
        return <input type="number" className="qty-input" min="0" step={item.multiple>1?item.multiple:1}
          value={qty} disabled={!sel.selected}
          onChange={e=>onSetQty(item.id,parseInt(e.target.value,10)||0)}
          title={item.multiple>1?`Múltiplo de ${item.multiple}`:''}/>
      } })
    if (caps.canEdit) cols.push({ id:'stock', label:'Estoque', align:'right', defaultWidth:80, wrap:isOutros,
      render:item=>{
        const hasBreakdown = isOutros && item.breakdown && item.breakdown.length > 1
        return <>{item.stock}{hasBreakdown&&(
          <div style={{fontSize:10,color:'var(--muted)',lineHeight:1.3,marginTop:2,whiteSpace:'nowrap'}}>
            {item.breakdown.map(b=>`${storeAbbrev(b.label)}: ${b.stock}`).join(' | ')}
          </div>)}</>
      } })
    if (caps.canEdit) cols.push({ id:'reserved', label:'Reserv.', align:'right', defaultWidth:64,
      render:item=>item.reserved })
    if (caps.canEdit) cols.push({ id:'avgMonthly', label:'Méd/Mês', align:'right', defaultWidth:72,
      render:item=><span style={{color:'var(--muted)'}}>{item.avgMonthly>0?Math.round(item.avgMonthly):'—'}</span> })
    if (caps.canEdit) cols.push({ id:'currentMonthSales', label:'Mês At.', align:'right', defaultWidth:66,
      render:item=><span style={{color:item.currentMonthSales>0?'var(--success)':'var(--muted)'}}>{item.currentMonthSales>0?Math.round(item.currentMonthSales):'—'}</span> })
    if (caps.canEdit) cols.push({ id:'risk', label:'Risco', defaultWidth:82,
      render:item=>{
        const days = item.avgMonthly > 0 ? Math.floor((item.stock / item.avgMonthly) * 30) : null
        let bg, color, label
        if (days === null)   { bg='var(--card2)';      color='var(--muted)';   label='—' }
        else if (days === 0) { bg='var(--danger)';     color='#fff';           label='ZERO' }
        else if (days < 15)  { bg='var(--danger-bg)';  color='var(--danger)';  label=`Crit. ${days}d` }
        else if (days <= 30) { bg='var(--warning-bg)'; color='var(--warning)'; label=`At. ${days}d` }
        else                 { bg='var(--success-bg)'; color='var(--success)'; label=`OK ${days}d` }
        return <span style={{display:'inline-block',padding:'2px 7px',borderRadius:10,fontSize:11,fontWeight:days!==null&&days<15?'bold':'normal',background:bg,color,border:`1px solid ${color}44`,whiteSpace:'nowrap'}}>{label}</span>
      } })
    if (caps.seePrices) cols.push({ id:'pv', label:isOutros?'PV (ed.)':'PV', align:'right', defaultWidth:86,
      render:item=>{
        const effectivePv = selections[item.id]?.pv ?? item.pv ?? 0
        if (isOutros && onSetPv) return <input type="number" className="qty-input" min="0" step="0.01"
          style={{width:80,textAlign:'right'}} value={effectivePv||''} placeholder="0,00"
          onChange={e=>onSetPv(item.id, parseFloat(e.target.value)||0)}/>
        return item.pv>0 ? fmtBRL(item.pv) : <span className="no-price">S/P</span>
      } })
    if (caps.seePrices) cols.push({ id:'total', label:'Total', align:'right', defaultWidth:90,
      render:item=>{
        const sel = selections[item.id] ?? {}
        const rowTotal = (sel.qty ?? item.adjustedQty) * (sel.pv ?? item.pv ?? 0)
        return rowTotal>0 ? <strong className={rowTotal>30000?'value-high':''}>{fmtBRL(rowTotal)}</strong> : '—'
      } })
    cols.push({ id:'priority', label:'Prior.', defaultWidth:74,
      render:item=><span className="priority-badge" style={{background:PRIORITY_BG[item.priority],color:PRIORITY_COLORS[item.priority],border:`1px solid ${PRIORITY_COLORS[item.priority]}44`}}>{PRIORITY_LABELS[item.priority]}</span> })
    return cols
  }, [caps, showBrand, isOutros, selections, onSetQty, onSetPv])

  const cp = useColumnPrefs('sugestoes', columns)
  const cols = cp.visibleColumns
  const dens = DENSITY[cp.density] || DENSITY.normal
  const [showCust, setShowCust] = useState(false)

  // ── Redimensionamento por arrasto ──
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null); dragRef.current = drag
  const widthOf = col => (drag && drag.id===col.id ? drag.curW : null) ?? cp.widths[col.id] ?? col.defaultWidth ?? 110
  useEffect(() => {
    if (!drag) return
    const onMove = e => { const d=dragRef.current; if(d) setDrag({ ...d, curW: Math.max(40, d.startW + (e.clientX - d.startX)) }) }
    const onUp = () => { const d=dragRef.current; if(d) cp.setWidth(d.id, d.curW); setDrag(null) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [drag, cp])
  const startResize = (e, col) => {
    e.preventDefault(); e.stopPropagation()
    const th = e.target.closest('th')
    const w = th ? th.offsetWidth : widthOf(col)
    setDrag({ id: col.id, startX: e.clientX, startW: w, curW: w })
  }

  const customizeBtn = (
    <button className="btn btn-sm btn-ghost" onClick={()=>setShowCust(true)} title="Personalizar colunas">⚙ Colunas</button>
  )

  if (sorted.length===0) {
    return (
      <>
        <div className="table-toolbar"><span className="table-count" style={{flex:1}}/>{customizeBtn}</div>
        <div className="table-empty">
          <div className="table-empty-icon">🔍</div>
          <p>{items.length===0?'Nenhum item nesta aba.':'Nenhum item corresponde aos filtros.'}</p>
        </div>
        {showCust && <ColumnCustomizer cp={cp} onClose={()=>setShowCust(false)} />}
      </>
    )
  }

  const renderHead = () => (
    <thead>
      <tr>
        {caps.canEdit && <th className="col-cb" style={{width:30,padding:dens.padding}}/>}
        {cols.map(col=>(
          <th key={col.id} style={{textAlign:col.align||'left',padding:dens.padding,position:'relative',userSelect:'none'}}>
            {col.label}
            <span onMouseDown={e=>startResize(e,col)} title="Arrastar para redimensionar"
              style={{position:'absolute',top:0,right:0,width:8,height:'100%',cursor:'col-resize',zIndex:2}}/>
          </th>
        ))}
      </tr>
    </thead>
  )

  const renderRow = (item, idx) => {
    const sel = selections[item.id] ?? { selected:false, qty:item.adjustedQty }
    const rowBg = sel.selected ? PRIORITY_BG[item.priority] : (idx%2===0?'var(--card)':'var(--surface)')
    return (
      <tr key={item.id} style={{background:rowBg}} className={`product-row${sel.selected?' row-selected':''}`}>
        {caps.canEdit && (
          <td className="col-cb" style={{padding:dens.padding,textAlign:'center'}}>
            <input type="checkbox" className="row-checkbox" checked={sel.selected} onChange={()=>onToggleSelect(item.id)}/>
          </td>
        )}
        {cols.map(col=>(
          <td key={col.id} style={{textAlign:col.align||'left',padding:dens.padding,fontSize:dens.fontSize,
            overflow:'hidden',textOverflow:'ellipsis',whiteSpace:col.wrap?'normal':'nowrap'}}>
            {col.render(item, idx)}
          </td>
        ))}
      </tr>
    )
  }

  const colGroup = (
    <colgroup>
      {caps.canEdit && <col style={{width:30}}/>}
      {cols.map(col=><col key={col.id} style={{width:widthOf(col)}}/>)}
    </colgroup>
  )

  const totalColSpan = (caps.canEdit?1:0) + cols.length

  // ── Visão agrupada por marca (OUTROS) ──
  if (groupByBrand && isOutros) {
    const brandMap = new Map()
    for (const item of sorted) {
      const b = item.brand||'DESCONHECIDA'
      if (!brandMap.has(b)) brandMap.set(b,[])
      brandMap.get(b).push(item)
    }
    return (
      <div className="table-wrap">
        <div className="table-toolbar"><span className="table-count" style={{flex:1}}/>{customizeBtn}</div>
        <div className="table-scroll" style={{overflowX:'auto'}}>
          <table className="product-table tbl-fixed" style={{width:'100%'}}>
            {colGroup}
            {renderHead()}
            <tbody>
              {[...brandMap.entries()].map(([brand,brandItems])=>{
                const bids = brandItems.map(i=>i.id)
                const allBSel = bids.every(id=>selections[id]?.selected)
                const bTotal = brandItems.reduce((s,i)=>{const q=selections[i.id]?.qty??i.adjustedQty;return s+q*i.pv},0)
                return (
                  <Brand key={brand} brand={brand} count={brandItems.length} total={bTotal}
                    allSel={allBSel} colSpan={totalColSpan} canEdit={caps.canEdit} seePrices={caps.seePrices}
                    dens={dens} onToggle={()=>onSelectAll(bids,!allBSel)}>
                    {brandItems.map((item,idx)=>renderRow(item,idx))}
                  </Brand>
                )
              })}
            </tbody>
          </table>
        </div>
        {showCust && <ColumnCustomizer cp={cp} onClose={()=>setShowCust(false)} />}
      </div>
    )
  }

  // ── Visão padrão ──
  const visibleIds  = sorted.map(i=>i.id)
  const allSelected = visibleIds.length>0 && visibleIds.every(id=>selections[id]?.selected)
  const someSelected= visibleIds.some(id=>selections[id]?.selected)
  const selCount    = sorted.filter(i=>selections[i.id]?.selected).length
  const selVal      = sorted.filter(i=>selections[i.id]?.selected).reduce((s,i)=>{const q=selections[i.id]?.qty??i.adjustedQty;return s+q*i.pv},0)

  return (
    <div className="table-wrap">
      <div className="table-toolbar">
        {caps.canEdit && (
          <label className="checkbox-wrap select-all-cb">
            <input type="checkbox" checked={allSelected}
              ref={el=>{if(el)el.indeterminate=someSelected&&!allSelected}}
              onChange={()=>onSelectAll(visibleIds,!allSelected)}/>
            <span>Selecionar tudo ({sorted.length})</span>
          </label>
        )}
        <span className="table-count" style={{flex:1}}>
          {selCount} selecionados{caps.seePrices&&' · '+fmtBRL(selVal)}
        </span>
        {customizeBtn}
      </div>
      <div className="table-scroll" style={{overflowX:'auto'}}>
        <table className="product-table tbl-fixed" style={{width:'100%'}}>
          {colGroup}
          {renderHead()}
          <tbody>
            {sorted.map((item,idx)=>renderRow(item,idx))}
          </tbody>
        </table>
      </div>
      {showCust && <ColumnCustomizer cp={cp} onClose={()=>setShowCust(false)} />}
    </div>
  )
}

function Brand({ brand, count, total, allSel, colSpan, canEdit, seePrices, dens, onToggle, children }) {
  return (
    <>
      <tr className="brand-group-row">
        <td colSpan={colSpan} style={{padding:dens.padding,background:'var(--surface2)'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            {canEdit && <input type="checkbox" checked={allSel} onChange={onToggle}/>}
            <span className="brand-group-name" style={{fontWeight:700}}>{brand}</span>
            <span className="brand-group-count" style={{color:'var(--muted)',fontSize:11}}>{count} itens</span>
            {seePrices&&total>0&&<span className="brand-group-value" style={{marginLeft:'auto',fontWeight:700}}>{fmtBRL(total)}</span>}
          </div>
        </td>
      </tr>
      {children}
    </>
  )
}

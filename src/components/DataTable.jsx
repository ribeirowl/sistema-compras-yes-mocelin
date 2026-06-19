import { useState, useEffect, useRef, Fragment } from 'react'
import { useColumnPrefs } from '../columnPrefs.jsx'
import ColumnCustomizer from './ColumnCustomizer.jsx'

const DENSITY = {
  compact:     { padding: '2px 7px',  fontSize: 10 },
  normal:      { padding: '5px 9px',  fontSize: 10.5 },
  comfortable: { padding: '9px 12px', fontSize: 12 },
}

// Planilha genérica e personalizável por usuário.
// Props:
//   tableId   — id único da planilha (chave das preferências)
//   columns   — [{ id, label, align?, defaultWidth?, alwaysVisible?, render(row,idx), headerExtra? }]
//   rows      — array de dados
//   rowKey    — (row, idx) => key
//   rowStyle  — (row, idx) => style (opcional)
//   empty     — mensagem quando não há linhas
//   toolbar   — nós extras à esquerda do botão Colunas (opcional)
//   expandedContent — (row,idx) => node|null : se retornar conteúdo, a linha vira expansível
export default function DataTable({ tableId, columns, rows, rowKey, rowStyle, empty = 'Nenhum registro.', toolbar, expandedContent }) {
  const cp = useColumnPrefs(tableId, columns)
  const [showCust, setShowCust] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())
  const [drag, setDrag] = useState(null) // { id, startX, startW, curW }
  const dragRef = useRef(null)
  dragRef.current = drag

  const widthOf = col =>
    (drag && drag.id === col.id ? drag.curW : null) ?? cp.widths[col.id] ?? col.defaultWidth ?? 120

  useEffect(() => {
    if (!drag) return
    const onMove = e => {
      const d = dragRef.current
      if (!d) return
      setDrag({ ...d, curW: Math.max(40, d.startW + (e.clientX - d.startX)) })
    }
    const onUp = () => {
      const d = dragRef.current
      if (d) cp.setWidth(d.id, d.curW)
      setDrag(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [drag, cp])

  const startResize = (e, col) => {
    e.preventDefault(); e.stopPropagation()
    const th = e.target.closest('th')
    setDrag({ id: col.id, startX: e.clientX, startW: th ? th.offsetWidth : widthOf(col), curW: th ? th.offsetWidth : widthOf(col) })
  }

  const dens = DENSITY[cp.density] || DENSITY.normal
  const cols = cp.visibleColumns

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        {toolbar}
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm btn-ghost" onClick={() => setShowCust(true)} title="Personalizar colunas">
          ⚙ Colunas
        </button>
      </div>

      <div className="table-scroll" style={{ overflowX: 'auto' }}>
        <table className="product-table tbl-fixed" style={{ width: '100%' }}>
          <colgroup>
            {cols.map(col => <col key={col.id} style={{ width: widthOf(col) }} />)}
          </colgroup>
          <thead>
            <tr>
              {cols.map(col => (
                <th key={col.id}
                  style={{ textAlign: col.align || 'left', padding: dens.padding, position: 'relative', userSelect: 'none' }}>
                  {col.label}
                  <span
                    onMouseDown={e => startResize(e, col)}
                    title="Arrastar para redimensionar"
                    style={{
                      position: 'absolute', top: 0, right: 0, width: 8, height: '100%',
                      cursor: 'col-resize', zIndex: 2,
                    }} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={cols.length} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>{empty}</td></tr>
            ) : rows.map((row, idx) => {
              const key = rowKey ? rowKey(row, idx) : idx
              const exp = expandedContent ? expandedContent(row, idx) : null
              const isOpen = exp && expanded.has(key)
              return (
                <Fragment key={key}>
                  <tr
                    style={{ ...(rowStyle ? rowStyle(row, idx) : undefined), cursor: exp ? 'pointer' : undefined }}
                    className="product-row"
                    onClick={exp ? () => setExpanded(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n }) : undefined}>
                    {cols.map(col => (
                      <td key={col.id}
                        style={{ textAlign: col.align || 'left', padding: dens.padding, fontSize: dens.fontSize,
                                 overflow: 'hidden', textOverflow: 'ellipsis',
                                 whiteSpace: col.wrap ? 'normal' : 'nowrap', ...(col.cellStyle || {}) }}>
                        {col.render ? col.render(row, idx) : row[col.id]}
                      </td>
                    ))}
                  </tr>
                  {isOpen && (
                    <tr><td colSpan={cols.length} style={{ padding: 0, background: 'var(--surface2)' }}>{exp}</td></tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {showCust && <ColumnCustomizer cp={cp} onClose={() => setShowCust(false)} />}
    </div>
  )
}

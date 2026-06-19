// Painel de personalização de colunas de uma planilha.
// Props: cp (retorno de useColumnPrefs), onClose
export default function ColumnCustomizer({ cp, onClose }) {
  const { allOrdered, hidden, density, setHidden, setOrder, setDensity, reset } = cp
  const ids = allOrdered.map(c => c.id)

  const move = (idx, dir) => {
    const j = idx + dir
    if (j < 0 || j >= ids.length) return
    const next = [...ids]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    setOrder(next)
  }

  const visibleCount = allOrdered.filter(c => c.alwaysVisible || !hidden.has(c.id)).length

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460, width: '95vw' }}>
        <div className="modal-header">
          <h2 className="modal-title">Personalizar colunas</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Densidade:</span>
            {[['compact', 'Compacto'], ['normal', 'Normal'], ['comfortable', 'Largo']].map(([v, lbl]) => (
              <button key={v}
                className="btn btn-sm"
                style={{
                  background: density === v ? 'var(--accent)' : 'var(--card2)',
                  color: density === v ? '#000' : 'var(--muted)',
                  border: `1px solid ${density === v ? 'var(--accent)' : 'var(--border)'}`,
                }}
                onClick={() => setDensity(v)}>{lbl}</button>
            ))}
          </div>

          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>
            Colunas ({visibleCount} visíveis)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '50vh', overflowY: 'auto' }}>
            {allOrdered.map((col, idx) => {
              const isHidden = !col.alwaysVisible && hidden.has(col.id)
              return (
                <div key={col.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: 'var(--surface2)', borderRadius: 6, padding: '6px 10px',
                    opacity: isHidden ? 0.55 : 1,
                  }}>
                  <input type="checkbox"
                    checked={col.alwaysVisible || !hidden.has(col.id)}
                    disabled={col.alwaysVisible}
                    onChange={e => setHidden(col.id, !e.target.checked)}
                    title={col.alwaysVisible ? 'Coluna fixa' : 'Mostrar/ocultar'} />
                  <span style={{ flex: 1, fontSize: 13 }}>{col.label || col.id}</span>
                  <button className="btn btn-sm btn-ghost" style={{ padding: '2px 7px' }}
                    disabled={idx === 0} onClick={() => move(idx, -1)} title="Subir">▲</button>
                  <button className="btn btn-sm btn-ghost" style={{ padding: '2px 7px' }}
                    disabled={idx === allOrdered.length - 1} onClick={() => move(idx, +1)} title="Descer">▼</button>
                </div>
              )
            })}
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 10 }}>
            Dica: arraste a borda direita do cabeçalho de cada coluna para ajustar a largura.
          </p>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => reset()}>↺ Restaurar padrão</button>
          <button className="btn btn-yellow" onClick={onClose}>Pronto</button>
        </div>
      </div>
    </div>
  )
}

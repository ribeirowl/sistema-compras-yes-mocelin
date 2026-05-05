import { useMemo } from 'react'
import { fmtBRL, fmtDate } from '../utils.js'

export default function PurchaseOrderModal({ items, selections, tabLabel, logo, onClose }) {
  const selectedItems = useMemo(()=>
    items.filter(i=>selections[i.id]?.selected)
      .map(i=>({...i,exportQty:selections[i.id]?.qty??i.adjustedQty}))
      .filter(i=>i.exportQty>0)
  ,[items,selections])

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-print">
        <div className="modal-header no-print">
          <h2 className="modal-title">Pedido de Compra</h2>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-yellow" onClick={()=>window.print()}>🖨️ Imprimir</button>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="print-doc">
          <div className="print-header">
            {logo&&<img src={logo} alt="Logo" className="print-logo"/>}
            <div>
              <h1 className="print-title">PEDIDO DE COMPRA</h1>
              <p className="print-meta">{tabLabel} · {fmtDate(new Date())} · {selectedItems.length} itens</p>
            </div>
          </div>
          <table className="print-table">
            <thead><tr><th>Código</th><th>Descrição</th><th>UN</th><th>QTDE</th></tr></thead>
            <tbody>
              {selectedItems.map(i=>(
                <tr key={i.id}><td>{i.code}</td><td>{i.description}</td><td>UN</td><td>{i.exportQty}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="print-footer">
            <p>Total: {selectedItems.length} itens · Gerado em {fmtDate(new Date())}</p>
            <p className="print-author">Gabriel Ribeiro · Yes Mocelin Distribuidora</p>
          </div>
        </div>
      </div>
    </div>
  )
}

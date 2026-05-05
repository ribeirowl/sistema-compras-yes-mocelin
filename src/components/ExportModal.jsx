import { useState, useMemo } from 'react'
import { fmtBRL, dlBlob, todayStr } from '../utils.js'
import { calcOrderSplit } from '../rules.js'
import { LOGO_KEY } from '../constants.js'

export default function ExportModal({ items, selections, tabLabel, activeTab, cityGroup, caps, onClose }) {
  const [copied,     setCopied]     = useState(false)
  const [separator,  setSeparator]  = useState('semicolon')
  const [groupBrand, setGroupBrand] = useState(activeTab==='OUTROS')

  const selectedItems = useMemo(() =>
    items.filter(i=>selections[i.id]?.selected)
      .map(i=>({...i, exportQty:selections[i.id]?.qty??i.adjustedQty, pv:selections[i.id]?.pv??i.pv??0}))
      .filter(i=>i.exportQty>0)
  , [items,selections])

  const sep = separator==='semicolon' ? ';' : separator==='tab' ? '\t' : '    '

  const exportText = useMemo(() => {
    if (groupBrand && activeTab==='OUTROS') {
      const bm = new Map()
      selectedItems.forEach(i=>{const b=i.brand||'DESCONHECIDA';if(!bm.has(b))bm.set(b,[]);bm.get(b).push(i)})
      const lines=[]
      for (const [brand,bi] of bm) { lines.push(`# ${brand}`); bi.forEach(i=>lines.push(`${i.code}${sep}${i.exportQty}`)); lines.push('') }
      return lines.join('\n')
    }
    return selectedItems.map(i=>`${i.code}${sep}${i.exportQty}`).join('\n')
  }, [selectedItems,sep,groupBrand,activeTab])

  const totalValue = selectedItems.reduce((s,i)=>s+i.exportQty*i.pv, 0)
  const split = cityGroup ? calcOrderSplit(totalValue, cityGroup) : null

  const doCopy = async () => {
    try { await navigator.clipboard.writeText(exportText) }
    catch { const el=document.getElementById('exp-ta'); el?.select(); document.execCommand('copy') }
    setCopied(true); setTimeout(()=>setCopied(false),2000)
  }

  const dlCSV = () => {
    const rows = selectedItems.map(i=>`${i.code};${i.exportQty}`)
    dlBlob(new Blob(['﻿'+rows.join('\n')],{type:'text/csv;charset=utf-8;'}),
      `pedido_${tabLabel.replace(/\s/g,'_')}_${todayStr()}.csv`)
  }

  const dlTXT = () => dlBlob(new Blob([exportText],{type:'text/plain;charset=utf-8;'}),
    `pedido_${tabLabel.replace(/\s/g,'_')}_${todayStr()}.txt`)

  const dlPDF = () => {
    const logo = localStorage.getItem(LOGO_KEY)
    const logoHtml = logo ? `<img src="${logo}" style="max-height:60px;max-width:200px;object-fit:contain;" alt="logo"/>` : ''
    const rows = selectedItems.map(i => `
      <tr>
        <td style="font-family:monospace;white-space:nowrap">${i.code}</td>
        <td>${i.description}</td>
        <td>${i.brand||'—'}</td>
        <td style="text-align:right">${i.exportQty}</td>
        <td style="text-align:right">${i.pv>0?fmtBRL(i.pv):'—'}</td>
        <td style="text-align:right"><strong>${fmtBRL(i.exportQty*i.pv)}</strong></td>
      </tr>`).join('')
    const content = `
      <div style="font-family:Arial,sans-serif;font-size:12px;color:#111;padding:32px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
          <div>
            <h2 style="margin:0 0 4px">${tabLabel} — Pedido de Compra</h2>
            <p style="color:#555;margin:0;font-size:11px">Gerado em ${todayStr()} · ${selectedItems.length} itens</p>
          </div>
          ${logoHtml}
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#222;color:#fff">
              <th style="padding:6px 8px;text-align:left">Código</th>
              <th style="padding:6px 8px;text-align:left">Descrição</th>
              <th style="padding:6px 8px;text-align:left">Marca</th>
              <th style="padding:6px 8px;text-align:right">Qtd</th>
              <th style="padding:6px 8px;text-align:right">PV</th>
              <th style="padding:6px 8px;text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr style="border-top:2px solid #222;background:#f5f5f5;font-weight:bold">
              <td colspan="4" style="padding:6px 8px">Total</td>
              <td></td>
              <td style="padding:6px 8px;text-align:right">${fmtBRL(totalValue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`

    // visibility technique: hide entire body then reveal only the PDF div
    // more reliable than display:none because visibility inherits and can be overridden
    const styleEl = document.createElement('style')
    styleEl.id = '__pdf-style'
    styleEl.textContent = `
      @media screen { #__pdf-root { display: none !important; } }
      @media print {
        body, body * { visibility: hidden !important; }
        #__pdf-root, #__pdf-root * { visibility: visible !important; }
        #__pdf-root { position: absolute !important; top: 0 !important; left: 0 !important; width: 100% !important; }
        @page { margin: 15mm; }
      }
    `

    const root = document.createElement('div')
    root.id = '__pdf-root'
    root.innerHTML = content

    document.head.appendChild(styleEl)
    document.body.appendChild(root)

    window.print()

    const cleanup = () => {
      document.getElementById('__pdf-root')  && document.body.removeChild(root)
      document.getElementById('__pdf-style') && document.head.removeChild(styleEl)
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    setTimeout(cleanup, 60000)
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Exportar Pedido</h2>
            <p className="modal-sub">{tabLabel} · {selectedItems.length} itens{caps.seePrices?` · ${fmtBRL(totalValue)}`:''}</p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {split&&split.days>1&&(
          <div className="split-warning">
            ⚠️ Valor total ({fmtBRL(totalValue)}) ultrapassa o limite diário ({fmtBRL(split.limit)}).
            Divida em <strong>{split.days} pedidos</strong> de dias úteis consecutivos.
          </div>
        )}
        <div className="modal-options">
          <div className="option-group">
            <span className="option-label">Separador:</span>
            {[['semicolon','Ponto e vírgula ( ; )'],['tab','Tab'],['space','Espaços']].map(([id,lbl])=>(
              <label key={id} className="radio-label">
                <input type="radio" name="sep" value={id} checked={separator===id} onChange={()=>setSeparator(id)}/>
                {lbl}
              </label>
            ))}
          </div>
          {activeTab==='OUTROS'&&(
            <label className="filter-toggle">
              <input type="checkbox" checked={groupBrand} onChange={e=>setGroupBrand(e.target.checked)}/>
              <span>Agrupar por marca</span>
            </label>
          )}
        </div>
        <div className="modal-preview">
          <div className="modal-preview-header"><span>Prévia</span><span>{selectedItems.length} linhas</span></div>
          <textarea id="exp-ta" className="export-textarea" readOnly value={exportText}
            rows={Math.min(12,selectedItems.length+2)}/>
        </div>
        {caps.seePrices&&selectedItems.length>0&&(
          <div className="modal-items">
            <table className="export-summary-table">
              <thead><tr><th>Código</th><th>Descrição</th><th>Marca</th><th>Qtd</th><th>PV</th><th>Total</th></tr></thead>
              <tbody>
                {selectedItems.map(i=>(
                  <tr key={i.id}>
                    <td className="mono">{i.code}</td>
                    <td className="desc-cell" title={i.description}>{i.description}</td>
                    <td><span className="brand-badge">{i.brand}</span></td>
                    <td className="num">{i.exportQty}</td>
                    <td className="num">{i.pv>0?fmtBRL(i.pv):'—'}</td>
                    <td className="num"><strong>{fmtBRL(i.exportQty*i.pv)}</strong></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={4}><strong>Total</strong></td><td/><td className="num"><strong>{fmtBRL(totalValue)}</strong></td></tr></tfoot>
            </table>
          </div>
        )}
        <div className="modal-actions">
          <button className={`btn ${copied?'btn-success':'btn-yellow'}`} onClick={doCopy}>{copied?'✅ Copiado!':'📋 Copiar'}</button>
          <button className="btn btn-secondary" onClick={dlCSV}>⬇️ CSV (ERP)</button>
          <button className="btn btn-secondary" onClick={dlTXT}>⬇️ TXT</button>
          {caps.seePrices&&selectedItems.length>0&&(
            <button className="btn btn-secondary" onClick={dlPDF}>⬇️ PDF</button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  )
}

import { useState, useMemo } from 'react'
import { fmtBRL, dlBlob, todayStr } from '../utils.js'
import { calcOrderSplit } from '../rules.js'
import { LOGO_KEY, LOJAS } from '../constants.js'

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
    const logo    = localStorage.getItem(LOGO_KEY)
    const logoHtml = logo
      ? `<img src="${logo}" style="max-height:55px;max-width:140px;object-fit:contain;" alt=""/>`
      : `<span style="font-size:16px;font-weight:900;color:#8B0000;letter-spacing:-1px">YES MOCELIN</span>`

    const loja = activeTab === 'BELTRAO' ? LOJAS.find(l=>l.id==='fb')
               : activeTab === 'TOLEDO'  ? LOJAS.find(l=>l.id==='tl')
               : null
    const companyCNPJ = loja?.cnpj ?? ''
    const companyNome = loja?.nome ?? 'Yes Mocelin'

    const counterKey = 'sc_order_counter'
    const counter    = (parseInt(localStorage.getItem(counterKey)) || 0) + 1
    localStorage.setItem(counterKey, counter)
    const orderNum   = String(new Date().getFullYear()).slice(2) + String(counter).padStart(5,'0')
    const todayFmt   = new Date().toLocaleDateString('pt-BR')

    const rows = selectedItems.map(i => `
      <tr>
        <td class="c" style="font-family:monospace">${i.code}</td>
        <td>${i.description}</td>
        <td class="c">UN</td>
        <td class="r">${i.exportQty}</td>
        <td class="r">${i.pv>0 ? fmtBRL(i.pv) : ''}</td>
        <td class="r">${i.pv>0 ? fmtBRL(i.exportQty*i.pv) : ''}</td>
        <td class="c"></td>
        <td class="c"></td>
        <td class="r">${i.pv>0 ? fmtBRL(i.pv) : ''}</td>
      </tr>`).join('')

    const doc = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="utf-8">
<title>Pedido de Compra N° ${orderNum}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:11px;color:#111;background:#fff;padding:18px 18px 72px}

/* ── Cabeçalho ── */
.ph{display:flex;align-items:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:10px;gap:10px}
.ph-logo{width:130px;flex-shrink:0}
.ph-co{flex:1;text-align:center;line-height:1.65}
.ph-co-name{font-size:14px;font-weight:bold;color:#8B0000;margin-bottom:2px}
.ph-dates{width:155px;flex-shrink:0;text-align:right;line-height:1.9;font-size:10.5px}
.ph-dates b{display:inline-block;min-width:100px;text-align:right;padding-right:4px}

/* ── Título ── */
.title{text-align:center;font-size:12px;font-weight:bold;border:1px solid #555;
       padding:5px;margin:8px 0;background:#efefef;letter-spacing:1px}

/* ── Blocos info ── */
.ib{display:flex;border:1px solid #aaa;margin-bottom:8px}
.ic{flex:1;padding:6px 8px}
.ic+.ic{border-left:1px solid #aaa}
.ic-t{font-weight:bold;font-size:10px;border-bottom:1px solid #ddd;padding-bottom:3px;margin-bottom:4px;letter-spacing:.4px}
.ir{display:flex;gap:3px;margin-bottom:2px;font-size:10.5px}
.il{font-weight:bold;white-space:nowrap;min-width:105px}

/* ── Tabela ── */
table{width:100%;border-collapse:collapse;margin-bottom:8px}
th{background:#2a2a2a;color:#fff;padding:5px 3px;text-align:center;font-size:9.5px;border:1px solid #444;line-height:1.2}
td{border:1px solid #ccc;padding:3px 4px;font-size:10px;vertical-align:middle}
td.c{text-align:center}
td.r{text-align:right}
tr:nth-child(even) td{background:#f9f9f9}

/* ── Rodapé ── */
.ft{display:flex;gap:10px;margin-top:4px}
.obs{flex:1;border:1px solid #aaa;padding:6px 8px;min-height:72px}
.obs-t{font-weight:bold;font-size:10px;color:#555;display:block;margin-bottom:4px}
.tv{width:226px;border:1px solid #aaa}
.tr{display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid #eee;font-size:10.5px}
.tr:last-child{border:none;font-weight:bold;background:#efefef;font-size:11.5px}

/* ── Barra de impressão (sumida no print) ── */
.pb{position:fixed;bottom:0;left:0;right:0;background:#1e1b4b;padding:10px 22px;display:flex;gap:10px;align-items:center;z-index:9}
.bp{background:#4f46e5;color:#fff;border:none;padding:9px 22px;font-size:13px;font-weight:600;border-radius:6px;cursor:pointer}
.bp:hover{background:#4338ca}
.bc{background:transparent;color:#bbb;border:1px solid #555;padding:9px 14px;font-size:12px;border-radius:6px;cursor:pointer}

@page{margin:12mm;size:A4 portrait}
@media print{.pb{display:none!important}body{padding:0}}
</style>
</head><body>

<div class="ph">
  <div class="ph-logo">${logoHtml}</div>
  <div class="ph-co">
    <div class="ph-co-name">YES MOCELIN</div>
    <div>${companyNome}</div>
    <div>CNPJ: ${companyCNPJ}&nbsp;&nbsp;I.E.: &nbsp;</div>
    <div>E-mail: &nbsp;</div>
  </div>
  <div class="ph-dates">
    <div><b>Data do Pedido:</b> ${todayFmt}</div>
    <div><b>Prev. Entrega:</b> &nbsp;</div>
    <div><b>Página:</b> 1 / 1</div>
  </div>
</div>

<div class="title">PEDIDO DE COMPRA N° ${orderNum}</div>

<div class="ib">
  <div class="ic">
    <div class="ic-t">FORNECEDOR</div>
    <div class="ir"><span class="il">Código:</span><span></span></div>
    <div class="ir"><span class="il">Nome:</span><span>${tabLabel}</span></div>
    <div class="ir"><span class="il">Endereço:</span><span></span></div>
    <div class="ir"><span class="il">CNPJ:</span><span></span></div>
    <div class="ir"><span class="il">E-mail:</span><span></span></div>
  </div>
  <div class="ic">
    <div class="ic-t">TRANSPORTE</div>
    <div class="ir"><span class="il">Transportadora:</span><span></span></div>
    <div class="ir"><span class="il">Frete:</span><span></span></div>
    <div class="ir"><span class="il">Cond. Pagamento:</span><span></span></div>
  </div>
</div>

<table>
  <thead><tr>
    <th style="width:72px">COD</th>
    <th>DESCRIÇÃO</th>
    <th style="width:36px">UND</th>
    <th style="width:42px">QTDE</th>
    <th style="width:72px">UNITÁRIO</th>
    <th style="width:80px">TOTAL</th>
    <th style="width:46px">% ICMS</th>
    <th style="width:36px">% IPI</th>
    <th style="width:90px">VALOR UNIT.<br>C/ IMPOSTOS</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>

<div class="ft">
  <div class="obs"><span class="obs-t">OBSERVAÇÕES:</span></div>
  <div class="tv">
    <div class="tr"><span>Valor Desconto:</span><span>${fmtBRL(0)}</span></div>
    <div class="tr"><span>Valor Acréscimo:</span><span>${fmtBRL(0)}</span></div>
    <div class="tr"><span>Valor Mercadoria:</span><span>${fmtBRL(totalValue)}</span></div>
    <div class="tr"><span>VALOR TOTAL PEDIDO:</span><span>${fmtBRL(totalValue)}</span></div>
  </div>
</div>

<div class="pb">
  <button class="bp" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
  <button class="bc" onclick="window.close()">Fechar</button>
  <span style="color:#888;font-size:11px;margin-left:6px">ou Ctrl+P</span>
</div>

</body></html>`

    // Download direto — sem window.open, sem popup blocker
    const blob = new Blob([doc], {type:'text/html;charset=utf-8'})
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `pedido_${orderNum}_${tabLabel.replace(/\s+/g,'_')}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 5000)
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

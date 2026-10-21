import { useMemo, useState } from 'react'
import { fmtBRL, fmtDate } from '../utils.js'
import { LOJAS } from '../constants.js'

// Lojas que podem receber a ordem de compra (Dois Vizinhos é abastecida pela aba Beltrão + DV)
const LOJAS_OC = [
  ...LOJAS.filter(l => l.id === 'fb'),
  { id:'dv', nome:'Dois Vizinhos', cnpj:'35.369.505/0002-93', cnpjRaw:'35369505000293' },
  ...LOJAS.filter(l => l.id === 'tl'),
]
const lojaPadrao = activeTab => activeTab === 'TOLEDO' ? 'tl' : 'fb'

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]))
const pad = n => String(n).padStart(2, '0')
const numeroOC = d => `OC-${String(d.getFullYear()).slice(2)}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`

// Documento isolado da tela: a impressão antes saía pelo window.print() da página inteira
// (o CSS de impressão escondia o modal e imprimia a tabela de sugestão toda — ~70 páginas).
function montarHtml({ itens, loja, numero, data, fornecedor, obs, logoUrl, comPreco, total }) {
  const linhas = itens.map((i, n) => `
    <tr>
      <td class="c">${n+1}</td>
      <td class="mono">${esc(i.code)}</td>
      <td>${esc(i.description)}</td>
      <td class="c">UN</td>
      <td class="r">${i.exportQty}</td>
      ${comPreco ? `<td class="r">${esc(fmtBRL(i.exportPv))}</td><td class="r">${esc(fmtBRL(i.exportQty * i.exportPv))}</td>` : ''}
    </tr>`).join('')
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>${esc(numero)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10.5px; margin: 0; }
  .top { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 10px; }
  .top img { max-height: 46px; max-width: 150px; object-fit: contain; }
  h1 { font-size: 17px; margin: 0; letter-spacing: .04em; }
  .num { text-align: right; font-size: 11px; }
  .num b { font-size: 13px; }
  .box { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
  .box div { border: 1px solid #bbb; border-radius: 4px; padding: 6px 8px; }
  .lbl { font-size: 8.5px; text-transform: uppercase; color: #555; letter-spacing: .05em; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th { background: #eee; text-align: left; font-size: 9px; text-transform: uppercase; }
  th, td { border: 1px solid #bbb; padding: 4px 6px; vertical-align: top; }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
  .mono { font-family: Consolas, monospace; white-space: nowrap; }
  tfoot td { font-weight: bold; background: #f6f6f6; }
  .obs { margin-top: 10px; border: 1px solid #bbb; border-radius: 4px; padding: 6px 8px; min-height: 34px; white-space: pre-wrap; }
  .ass { display: flex; justify-content: space-between; gap: 40px; margin-top: 36px; page-break-inside: avoid; }
  .ass div { flex: 1; border-top: 1px solid #111; padding-top: 4px; text-align: center; font-size: 9.5px; }
</style></head><body>
  <div class="top">
    ${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : '<span></span>'}
    <h1>ORDEM DE COMPRA</h1>
    <div class="num"><b>${esc(numero)}</b><br>${esc(fmtDate(data))}</div>
  </div>
  <div class="box">
    <div><div class="lbl">Loja (faturamento e entrega)</div><b>Yes Mocelin — ${esc(loja.nome)}</b><br>CNPJ ${esc(loja.cnpj)}</div>
    <div><div class="lbl">Fornecedor</div><b>${esc(fornecedor || '—')}</b><br>${itens.length} itens · ${itens.reduce((s,i)=>s+i.exportQty,0)} unidades</div>
  </div>
  <table>
    <thead><tr><th class="c">#</th><th>Código</th><th>Descrição</th><th class="c">UN</th><th class="r">Qtde</th>${comPreco ? '<th class="r">Valor un.</th><th class="r">Total</th>' : ''}</tr></thead>
    <tbody>${linhas}</tbody>
    ${comPreco ? `<tfoot><tr><td colspan="6" class="r">Total da ordem</td><td class="r">${esc(fmtBRL(total))}</td></tr></tfoot>` : ''}
  </table>
  ${obs ? `<div class="obs"><div class="lbl">Observações</div>${esc(obs)}</div>` : ''}
  <div class="ass"><div>Comprador — Gabriel Ribeiro</div><div>Aprovação</div></div>
</body></html>`
}

function imprimir(html) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  Object.assign(frame.style, { position:'fixed', right:'0', bottom:'0', width:'0', height:'0', border:'0' })
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  doc.open(); doc.write(html); doc.close()
  const go = () => {
    frame.contentWindow.focus()
    frame.contentWindow.print()
    setTimeout(() => frame.remove(), 1000)
  }
  // Espera o logo carregar para não sair a ordem sem ele
  const imgs = [...doc.images].filter(img => !img.complete)
  if (!imgs.length) return setTimeout(go, 50)
  let restantes = imgs.length
  const pronto = () => { if (--restantes === 0) go() }
  imgs.forEach(img => { img.onload = pronto; img.onerror = pronto })
  setTimeout(() => { if (restantes > 0) { restantes = 0; go() } }, 3000)
}

export default function PurchaseOrderModal({ items, selections, tabLabel, activeTab, logo, showPrices, onClose }) {
  const [lojaId, setLojaId] = useState(() => lojaPadrao(activeTab))
  const [obs, setObs]       = useState('')
  const loja = LOJAS_OC.find(l => l.id === lojaId) || LOJAS_OC[0]

  const selectedItems = useMemo(()=>
    items.filter(i=>selections[i.id]?.selected)
      .map(i=>({...i, exportQty:selections[i.id]?.qty??i.adjustedQty, exportPv:selections[i.id]?.pv??i.pv??0}))
      .filter(i=>i.exportQty>0)
  ,[items,selections])

  const fornecedor = useMemo(() => [...new Set(selectedItems.map(i => i.brand).filter(Boolean))].join(', '), [selectedItems])
  const total = useMemo(() => selectedItems.reduce((s,i)=>s+i.exportQty*i.exportPv, 0), [selectedItems])

  const handlePrint = () => {
    const data = new Date()
    const logoUrl = logo ? new URL(logo, window.location.href).href : ''
    imprimir(montarHtml({ itens:selectedItems, loja, numero:numeroOC(data), data, fornecedor, obs, logoUrl, comPreco:showPrices, total }))
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-print">
        <div className="modal-header">
          <h2 className="modal-title">Ordem de Compra</h2>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-yellow" onClick={handlePrint} disabled={!selectedItems.length}>🖨️ Imprimir / PDF</button>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="print-doc">
          <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:12}}>
            <div className="form-field" style={{minWidth:220}}>
              <label>Loja do pedido</label>
              <select className="filter-select" style={{width:'100%'}} value={lojaId} onChange={e=>setLojaId(e.target.value)}>
                {LOJAS_OC.map(l=><option key={l.id} value={l.id}>{l.nome} — {l.cnpj}</option>)}
              </select>
            </div>
            <div className="form-field" style={{flex:1,minWidth:220}}>
              <label>Observações (opcional)</label>
              <input className="login-input" value={obs} onChange={e=>setObs(e.target.value)} placeholder="Condição de pagamento, prazo, frete..."/>
            </div>
          </div>
          <div className="print-header">
            {logo&&<img src={logo} alt="Logo" className="print-logo"/>}
            <div>
              <h1 className="print-title">ORDEM DE COMPRA · {loja.nome}</h1>
              <p className="print-meta">{tabLabel} · {fmtDate(new Date())} · {selectedItems.length} itens{showPrices&&` · ${fmtBRL(total)}`}</p>
            </div>
          </div>
          <table className="print-table">
            <thead><tr><th>Código</th><th>Descrição</th><th>UN</th><th>QTDE</th>{showPrices&&<><th>Valor un.</th><th>Total</th></>}</tr></thead>
            <tbody>
              {selectedItems.map(i=>(
                <tr key={i.id}>
                  <td>{i.code}</td><td>{i.description}</td><td>UN</td><td>{i.exportQty}</td>
                  {showPrices&&<><td>{fmtBRL(i.exportPv)}</td><td>{fmtBRL(i.exportQty*i.exportPv)}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="print-footer">
            <p>Somente os {selectedItems.length} itens selecionados entram na ordem — a impressão acompanha essa quantidade.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

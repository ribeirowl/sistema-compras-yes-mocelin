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

// Valor com centavos (fmtBRL da tela arredonda para reais)
const brl2 = v => (v??0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:2})
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
      ${comPreco ? `<td class="r">${esc(brl2(i.exportPv))}</td><td class="r">${esc(brl2(i.exportQty * i.exportPv))}</td>` : ''}
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
    ${comPreco ? `<tfoot><tr><td colspan="6" class="r">Total da ordem</td><td class="r">${esc(brl2(total))}</td></tr></tfoot>` : ''}
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

// Logo → dataURL para embutir no PDF (sem logo se falhar: a ordem sai do mesmo jeito)
async function carregarLogo(url) {
  if (!url) return null
  try {
    const blob = await (await fetch(url)).blob()
    const dataUrl = await new Promise((ok, err) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = err; r.readAsDataURL(blob) })
    const img = await new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = dataUrl })
    return { dataUrl, w: img.naturalWidth, h: img.naturalHeight }
  } catch { return null }
}

// Gera o PDF da ordem (A4) e baixa direto. jsPDF é carregado só no clique.
async function baixarPdf({ itens, loja, numero, data, fornecedor, obs, logoUrl, comPreco, total }) {
  const [{ jsPDF }, at] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  // O formato do export muda entre o build ESM e o CJS do plugin; applyPlugin funciona nos dois
  ;(at.applyPlugin || at.default?.applyPlugin)?.(jsPDF)
  const autoTable = (d, opts) => d.autoTable(opts)
  const doc = new jsPDF({ unit:'mm', format:'a4' })
  const W = doc.internal.pageSize.getWidth(), M = 12
  let y = M

  const logo = await carregarLogo(logoUrl)
  if (logo?.w && logo?.h) {
    const ratio = logo.w / logo.h
    let h = 13, w = h * ratio
    if (w > 42) { w = 42; h = w / ratio }
    doc.addImage(logo.dataUrl, logo.dataUrl.includes('image/png') ? 'PNG' : 'JPEG', M, y, w, h)
  }
  doc.setFont('helvetica', 'bold').setFontSize(15).text('ORDEM DE COMPRA', W / 2, y + 8, { align:'center' })
  doc.setFontSize(11).text(numero, W - M, y + 5, { align:'right' })
  doc.setFont('helvetica', 'normal').setFontSize(9).text(fmtDate(data), W - M, y + 10, { align:'right' })
  y += 16
  doc.setLineWidth(0.6).line(M, y, W - M, y)
  y += 4

  const boxW = (W - 2 * M - 4) / 2
  const caixa = (x, titulo, l1, l2) => {
    doc.setLineWidth(0.2).setDrawColor(170).roundedRect(x, y, boxW, 16, 1.5, 1.5)
    doc.setFontSize(7).setTextColor(90).text(titulo.toUpperCase(), x + 3, y + 4.5)
    doc.setFontSize(10).setTextColor(17).setFont('helvetica', 'bold').text(l1, x + 3, y + 9.5, { maxWidth: boxW - 6 })
    doc.setFont('helvetica', 'normal').setFontSize(9).text(l2, x + 3, y + 14)
  }
  caixa(M, 'Loja (faturamento e entrega)', `Yes Mocelin — ${loja.nome}`, `CNPJ ${loja.cnpj}`)
  caixa(M + boxW + 4, 'Fornecedor', fornecedor || '—', `${itens.length} itens · ${itens.reduce((s,i)=>s+i.exportQty,0)} unidades`)
  y += 20

  const head = [['#', 'Código', 'Descrição', 'UN', 'Qtde', ...(comPreco ? ['Valor un.', 'Total'] : [])]]
  const body = itens.map((i, n) => [n + 1, i.code, i.description || '', 'UN', i.exportQty,
    ...(comPreco ? [brl2(i.exportPv), brl2(i.exportQty * i.exportPv)] : [])])
  autoTable(doc, {
    startY: y, head, body, margin: { left: M, right: M },
    foot: comPreco ? [[{ content:'Total da ordem', colSpan:6, styles:{ halign:'right' } }, brl2(total)]] : undefined,
    showFoot: 'lastPage',
    styles: { fontSize: 8, cellPadding: 1.6, lineColor: 190, lineWidth: 0.15, textColor: 17, valign:'top' },
    headStyles: { fillColor: [235,235,235], textColor: 17, fontStyle:'bold' },
    footStyles: { fillColor: [246,246,246], textColor: 17, fontStyle:'bold' },
    columnStyles: { 0:{ halign:'center', cellWidth:8 }, 1:{ cellWidth:20 }, 3:{ halign:'center', cellWidth:10 }, 4:{ halign:'right', cellWidth:14 },
      ...(comPreco ? { 5:{ halign:'right', cellWidth:24 }, 6:{ halign:'right', cellWidth:26 } } : {}) },
    // Cabeçalho segue o alinhamento da coluna (o columnStyles só vale para o corpo)
    didParseCell: d => { if (d.section === 'head') d.cell.styles.halign = { 0:'center', 3:'center', 4:'right', 5:'right', 6:'right' }[d.column.index] || 'left' },
  })
  y = doc.lastAutoTable.finalY + 6

  const H = doc.internal.pageSize.getHeight()
  if (obs) {
    const linhas = doc.setFontSize(9).splitTextToSize(obs, W - 2 * M - 6)
    const h = 8 + linhas.length * 4
    if (y + h > H - 30) { doc.addPage(); y = M }
    doc.setDrawColor(170).roundedRect(M, y, W - 2 * M, h, 1.5, 1.5)
    doc.setFontSize(7).setTextColor(90).text('OBSERVAÇÕES', M + 3, y + 4.5)
    doc.setFontSize(9).setTextColor(17).text(linhas, M + 3, y + 9)
    y += h + 4
  }
  if (y + 24 > H - M) { doc.addPage(); y = M }
  y += 18
  const aw = (W - 2 * M - 20) / 2
  doc.setDrawColor(17).setLineWidth(0.3).line(M, y, M + aw, y).line(W - M - aw, y, W - M, y)
  doc.setFontSize(8.5).text('Comprador — Gabriel Ribeiro', M + aw / 2, y + 4, { align:'center' }).text('Aprovação', W - M - aw / 2, y + 4, { align:'center' })

  const nomeLoja = loja.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_')
  doc.save(`${numero}_${nomeLoja}.pdf`)
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

  // Mesmo número/data na impressão e no PDF desta ordem
  const [data] = useState(() => new Date())
  const [baixando, setBaixando] = useState(false)
  const dadosOC = () => ({
    itens:selectedItems, loja, numero:numeroOC(data), data, fornecedor, obs,
    logoUrl: logo ? new URL(logo, window.location.href).href : '', comPreco:showPrices, total,
  })
  const handlePrint = () => imprimir(montarHtml(dadosOC()))
  const handleDownload = async () => {
    setBaixando(true)
    try { await baixarPdf(dadosOC()) }
    catch (e) { console.error('Erro ao gerar PDF:', e); alert('Não foi possível gerar o PDF: ' + e.message) }
    finally { setBaixando(false) }
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal modal-print">
        <div className="modal-header">
          <h2 className="modal-title">Ordem de Compra</h2>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-yellow" onClick={handleDownload} disabled={!selectedItems.length||baixando}>
              {baixando ? 'Gerando PDF…' : '⬇️ Baixar PDF'}
            </button>
            <button className="btn btn-secondary" onClick={handlePrint} disabled={!selectedItems.length}>🖨️ Imprimir</button>
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
                  {showPrices&&<><td>{brl2(i.exportPv)}</td><td>{brl2(i.exportQty*i.exportPv)}</td></>}
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

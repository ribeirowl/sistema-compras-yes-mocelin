// PDF do "Pedido de Compra" (botão PDF da tela Exportar Pedido).
// Antes baixava uma página .html para imprimir; agora gera o PDF de verdade,
// no mesmo layout. Em Outros Fornecedores sai um PDF por marca/fornecedor (e loja),
// já com o nome do fornecedor preenchido.
import { LOJAS } from '../constants.js'

const brl = v => (v ?? 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL', minimumFractionDigits:2, maximumFractionDigits:2 })
const LOJA_DE = { BELTRAO:'fb', TOLEDO:'tl' }
const limparNome = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')

function proximoNumero() {
  const k = 'sc_order_counter'
  let n = 1
  try { n = (parseInt(localStorage.getItem(k)) || 0) + 1; localStorage.setItem(k, n) } catch {}
  return String(new Date().getFullYear()).slice(2) + String(n).padStart(5, '0')
}

async function carregarLogo(url) {
  if (!url) return null
  try {
    const blob = await (await fetch(url)).blob()
    const dataUrl = await new Promise((ok, err) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = err; r.readAsDataURL(blob) })
    const img = await new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = dataUrl })
    return { dataUrl, w: img.naturalWidth, h: img.naturalHeight }
  } catch { return null }
}

// itens: [{code, description, exportQty, pv, brand, cityGroup}]
// separarPorFornecedor: true em Outros Fornecedores (um PDF por marca + loja)
export async function gerarPedidoPdf(itens, { fornecedorPadrao = '', cityGroup = null, separarPorFornecedor = false, logoUrl = '' } = {}) {
  const [{ jsPDF }, at] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  ;(at.applyPlugin || at.default?.applyPlugin)?.(jsPDF)
  const logo = await carregarLogo(logoUrl)

  // Agrupa: por fornecedor (marca) e loja quando pedido; senão um pedido só
  const grupos = new Map()
  for (const i of itens) {
    const forn = separarPorFornecedor ? (i.brand || 'FORNECEDOR NÃO INFORMADO') : fornecedorPadrao
    const loja = cityGroup || i.cityGroup || ''
    const k = `${forn}__${loja}`
    if (!grupos.has(k)) grupos.set(k, { forn, loja, itens: [] })
    grupos.get(k).itens.push(i)
  }

  const arquivos = []
  for (const g of grupos.values()) {
    const doc = new jsPDF({ unit:'mm', format:'a4' })
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 12
    const loja = LOJAS.find(l => l.id === LOJA_DE[g.loja])
    const numero = proximoNumero()
    const hoje = new Date().toLocaleDateString('pt-BR')
    const total = g.itens.reduce((s, i) => s + i.exportQty * (i.pv || 0), 0)

    // Cabeçalho: logo | empresa | datas
    let y = M
    if (logo?.w && logo?.h) {
      const r = logo.w / logo.h; let h = 14, w = h * r
      if (w > 38) { w = 38; h = w / r }
      doc.addImage(logo.dataUrl, logo.dataUrl.includes('image/png') ? 'PNG' : 'JPEG', M, y, w, h)
    } else {
      doc.setFont('helvetica','bold').setFontSize(13).setTextColor(139,0,0).text('YES MOCELIN', M, y + 8)
    }
    doc.setTextColor(17)
    doc.setFont('helvetica','bold').setFontSize(12).setTextColor(139,0,0).text('YES MOCELIN', W/2, y + 4, { align:'center' })
    doc.setTextColor(17).setFont('helvetica','normal').setFontSize(9)
      .text(loja?.nome || 'Yes Mocelin', W/2, y + 9, { align:'center' })
      .text(loja?.cnpj ? `CNPJ: ${loja.cnpj}` : '', W/2, y + 13.5, { align:'center' })
    doc.setFontSize(8.5)
    doc.setFont('helvetica','bold').text('Data do Pedido:', W - M - 22, y + 4, { align:'right' })
    doc.setFont('helvetica','normal').text(hoje, W - M, y + 4, { align:'right' })
    doc.setFont('helvetica','bold').text('Prev. Entrega:', W - M - 22, y + 9, { align:'right' })
    y += 18
    doc.setLineWidth(0.6).setDrawColor(51).line(M, y, W - M, y); y += 4

    // Título
    doc.setFillColor(239,239,239).setDrawColor(85).setLineWidth(0.3).rect(M, y, W - 2*M, 8, 'FD')
    doc.setFont('helvetica','bold').setFontSize(11).text(`PEDIDO DE COMPRA N° ${numero}`, W/2, y + 5.5, { align:'center' })
    y += 11

    // Quadros Fornecedor | Transporte
    const bw = (W - 2*M) / 2, bh = 26
    doc.setDrawColor(170).rect(M, y, bw, bh).rect(M + bw, y, bw, bh)
    const quadro = (x, titulo, linhas) => {
      doc.setFont('helvetica','bold').setFontSize(8.5).text(titulo, x + 3, y + 4.5)
      doc.setDrawColor(221).line(x + 3, y + 6, x + bw - 3, y + 6)
      linhas.forEach(([rot, val], n) => {
        doc.setFont('helvetica','bold').setFontSize(8.5).text(rot, x + 3, y + 10.5 + n * 4)
        doc.setFont('helvetica','normal').text(String(val || ''), x + 30, y + 10.5 + n * 4, { maxWidth: bw - 33 })
      })
    }
    quadro(M, 'FORNECEDOR', [['Nome:', g.forn], ['Código:', ''], ['CNPJ:', ''], ['E-mail:', '']])
    quadro(M + bw, 'TRANSPORTE', [['Transportadora:', ''], ['Frete:', ''], ['Cond. Pagamento:', '']])
    y += bh + 4

    // Itens
    doc.autoTable({
      startY: y, margin:{ left:M, right:M },
      head: [['COD', 'DESCRIÇÃO', 'UND', 'QTDE', 'UNITÁRIO', 'TOTAL', '% ICMS', '% IPI', 'VALOR UNIT.\nC/ IMPOSTOS']],
      body: g.itens.map(i => [i.code, i.description || '', 'UN', i.exportQty,
        i.pv > 0 ? brl(i.pv) : '', i.pv > 0 ? brl(i.exportQty * i.pv) : '', '', '', i.pv > 0 ? brl(i.pv) : '']),
      styles:{ fontSize:7.8, cellPadding:1.5, lineColor:204, lineWidth:0.15, textColor:17, valign:'middle' },
      headStyles:{ fillColor:[42,42,42], textColor:255, fontStyle:'bold', halign:'center', fontSize:7.5 },
      alternateRowStyles:{ fillColor:[249,249,249] },
      columnStyles:{ 0:{ halign:'center', cellWidth:18 }, 2:{ halign:'center', cellWidth:10 }, 3:{ halign:'right', cellWidth:12 },
        4:{ halign:'right', cellWidth:20 }, 5:{ halign:'right', cellWidth:22 }, 6:{ halign:'center', cellWidth:13 }, 7:{ halign:'center', cellWidth:11 }, 8:{ halign:'right', cellWidth:22 } },
    })
    y = doc.lastAutoTable.finalY + 4

    // Observações | Totais
    if (y + 30 > H - M) { doc.addPage(); y = M }
    const tw = 62, ow = W - 2*M - tw - 4
    doc.setDrawColor(170).rect(M, y, ow, 26)
    doc.setFont('helvetica','bold').setFontSize(8.5).setTextColor(85).text('OBSERVAÇÕES:', M + 3, y + 4.5)
    doc.setTextColor(17)
    const tx = M + ow + 4
    const linhasTot = [['Valor Desconto:', brl(0)], ['Valor Acréscimo:', brl(0)], ['Valor Mercadoria:', brl(total)], ['VALOR TOTAL PEDIDO:', brl(total)]]
    linhasTot.forEach(([r, v], n) => {
      const yy = y + n * 6.5
      const ultimo = n === linhasTot.length - 1
      if (ultimo) doc.setFillColor(239,239,239).rect(tx, yy, tw, 6.5, 'F')
      doc.setDrawColor(170).rect(tx, yy, tw, 6.5)
      doc.setFont('helvetica', ultimo ? 'bold' : 'normal').setFontSize(ultimo ? 8.8 : 8.3)
        .text(r, tx + 2, yy + 4.4).text(v, tx + tw - 2, yy + 4.4, { align:'right' })
    })

    // Página x de y
    const n = doc.internal.getNumberOfPages()
    for (let p = 1; p <= n; p++) { doc.setPage(p); doc.setFont('helvetica','normal').setFontSize(7.5).setTextColor(110).text(`Página ${p} / ${n}`, W - M, H - 6, { align:'right' }) }

    const nome = `pedido_${numero}_${limparNome(g.forn) || 'Yes_Mocelin'}${g.loja ? '_' + limparNome(loja?.nome || g.loja) : ''}.pdf`
    arquivos.push({ doc, nome })
  }

  for (const [i, a] of arquivos.entries()) {
    if (i) await new Promise(r => setTimeout(r, 700))
    a.doc.save(a.nome)
  }
  return arquivos.map(a => a.nome)
}

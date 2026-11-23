// PDFs de transferência: UM por filial de origem (o que ela separa e envia),
// com uma seção por destino. Gera todos de uma vez — o Gabriel não monta loja por loja.
import { nomeFilial } from './transferencias.js'
import { fmtDate } from '../utils.js'

const brl2 = v => (v ?? 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL', minimumFractionDigits:2, maximumFractionDigits:2 })
const pad = n => String(n).padStart(2, '0')
const SIGLA = { BELTRAO:'FB', DOIS_VIZINHOS:'DV', TOLEDO:'TL' }
const semAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_')

async function carregarLogo(url) {
  if (!url) return null
  try {
    const blob = await (await fetch(url)).blob()
    const dataUrl = await new Promise((ok, err) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = err; r.readAsDataURL(blob) })
    const img = await new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = dataUrl })
    return { dataUrl, w: img.naturalWidth, h: img.naturalHeight }
  } catch { return null }
}

export function numeroTransferencia(origem, data = new Date()) {
  return `TR-${String(data.getFullYear()).slice(2)}${pad(data.getMonth()+1)}${pad(data.getDate())}-${pad(data.getHours())}${pad(data.getMinutes())}-${SIGLA[origem] || origem}`
}

// linhas: [{code, description, from, to, qtd, pv}] já selecionadas e com a qtd final
export async function gerarPdfsTransferencia(linhas, { logoUrl, comValor = true, autor = 'Gabriel Ribeiro', obs = '' } = {}) {
  const [{ jsPDF }, at] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  ;(at.applyPlugin || at.default?.applyPlugin)?.(jsPDF)
  const logo = await carregarLogo(logoUrl)
  const data = new Date()
  const porOrigem = new Map()
  for (const l of linhas) {
    if (!porOrigem.has(l.from)) porOrigem.set(l.from, [])
    porOrigem.get(l.from).push(l)
  }

  const arquivos = []
  for (const [origem, itens] of porOrigem) {
    const doc = new jsPDF({ unit:'mm', format:'a4' })
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 12
    const numero = numeroTransferencia(origem, data)
    let y = M
    if (logo?.w && logo?.h) {
      const r = logo.w / logo.h; let h = 12, w = h * r
      if (w > 40) { w = 40; h = w / r }
      doc.addImage(logo.dataUrl, logo.dataUrl.includes('image/png') ? 'PNG' : 'JPEG', M, y, w, h)
    }
    doc.setFont('helvetica','bold').setFontSize(14).text('TRANSFERÊNCIA ENTRE LOJAS', W/2, y+5, { align:'center' })
    doc.setFont('helvetica','normal').setFontSize(10).text(`Separar e enviar — ${nomeFilial(origem)}`, W/2, y+11, { align:'center' })
    doc.setFont('helvetica','bold').setFontSize(10.5).text(numero, W-M, y+4, { align:'right' })
    doc.setFont('helvetica','normal').setFontSize(9).text(fmtDate(data), W-M, y+9, { align:'right' })
    y += 16
    doc.setLineWidth(0.6).line(M, y, W-M, y); y += 5

    const destinos = [...new Set(itens.map(i => i.to))]
    const totUn = itens.reduce((s, i) => s + i.qtd, 0), totVal = itens.reduce((s, i) => s + i.qtd * (i.pv || 0), 0)
    doc.setFontSize(9).setTextColor(70)
      .text(`${itens.length} ${itens.length === 1 ? 'item' : 'itens'} · ${totUn} unidades · ${destinos.length} ${destinos.length === 1 ? 'destino' : 'destinos'}${comValor ? ` · ${brl2(totVal)}` : ''}`, M, y)
    doc.setTextColor(17); y += 4

    for (const destino of destinos) {
      const sec = itens.filter(i => i.to === destino).sort((a, b) => String(a.description).localeCompare(String(b.description), 'pt-BR'))
      if (y > H - 50) { doc.addPage(); y = M }
      doc.setFillColor(242, 190, 0).rect(M, y, W - 2*M, 7, 'F')
      doc.setFont('helvetica','bold').setFontSize(10).setTextColor(17)
        .text(`Destino: ${nomeFilial(destino)}`, M + 2, y + 4.8)
      const su = sec.reduce((s, i) => s + i.qtd, 0)
      doc.setFont('helvetica','normal').setFontSize(9).text(`${sec.length} ${sec.length === 1 ? 'item' : 'itens'} · ${su} un.`, W - M - 2, y + 4.8, { align:'right' })
      y += 8
      const head = [['#', 'Código', 'Descrição', 'Qtd', ...(comValor ? ['Valor un.', 'Total'] : []), 'Conferido']]
      const body = sec.map((i, n) => [n+1, i.code, i.description || '', i.qtd, ...(comValor ? [brl2(i.pv), brl2(i.qtd * (i.pv || 0))] : []), ''])
      doc.autoTable({
        startY: y, head, body, margin:{ left:M, right:M },
        styles:{ fontSize:8, cellPadding:1.6, lineColor:190, lineWidth:0.15, textColor:17, valign:'middle' },
        headStyles:{ fillColor:[235,235,235], textColor:17, fontStyle:'bold' },
        columnStyles: comValor
          ? { 0:{ halign:'center', cellWidth:8 }, 1:{ cellWidth:19 }, 3:{ halign:'right', cellWidth:12 }, 4:{ halign:'right', cellWidth:22 }, 5:{ halign:'right', cellWidth:24 }, 6:{ cellWidth:18 } }
          : { 0:{ halign:'center', cellWidth:8 }, 1:{ cellWidth:19 }, 3:{ halign:'right', cellWidth:14 }, 4:{ cellWidth:20 } },
        didParseCell: d => { if (d.section === 'head') d.cell.styles.halign = ({ 0:'center', 3:'right', ...(comValor ? { 4:'right', 5:'right' } : {}) })[d.column.index] || 'left' },
        didDrawCell: d => {
          // quadradinho para marcar na conferência
          const col = comValor ? 6 : 4
          if (d.section === 'body' && d.column.index === col) d.doc.rect(d.cell.x + d.cell.width/2 - 2, d.cell.y + d.cell.height/2 - 2, 4, 4)
        },
      })
      y = doc.lastAutoTable.finalY + 6
    }

    if (obs) {
      const ls = doc.setFontSize(9).splitTextToSize(`Obs.: ${obs}`, W - 2*M)
      if (y + ls.length*4 > H - 40) { doc.addPage(); y = M }
      doc.text(ls, M, y); y += ls.length * 4 + 4
    }
    if (y > H - 32) { doc.addPage(); y = M }
    y += 16
    const aw = (W - 2*M - 16) / 3
    doc.setDrawColor(17).setLineWidth(0.3)
    ;[['Separado por', 0], ['Conferido por', 1], ['Recebido por (destino)', 2]].forEach(([t, k]) => {
      const x = M + k * (aw + 8)
      doc.line(x, y, x + aw, y)
      doc.setFontSize(8.5).text(t, x + aw/2, y + 4, { align:'center' })
    })
    doc.setFontSize(7.5).setTextColor(110).text(`Emitido por ${autor} · ${numero}`, M, H - 6)
    doc.setTextColor(17)

    const nome = `${numero}_${semAcento(nomeFilial(origem))}.pdf`
    arquivos.push({ origem, numero, nome, doc })
  }

  // Baixa um por loja (pequeno intervalo para o navegador aceitar vários downloads)
  for (const [i, a] of arquivos.entries()) {
    if (i) await new Promise(r => setTimeout(r, 700))
    a.doc.save(a.nome)
  }
  return arquivos.map(({ origem, numero, nome }) => ({ origem, numero, nome }))
}

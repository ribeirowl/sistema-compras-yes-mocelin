// Mostra a resposta da IA formatada (títulos, negrito, listas e tabelas em
// Markdown simples) sem usar innerHTML: tudo vira elemento React, então nada
// do texto é executado como código.

// **negrito** dentro de uma linha
function inline(txt, k = 0) {
  const partes = String(txt).split(/(\*\*[^*]+\*\*)/g)
  return partes.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') && p.length > 4
      ? <strong key={`${k}-${i}`}>{p.slice(2, -2)}</strong>
      : p.replace(/^\*\*|\*\*$/g, ''))
}

const ehLinhaTabela = l => /^\s*\|.*\|\s*$/.test(l)
const ehSeparador = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)
const celulas = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
const numerica = c => /^[\s*]*(R\$\s*)?-?[\d.,]+%?(\s*\(.*\))?[\s*]*$/.test(c)

export default function TextoIA({ texto }) {
  const linhas = String(texto || '').replace(/\r/g, '').split('\n')
  const blocos = []
  let i = 0
  while (i < linhas.length) {
    const l = linhas[i]
    if (!l.trim()) { i++; continue }

    // Tabela: cabeçalho | separador | linhas
    if (ehLinhaTabela(l) && i + 1 < linhas.length && ehSeparador(linhas[i + 1])) {
      const head = celulas(l)
      const rows = []
      i += 2
      while (i < linhas.length && ehLinhaTabela(linhas[i])) { rows.push(celulas(linhas[i])); i++ }
      // Coluna de números: título e valores alinhados à direita
      const colNum = head.map((_, j) => rows.length > 0 && rows.every(r => !r[j] || numerica(r[j])))
      blocos.push(
        <div key={blocos.length} className="tia-tabela-wrap">
          <table className="tia-tabela">
            <thead><tr>{head.map((h, j) => <th key={j} className={colNum[j] ? 'n' : ''}>{inline(h, j)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => (
              <tr key={ri}>{head.map((_, j) => <td key={j} className={colNum[j] ? 'n' : ''}>{inline(r[j] || '', j)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>)
      continue
    }

    // Títulos (#, ##, ###) viram um subtítulo discreto
    const h = l.match(/^\s*#{1,4}\s+(.*)$/)
    if (h) { blocos.push(<div key={blocos.length} className="tia-h">{inline(h[1])}</div>); i++; continue }

    // Listas (- item / * item / 1. item)
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ordenada = /^\s*\d+[.)]/.test(l)
      const itens = []
      while (i < linhas.length && /^\s*([-*•]|\d+[.)])\s+/.test(linhas[i])) {
        itens.push(linhas[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '')); i++
      }
      const Lista = ordenada ? 'ol' : 'ul'
      blocos.push(<Lista key={blocos.length} className="tia-lista">{itens.map((t, j) => <li key={j}>{inline(t, j)}</li>)}</Lista>)
      continue
    }

    // Parágrafo (junta linhas seguidas)
    const par = []
    while (i < linhas.length && linhas[i].trim() && !ehLinhaTabela(linhas[i]) && !/^\s*#{1,4}\s/.test(linhas[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(linhas[i])) {
      par.push(linhas[i].trim()); i++
    }
    if (par.length) blocos.push(<p key={blocos.length} className="tia-p">{inline(par.join(' '))}</p>)
    else i++
  }
  return <div className="tia">{blocos}</div>
}

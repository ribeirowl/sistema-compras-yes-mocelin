// Sugestão de transferências entre filiais (Francisco Beltrão, Dois Vizinhos, Toledo).
// Critério que o Gabriel já usava nas planilhas de transferência:
// - Destino: filial que TEM sugestão de compra do item; a quantidade nunca passa dessa sugestão.
// - Origem: filial SEM sugestão; fica com 45 dias de cobertura (1,5 × média mês) e só sai
//   o que passar disso. Pedidos em aberto da origem não contam (para não descobri-la).
// - Corte de relevância: R$ 1.000 ou 20 unidades por linha (ajustável na tela).
import { normStr } from '../utils.js'

export const FILIAIS = [
  { id:'BELTRAO',       nome:'Francisco Beltrão', curto:'F. Beltrão' },
  { id:'DOIS_VIZINHOS', nome:'Dois Vizinhos',     curto:'Dois Vizinhos' },
  { id:'TOLEDO',        nome:'Toledo',            curto:'Toledo' },
]
export const nomeFilial  = id => FILIAIS.find(f => f.id === id)?.nome || id
export const curtoFilial = id => FILIAIS.find(f => f.id === id)?.curto || id

// "1 - FRANCISCO BELTRAO" / "2 - DOIS VIZINHOS" / "3 - TOLEDO"
export function filialDe(empresa) {
  const n = normStr(empresa)
  if (/^3\s*[-–]/.test(n) || n.includes('toled')) return 'TOLEDO'
  if (/^2\s*[-–]/.test(n) || n.includes('dois viz') || n.includes('vizinhos')) return 'DOIS_VIZINHOS'
  return 'BELTRAO'
}

export const CORTE_PADRAO = { valor: 1000, unidades: 20 }
const COBERTURA_DIAS = 45

// transferRequests aprovadas há pouco (ainda chegando) abatem da necessidade do destino
function emAndamento(transferRequests, diasJanela = 10) {
  const limite = Date.now() - diasJanela * 86400000
  const m = new Map()
  for (const t of transferRequests || []) {
    if (t.status !== 'APROVADO') continue
    const quando = new Date(t.transferDate || t.resolvedAt || t.createdAt || 0).getTime()
    if (quando < limite) continue
    const k = `${t.code}__${t.cityGroup}`
    m.set(k, (m.get(k) || 0) + (Number(t.transferQty) || 0))
  }
  return m
}

export function sugerirTransferencias(rawItems, priceMap, { discMap, transferRequests } = {}) {
  const porCodigo = new Map()
  for (const i of rawItems || []) {
    const f = filialDe(i.empresa)
    const g = porCodigo.get(i.code) || { code:i.code, description:i.description, brand:i.brand, filiais:{} }
    const a = g.filiais[f] || { stock:0, reserved:0, avgMonthly:0, suggestion:0 }
    a.stock += i.stock || 0; a.reserved += i.reserved || 0
    a.avgMonthly += i.avgMonthly || 0; a.suggestion += i.suggestion || 0
    g.filiais[f] = a
    porCodigo.set(i.code, g)
  }
  const andamento = emAndamento(transferRequests)
  const linhas = []

  for (const g of porCodigo.values()) {
    const fs = Object.entries(g.filiais)
    if (fs.length < 2) continue
    const destinos = fs
      .map(([id, a]) => ({ id, a, falta: Math.max(0, Math.floor(a.suggestion) - (andamento.get(`${g.code}__${id}`) || 0)) }))
      .filter(d => d.a.suggestion > 0 && d.falta > 0)
      .sort((x, y) => y.falta - x.falta)
    if (!destinos.length) continue
    const origens = fs
      .filter(([, a]) => !(a.suggestion > 0))
      .map(([id, a]) => {
        const disp = Math.max(0, a.stock - a.reserved)
        const reserva = Math.ceil((a.avgMonthly / 30) * COBERTURA_DIAS)
        return { id, a, disp, sobra: Math.max(0, Math.floor(disp - reserva)) }
      })
      .filter(o => o.sobra > 0)
      .sort((x, y) => y.sobra - x.sobra)
    if (!origens.length) continue

    const pv = priceMap?.get(g.code)?.pv || 0
    const enc = discMap?.get(g.code)
    for (const d of destinos) {
      for (const o of origens) {
        if (d.falta <= 0) break
        const qtd = Math.min(d.falta, o.sobra)
        if (qtd <= 0) continue
        d.falta -= qtd; o.sobra -= qtd
        const dispD = Math.max(0, d.a.stock - d.a.reserved)
        linhas.push({
          id: `${g.code}__${o.id}__${d.id}`,
          code: g.code, description: g.description, brand: g.brand,
          from: o.id, to: d.id, qtd, pv, valor: qtd * pv,
          origem: { disp:o.disp, media:o.a.avgMonthly, dias: o.a.avgMonthly > 0 ? Math.round(o.disp / (o.a.avgMonthly / 30)) : null },
          destino: { disp:dispD, media:d.a.avgMonthly, sugestao:Math.floor(d.a.suggestion), dias: d.a.avgMonthly > 0 ? Math.round(dispD / (d.a.avgMonthly / 30)) : null },
          encerrado: !!enc, substituto: enc?.substitute || '',
        })
      }
    }
  }
  return linhas.sort((a, b) => b.valor - a.valor || b.qtd - a.qtd)
}

export const passaCorte = (l, corte = CORTE_PADRAO) => l.valor >= corte.valor || l.qtd >= corte.unidades

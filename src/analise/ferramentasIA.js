// Ferramentas que a IA pode usar nas perguntas do Gabriel. Rodam AQUI, no navegador,
// sobre os mesmos dados da tela (sugestão já calculada, estoque, carteira, NFs), então
// os números batem com o que o sistema mostra. A função analise-ia só repassa o pedido.
import { normStr } from '../utils.js'
import { filialDe, nomeFilial } from './transferencias.js'

const LOJA_NOME = { BELTRAO:'Beltrão + DV', TOLEDO:'Toledo' }
const r1 = v => Math.round(v * 10) / 10
const MAX_ITENS = 80

function aCaminho(code, cidade, { orders, faturadoOrders, fatRecebidos }) {
  const lista = []
  for (const o of orders || []) {
    if (o.code !== code || o.cityGroup !== cidade || o.receivedAt) continue
    if (o.source !== 'carteira' && o.source !== 'faturado' && (Date.now() - new Date(o.date).getTime()) / 864e5 > 30) continue
    lista.push({ tipo: o.source === 'carteira' ? 'carteira Intelbras' : 'pedido salvo no sistema', qtd: o.qty, previsao: o.arrivalDate || null, pedido: o.pedidoParceiro || undefined })
  }
  for (const f of faturadoOrders || []) {
    if (f.code !== code || f.cityGroup !== cidade || fatRecebidos?.[f.id]) continue
    lista.push({ tipo: 'NF faturada (em trânsito)', qtd: f.qty, previsao: f.arrivalDate || null, nf: f.nf || f.pedido })
  }
  return lista
}

// buscar_itens: termo (palavras no código/descrição/família/marca) e/ou lista de códigos
export function buscarItens({ termo = '', codigos = [], loja = 'TODAS' } = {}, ctx) {
  const { tabItems, rawItems, discMap } = ctx
  const palavras = normStr(termo).split(/\s+/).filter(Boolean)
  const cods = new Set((codigos || []).map(c => String(c).trim()))
  if (!palavras.length && !cods.size) return { erro: 'Informe um termo ou uma lista de códigos.' }

  // Detalhe por filial (FB / DV / Toledo) vindo do relatório de estoque
  const porFilial = new Map()
  for (const i of rawItems || []) {
    const lst = porFilial.get(i.code) || []
    lst.push({ filial: nomeFilial(filialDe(i.empresa)), estoque: i.stock, reservado: i.reserved, media_mes: r1(i.avgMonthly), sugestao_relatorio: i.suggestion })
    porFilial.set(i.code, lst)
  }

  const todos = Object.values(tabItems || {}).flat()
  const bate = t => {
    if (cods.size && cods.has(String(t.code))) return true
    if (!palavras.length) return false
    const alvo = normStr(`${t.code} ${t.description} ${t.family || ''} ${t.brand || ''}`)
    return palavras.every(p => alvo.includes(p))
  }
  const achados = todos.filter(t => (loja === 'TODAS' || t.cityGroup === loja) && bate(t))
  const itens = achados.slice(0, MAX_ITENS).map(t => {
    const disp = Math.max(0, (t.stock || 0) - (t.reserved || 0))
    const dias = t.avgMonthly > 0 ? Math.round(disp / (t.avgMonthly / 30)) : null
    const enc = discMap?.get(t.code)
    return {
      codigo: t.code, descricao: t.description, marca: t.brand || undefined, loja: LOJA_NOME[t.cityGroup] || t.cityGroup,
      aba: t.tab, estoque: t.stock, reservado: t.reserved, media_mes: r1(t.avgMonthly || 0), dias_de_estoque: dias,
      vendas_mes_atual: t.currentMonthSales || 0,
      a_caminho_total: t.orderedQty || 0, a_caminho: aCaminho(t.code, t.cityGroup, ctx),
      sugestao_compra: t.suggestion, multiplo: t.multiple, qtd_sugerida_no_multiplo: t.adjustedQty,
      preco_unit: t.pv || 0, valor_sugerido: Math.round((t.adjustedQty || 0) * (t.pv || 0)),
      prioridade: t.priority, encerrado: enc ? `sim — substituto ${enc.substitute || 'não informado'}` : undefined,
      por_filial: porFilial.get(t.code),
    }
  })
  return {
    encontrados: achados.length,
    mostrando: itens.length,
    aviso: achados.length > MAX_ITENS ? `Há ${achados.length} itens; mostrando ${MAX_ITENS}. Refine o termo se precisar.` : undefined,
    itens,
  }
}

export function executarFerramenta(nome, entrada, ctx) {
  try {
    if (nome === 'buscar_itens') return buscarItens(entrada, ctx)
    return { erro: `Ferramenta desconhecida: ${nome}` }
  } catch (e) {
    return { erro: `Falha ao consultar: ${e.message}` }
  }
}

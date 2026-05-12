import { useState, useEffect, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { sb } from '../supabase.js'
import { fmtCents, LOJAS, lojaNome } from '../constants.js'

// ── helpers ────────────────────────────────────────────────────────────────────
function isoWeekInfo(dateStr) {
  if (!dateStr) return { key: '', label: '' }
  const d   = new Date(dateStr + 'T12:00:00')
  const dow  = d.getDay() || 7
  const thu  = new Date(d); thu.setDate(d.getDate() + 4 - dow)
  const y0   = new Date(thu.getFullYear(), 0, 1)
  const week = Math.ceil(((thu - y0) / 86400000 + 1) / 7)
  const mon  = new Date(d); mon.setDate(d.getDate() - dow + 1)
  const sun  = new Date(mon); sun.setDate(mon.getDate() + 6)
  const f    = dt => dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  return {
    key:   `${thu.getFullYear()}-W${String(week).padStart(2, '0')}`,
    label: `Semana ${week}  ·  ${f(mon)} – ${f(sun)}`,
  }
}

function fmtMesLabel(yyyy_mm) {
  const [y, m] = yyyy_mm.split('-')
  return ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][+m - 1] + '/' + y.slice(2)
}

function sinceIso(months) {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return d.toISOString().slice(0, 10)
}

// ── Painel wrapper ─────────────────────────────────────────────────────────────
function Painel({ title, subtitle, children, headerRight, loading }) {
  return (
    <div style={{ background: 'var(--card)', borderRadius: 'var(--r)', border: '1px solid var(--border)', padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{subtitle}</div>}
        </div>
        {headerRight}
      </div>
      {loading
        ? <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Carregando...</div>
        : children}
    </div>
  )
}

function Empty({ msg }) {
  return <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{msg}</div>
}

// ── Panel 1: Faturamento por período ──────────────────────────────────────────
function PainelFaturamentoPeriodo() {
  const [rows,      setRows]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [lojaFilt,  setLojaFilt]  = useState('')
  const [meses,     setMeses]     = useState('12')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      let q = sb.from('notas_fiscais')
        .select('data_emissao,valor_total_centavos,loja_cnpj')
        .not('data_emissao', 'is', null)
        .gte('data_emissao', sinceIso(parseInt(meses)))
      if (lojaFilt) q = q.eq('loja_cnpj', lojaFilt)
      const { data } = await q
      if (cancelled) return
      const monthly = {}
      for (const nf of (data || [])) {
        const m = nf.data_emissao.slice(0, 7)
        monthly[m] = (monthly[m] || 0) + (nf.valor_total_centavos || 0)
      }
      setRows(
        Object.entries(monthly)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([m, v]) => ({ mes: m, label: fmtMesLabel(m), valor: v / 100 }))
      )
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [lojaFilt, meses])

  const total = rows.reduce((s, r) => s + r.valor, 0)
  const fmtR$ = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  const ChartTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
        <div style={{ color: 'var(--accent)' }}>{fmtR$(payload[0].value)}</div>
      </div>
    )
  }

  return (
    <Painel
      title="💰 Faturamento por período"
      subtitle={rows.length ? `Total acumulado: ${fmtR$(total)}` : undefined}
      loading={loading}
      headerRight={
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="filter-input" value={meses} onChange={e => setMeses(e.target.value)}>
            <option value="6">Últimos 6 meses</option>
            <option value="12">Últimos 12 meses</option>
            <option value="24">Últimos 24 meses</option>
          </select>
          <select className="filter-input" value={lojaFilt} onChange={e => setLojaFilt(e.target.value)}>
            <option value="">Todas as lojas</option>
            {LOJAS.map(l => <option key={l.id} value={l.cnpjRaw}>{l.nome}</option>)}
          </select>
        </div>
      }
    >
      {rows.length === 0
        ? <Empty msg="Nenhuma NF importada ainda." />
        : <ResponsiveContainer width="100%" height={220}>
            <BarChart data={rows} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false}
                tickFormatter={v => 'R$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v))}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--border)' }} />
              <Bar dataKey="valor" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={52} />
            </BarChart>
          </ResponsiveContainer>
      }
    </Painel>
  )
}

// ── Panel 2: Pedidos por status ────────────────────────────────────────────────
function PainelPedidosStatus() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const { data: pedidos } = await sb.from('pedidos')
        .select('status,pedido_itens(quantidade,valor_unit_centavos)')
        .eq('fornecedor', 'Intelbras')
      const groups = {
        aguardando: { label: 'Aguardando', color: 'var(--warning)', count: 0, valor: 0 },
        parcial:    { label: 'Parcial',    color: 'var(--info)',    count: 0, valor: 0 },
        faturado:   { label: 'Faturado',   color: 'var(--success)', count: 0, valor: 0 },
        cancelado:  { label: 'Cancelado',  color: 'var(--danger)',  count: 0, valor: 0 },
      }
      for (const p of (pedidos || [])) {
        const s = p.status || 'aguardando'
        if (!groups[s]) continue
        groups[s].count++
        groups[s].valor += (p.pedido_itens || []).reduce((acc, i) => acc + (i.valor_unit_centavos || 0) * (i.quantidade || 0), 0)
      }
      setData(groups)
      setLoading(false)
    }
    load()
  }, [])

  return (
    <Painel title="📦 Pedidos Intelbras por status" loading={loading}>
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
          {Object.entries(data).map(([k, g]) => (
            <div key={k} style={{ background: 'var(--card2)', borderRadius: 'var(--r)', padding: '12px 16px', borderLeft: `3px solid ${g.color}` }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>{g.label}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: g.color, margin: '4px 0 2px' }}>{g.count}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtCents(g.valor)}</div>
            </div>
          ))}
        </div>
      )}
    </Painel>
  )
}

// ── Panel 3: Ranking de produtos faturados ─────────────────────────────────────
function PainelRankingProdutos({ rawItems }) {
  const [data,    setData]    = useState([])
  const [loading, setLoading] = useState(true)
  const [meses,   setMeses]   = useState('12')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const { data: nfs } = await sb.from('notas_fiscais')
        .select('nf_itens(codigo,descricao,quantidade,valor_total_centavos)')
        .gte('data_emissao', sinceIso(parseInt(meses)))
        .not('data_emissao', 'is', null)
      if (cancelled) return
      const ranking = {}
      for (const nf of (nfs || [])) {
        for (const i of (nf.nf_itens || [])) {
          if (!i.codigo) continue
          if (!ranking[i.codigo]) ranking[i.codigo] = { codigo: i.codigo, descricao: '', total: 0, qty: 0 }
          ranking[i.codigo].total += i.valor_total_centavos || 0
          ranking[i.codigo].qty   += parseFloat(i.quantidade) || 0
          if (!ranking[i.codigo].descricao && i.descricao) ranking[i.codigo].descricao = i.descricao
        }
      }
      const fallbackDesc = code => (rawItems || []).find(r => r.code === code)?.description || code
      setData(
        Object.values(ranking)
          .sort((a, b) => b.total - a.total)
          .slice(0, 15)
          .map(r => ({ ...r, descricao: r.descricao || fallbackDesc(r.codigo) }))
      )
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [meses, rawItems])

  return (
    <Painel
      title="🏆 Ranking de produtos faturados"
      subtitle="Top 15 por valor total faturado"
      loading={loading}
      headerRight={
        <select className="filter-input" value={meses} onChange={e => setMeses(e.target.value)}>
          <option value="3">Últimos 3 meses</option>
          <option value="6">Últimos 6 meses</option>
          <option value="12">Últimos 12 meses</option>
        </select>
      }
    >
      {data.length === 0
        ? <Empty msg="Sem dados de faturamento no período." />
        : <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['#','Código','Produto','Qtd','Total'].map(h => (
                    <th key={h} style={{ padding: '4px 8px', textAlign: h==='#'||h==='Qtd'||h==='Total' ? (h==='#'?'left':'right') : 'left', color: 'var(--muted)', fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((r, i) => (
                  <tr key={r.codigo} style={{ borderBottom: '1px solid var(--border2)' }}>
                    <td style={{ padding: '6px 8px', color: 'var(--muted)', fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: 'var(--accent)' }}>{r.codigo}</td>
                    <td style={{ padding: '6px 8px', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.descricao}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--muted)' }}>{Math.round(r.qty)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{fmtCents(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      }
    </Painel>
  )
}

// ── Panel 4: Previsão de chegada por semana ────────────────────────────────────
function PainelPrevisaoChegada() {
  const [semanas,  setSemanas]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [expanded, setExpanded] = useState(new Set())

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const today = new Date().toISOString().slice(0, 10)
      const { data: nfs } = await sb.from('notas_fiscais')
        .select('id,numero,previsao_chegada,loja_cnpj,pedido_id,pedidos(numero)')
        .gte('previsao_chegada', today)
        .not('previsao_chegada', 'is', null)
        .order('previsao_chegada')
      const byWeek = {}, order = []
      for (const nf of (nfs || [])) {
        const { key, label } = isoWeekInfo(nf.previsao_chegada)
        if (!byWeek[key]) { byWeek[key] = { key, label, nfs: [] }; order.push(key) }
        byWeek[key].nfs.push(nf)
      }
      setSemanas(order.map(k => byWeek[k]))
      if (order.length) setExpanded(new Set([order[0]]))
      setLoading(false)
    }
    load()
  }, [])

  const toggle = k => setExpanded(prev => { const s = new Set(prev); s.has(k) ? s.delete(k) : s.add(k); return s })

  return (
    <Painel title="📅 Previsão de chegada por semana" subtitle="NFs com chegada prevista a partir de hoje" loading={loading}>
      {semanas.length === 0
        ? <Empty msg="Nenhuma previsão de chegada registrada." />
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {semanas.map(s => (
              <div key={s.key} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r)', overflow: 'hidden' }}>
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', cursor: 'pointer', userSelect: 'none', background: 'var(--card2)' }}
                  onClick={() => toggle(s.key)}
                >
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{s.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {s.nfs.length} NF{s.nfs.length > 1 ? 's' : ''}  {expanded.has(s.key) ? '▲' : '▼'}
                  </span>
                </div>
                {expanded.has(s.key) && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--surface)' }}>
                        {['NF','Pedido','Loja','Previsão'].map(h => (
                          <th key={h} style={{ padding: '4px 14px', textAlign: h==='Previsão'?'right':'left', color: 'var(--muted)', fontWeight: 700 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {s.nfs.map(nf => (
                        <tr key={nf.id || nf.numero} style={{ borderTop: '1px solid var(--border2)' }}>
                          <td style={{ padding: '6px 14px', fontFamily: 'monospace', color: 'var(--accent)' }}>{nf.numero}</td>
                          <td style={{ padding: '6px 14px' }}>{nf.pedidos?.numero || '—'}</td>
                          <td style={{ padding: '6px 14px', color: 'var(--muted)' }}>{lojaNome(nf.loja_cnpj)}</td>
                          <td style={{ padding: '6px 14px', textAlign: 'right' }}>
                            {nf.previsao_chegada ? new Date(nf.previsao_chegada + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
      }
    </Painel>
  )
}

// ── Panel 5: Estoque baixo vs pedido em aberto ────────────────────────────────
function PainelEstoqueBaixo({ rawItems }) {
  const [pedidoCodes, setPedidoCodes] = useState(new Set())
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const { data: pedidos } = await sb.from('pedidos')
        .select('pedido_itens(codigo)')
        .in('status', ['aguardando', 'parcial'])
      const codes = new Set()
      for (const p of (pedidos || []))
        for (const i of (p.pedido_itens || []))
          if (i.codigo) codes.add(i.codigo)
      setPedidoCodes(codes)
      setLoading(false)
    }
    load()
  }, [])

  const baixo = useMemo(() => {
    const byCode = {}
    for (const item of (rawItems || [])) {
      if (!byCode[item.code]) byCode[item.code] = { code: item.code, description: item.description, stock: 0, suggestion: 0 }
      byCode[item.code].stock      += item.stock      || 0
      byCode[item.code].suggestion += item.suggestion || 0
    }
    return Object.values(byCode)
      .filter(i => i.suggestion > 0 && i.stock < i.suggestion)
      .sort((a, b) => (b.suggestion - b.stock) - (a.suggestion - a.stock))
      .slice(0, 40)
  }, [rawItems])

  const cobertos    = baixo.filter(i => pedidoCodes.has(i.code)).length
  const descobertos = baixo.length - cobertos

  return (
    <Painel
      title="⚠️ Estoque baixo vs pedido em aberto"
      subtitle={baixo.length ? `${baixo.length} produtos abaixo da sugestão  ·  ${cobertos} cobertos  ·  ${descobertos} descobertos` : undefined}
      loading={loading}
    >
      {baixo.length === 0
        ? <Empty msg={rawItems?.length ? 'Nenhum produto abaixo da sugestão.' : 'Importe o relatório de estoque primeiro.'} />
        : <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Código','Produto','Estoque','Sugestão','Cobertura'].map(h => (
                    <th key={h} style={{ padding: '4px 8px', textAlign: ['Estoque','Sugestão'].includes(h)?'right':h==='Cobertura'?'center':'left', color: 'var(--muted)', fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {baixo.map(item => {
                  const coberto = pedidoCodes.has(item.code)
                  return (
                    <tr key={item.code} style={{ borderBottom: '1px solid var(--border2)' }}>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: 'var(--accent)' }}>{item.code}</td>
                      <td style={{ padding: '6px 8px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description || '—'}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--danger)', fontWeight: 600 }}>{item.stock}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{item.suggestion}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                        {coberto
                          ? <span style={{ color: 'var(--success)', fontWeight: 700, fontSize: 11 }}>✅ Coberto</span>
                          : <span style={{ color: 'var(--warning)', fontWeight: 700, fontSize: 11 }}>⚠️ Descoberto</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
      }
    </Painel>
  )
}

// ── Panel 6: Top itens por média de vendas ────────────────────────────────────
function PainelTopMediaVendas({ rawItems }) {
  const [nfQtdMes, setNfQtdMes] = useState({})
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const mes = new Date().toISOString().slice(0, 7)
      const { data: nfs } = await sb.from('notas_fiscais')
        .select('nf_itens(codigo,quantidade)')
        .gte('data_emissao', mes + '-01')
      const qtd = {}
      for (const nf of (nfs || []))
        for (const i of (nf.nf_itens || []))
          if (i.codigo) qtd[i.codigo] = (qtd[i.codigo] || 0) + (parseFloat(i.quantidade) || 0)
      setNfQtdMes(qtd)
      setLoading(false)
    }
    load()
  }, [])

  const top = useMemo(() => {
    const byCode = {}
    for (const item of (rawItems || [])) {
      if (!byCode[item.code]) byCode[item.code] = { code: item.code, description: item.description, avgMonthly: 0, currentMonthSales: 0 }
      byCode[item.code].avgMonthly        += item.avgMonthly        || 0
      byCode[item.code].currentMonthSales += item.currentMonthSales || 0
    }
    return Object.values(byCode)
      .filter(i => i.avgMonthly > 0)
      .sort((a, b) => b.avgMonthly - a.avgMonthly)
      .slice(0, 20)
  }, [rawItems])

  return (
    <Painel title="📈 Top itens por média de vendas" subtitle="Média mensal do relatório de estoque · Top 20" loading={loading}>
      {top.length === 0
        ? <Empty msg="Importe o relatório de estoque para ver este painel." />
        : <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['#','Código','Produto','Média/mês','Mês atual','NF mês'].map(h => (
                    <th key={h} style={{ padding: '4px 8px', textAlign: ['Média/mês','Mês atual','NF mês'].includes(h)?'right':h==='#'?'left':'left', color: 'var(--muted)', fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {top.map((item, i) => {
                  const nfQtd = nfQtdMes[item.code] || 0
                  const pct   = item.avgMonthly > 0 ? item.currentMonthSales / item.avgMonthly : 0
                  const clr   = pct >= 0.8 ? 'var(--success)' : pct >= 0.5 ? 'var(--warning)' : 'var(--danger)'
                  return (
                    <tr key={item.code} style={{ borderBottom: '1px solid var(--border2)' }}>
                      <td style={{ padding: '6px 8px', color: 'var(--muted)', fontWeight: 700 }}>{i + 1}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: 'var(--accent)' }}>{item.code}</td>
                      <td style={{ padding: '6px 8px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description || '—'}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--muted)' }}>{Math.round(item.avgMonthly)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: clr }}>{Math.round(item.currentMonthSales)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--info)' }}>{nfQtd > 0 ? Math.round(nfQtd) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
      }
    </Painel>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function RelatoriosTab({ role, rawItems }) {
  const isGerencia = ['GABRIEL', 'ADMIN', 'GERENCIA'].includes(role)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 className="page-title">📊 Relatórios</h2>
        <p className="page-subtitle">
          {isGerencia ? 'Painéis gerenciais e operacionais' : 'Painéis operacionais'}
        </p>
      </div>

      {isGerencia && <>
        <PainelFaturamentoPeriodo />
        <PainelPedidosStatus />
        <PainelRankingProdutos rawItems={rawItems} />
      </>}

      <PainelPrevisaoChegada />
      <PainelEstoqueBaixo rawItems={rawItems} />
      <PainelTopMediaVendas rawItems={rawItems} />
    </div>
  )
}

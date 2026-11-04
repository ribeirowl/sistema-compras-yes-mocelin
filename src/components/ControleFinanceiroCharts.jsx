import { useMemo, useState } from 'react'
import {
  ComposedChart, AreaChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'
import { fmtBRL } from '../utils.js'

// Paleta do painel (categórica validada: azul / laranja; limite em cinza neutro).
// Status (ok/atenção/excedido) usa os tokens do sistema e sempre vem com texto.
const COR = {
  fat:    '#2a78d6',
  ent:    '#eb6834',
  limite: '#8a8984',
  grid:   'var(--line)',
  ink2:   'var(--ink-2, #52514e)',
}
const LIMITE_PCT = 0.725
const ATENCAO_PCT = 0.62
// Cores da linha de uso por faixa (mesmos tons de status do sistema)
const FAIXA = { ok:'#1FA55B', atencao:'#E3A008', excedido:'#E5533A' }
const corUso = pct => pct == null ? COR.limite : pct > LIMITE_PCT*100 ? FAIXA.excedido : pct > ATENCAO_PCT*100 ? FAIXA.atencao : FAIXA.ok

const fromC = v => (parseInt(v)||0) / 100
const mesCurto = m => {
  const [y, mo] = m.split('-')
  return new Date(+y, +mo-1, 1).toLocaleString('pt-BR', { month:'short' }).replace('.','') + '/' + y.slice(2)
}
const mesLongo = m => {
  const [y, mo] = m.split('-')
  return new Date(+y, +mo-1, 1).toLocaleString('pt-BR', { month:'long', year:'numeric' })
}
const kFmt = v => v >= 1e6 ? `${(v/1e6).toFixed(1).replace('.',',')} mi` : v >= 1000 ? `${Math.round(v/1000)} mil` : String(Math.round(v))
const pctFmt = v => `${(v*100).toFixed(1).replace('.',',')}%`

function status(uso) {
  if (uso == null) return { txt:'Sem faturamento', cor:'var(--muted)', icone:'—' }
  if (uso > LIMITE_PCT)  return { txt:'Excedido', cor:'var(--danger-ink)', icone:'⛔' }
  if (uso > ATENCAO_PCT) return { txt:'Atenção',  cor:'var(--warn-ink)',   icone:'⚠️' }
  return { txt:'Dentro do limite', cor:'var(--ok-ink)', icone:'✅' }
}

const LOJAS = [
  { id:'TOTAL',   label:'Consolidado' },
  { id:'BELTRAO', label:'Beltrão + DV' },
  { id:'TOLEDO',  label:'Toledo' },
]

function valores(fin, loja) {
  const ks = loja === 'TOTAL' ? ['BELTRAO','TOLEDO'] : [loja]
  const fat = ks.reduce((s,k)=>s+fromC(fin?.[k]),0)
  const ent = ks.reduce((s,k)=>s+fromC(fin?.[`reais${k}`]),0)
  return { fat, ent, limite: fat*LIMITE_PCT, uso: fat > 0 ? ent/fat : null }
}

// Barra-bala: entradas contra o faturamento, com o marcador do limite de 72,5%
function Bala({ titulo, v, ativo, onClick }) {
  const [hover, setHover] = useState(false)
  const escala = Math.max(v.fat, v.ent, 1)
  const st = status(v.uso)
  const wEnt = Math.min(100, v.ent/escala*100), wLim = v.limite/escala*100
  const sobra = v.limite - v.ent
  return (
    <button type="button" className={`cf-bala${ativo?' ativo':''}`} onClick={onClick}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} onFocus={()=>setHover(true)} onBlur={()=>setHover(false)}
      aria-label={`${titulo}: entradas ${fmtBRL(v.ent)} de limite ${fmtBRL(v.limite)}`}>
      <div className="cf-bala-top">
        <span className="cf-bala-nome">{titulo}</span>
        <span className="cf-bala-st" style={{color:st.cor}}>{st.icone} {st.txt}</span>
      </div>
      <div className="cf-bala-hero">
        <strong>{v.fat > 0 ? fmtBRL(Math.abs(sobra)) : '—'}</strong>
        <span>{v.fat > 0 ? (sobra >= 0 ? 'ainda pode comprar' : 'acima do limite') : 'informe o faturamento'}</span>
      </div>
      <div className="cf-track">
        <div className="cf-fill" style={{width:`${wEnt}%`, background:COR.ent}}/>
        {v.fat > 0 && <div className="cf-marker" style={{left:`${wLim}%`}}><span>limite</span></div>}
      </div>
      <div className="cf-bala-leg">
        <span><i style={{background:COR.ent}}/>Entradas <b>{fmtBRL(v.ent)}</b></span>
        <span>Uso <b>{v.uso != null ? pctFmt(v.uso) : '—'}</b></span>
        <span>Faturamento <b>{fmtBRL(v.fat)}</b></span>
      </div>
      {hover && v.fat > 0 && (
        <div className="cf-tip" role="tooltip">
          <div><b>{fmtBRL(v.ent)}</b> entradas</div>
          <div><b>{fmtBRL(v.limite)}</b> limite (72,5%)</div>
          <div><b>{fmtBRL(v.fat)}</b> faturamento</div>
        </div>
      )}
    </button>
  )
}

function TipMes({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const st = status(d.uso)
  return (
    <div className="cf-tip cf-tip-chart">
      <div className="cf-tip-t">{d.mesLongo}</div>
      <div><i style={{background:COR.fat}}/><b>{fmtBRL(d.fat)}</b> faturamento</div>
      <div><i style={{background:COR.ent}}/><b>{fmtBRL(d.ent)}</b> entradas</div>
      <div><i className="tr" style={{borderColor:COR.limite}}/><b>{fmtBRL(d.limite)}</b> limite</div>
      <div style={{color:st.cor,marginTop:4}}>{st.icone} {d.uso!=null ? `${pctFmt(d.uso)} do faturamento` : st.txt}</div>
    </div>
  )
}

function TipUso({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const st = status(d.uso)
  return (
    <div className="cf-tip cf-tip-chart">
      <div className="cf-tip-t">{d.mesLongo}</div>
      <div><b>{d.uso!=null ? pctFmt(d.uso) : '—'}</b> do faturamento</div>
      <div style={{color:st.cor}}>{st.icone} {st.txt}</div>
    </div>
  )
}

export default function ControleFinanceiroCharts({ finData, mesSel, onMes, meses }) {
  const [loja, setLoja]   = useState('TOTAL')
  const [ocultas, setOcultas] = useState({})   // séries escondidas pela legenda
  const toggle = k => setOcultas(o => ({ ...o, [k]: !o[k] }))

  const hist = useMemo(() => [...meses].sort().slice(-12).map(m => {
    const v = valores(finData[m], loja)
    return { mes:m, mesCurto:mesCurto(m), mesLongo:mesLongo(m), ...v, usoPct: v.uso != null ? +(v.uso*100).toFixed(1) : null }
  }), [meses, finData, loja])
  // Eixo enxuto: só o mês; o ano aparece no 1º mês e em janeiro (o tooltip mostra a data completa)
  const tickMes = (label, i) => {
    const h = hist[i]; if (!h) return label
    return (i === 0 || h.mes.endsWith('-01')) ? label : label.split('/')[0]
  }

  const mesAtual = valores(finData[mesSel], loja)
  const temHist = hist.some(h => h.ent > 0)
  // Escala do uso ajustada aos dados (antes começava em 0 e achatava a variação),
  // sempre mostrando as faixas de atenção (62%) e limite (72,5%)
  const usos = hist.map(h => h.usoPct).filter(v => v != null)
  const usoMin = usos.length ? Math.min(...usos) : 0, usoMax = usos.length ? Math.max(...usos) : 0
  const yMin = Math.max(0, Math.floor((Math.min(usoMin, ATENCAO_PCT*100) - 8) / 5) * 5)
  const yMax = Math.ceil((Math.max(usoMax, LIMITE_PCT*100) + 5) / 5) * 5
  const usoMedio = usos.length ? usos.reduce((s,v)=>s+v,0) / usos.length : null
  // Degradê "duro" por faixa: o traço muda de cor ao cruzar 62% e 72,5%.
  // O gradiente do traço vale sobre a caixa da linha (do maior ao menor valor);
  // o do preenchimento vale do maior valor até o eixo (yMin).
  const off = (t, topo, base) => topo === base ? (t >= topo ? 0 : 1) : Math.min(1, Math.max(0, (topo - t) / (topo - base)))
  const paradas = (topo, base) => {
    const a = off(LIMITE_PCT*100, topo, base), b = off(ATENCAO_PCT*100, topo, base)
    return [[0,FAIXA.excedido],[a,FAIXA.excedido],[a,FAIXA.atencao],[b,FAIXA.atencao],[b,FAIXA.ok],[1,FAIXA.ok]]
  }

  const series = [
    { k:'fat', label:'Faturamento', cor:COR.fat },
    { k:'ent', label:'Entradas',    cor:COR.ent },
    { k:'limite', label:'Limite (72,5%)', cor:COR.limite, linha:true },
  ]

  return (
    <div className="cf-root">
      {/* Cards-bala por loja (clique filtra os gráficos abaixo) */}
      <div className="cf-balas">
        {LOJAS.map(l => (
          <Bala key={l.id} titulo={l.label} v={valores(finData[mesSel], l.id)} ativo={loja===l.id} onClick={()=>setLoja(l.id)}/>
        ))}
      </div>

      {/* Filtros numa linha só */}
      <div className="cf-filtros">
        <div className="cf-seg" role="tablist" aria-label="Loja">
          {LOJAS.map(l => (
            <button key={l.id} role="tab" aria-selected={loja===l.id} className={loja===l.id?'on':''} onClick={()=>setLoja(l.id)}>{l.label}</button>
          ))}
        </div>
        <span className="cf-hint">Clique num mês do gráfico para ver os números dele</span>
      </div>

      {!temHist ? (
        <div className="cf-vazio">
          Nenhuma entrada informada ainda. Use <b>✏️ Inserir dados</b> e preencha <b>Entradas do mês</b> de cada loja.
        </div>
      ) : (
        <div className="cf-grid">
          <div className="cf-card">
            <div className="cf-card-h">
              <div>
                <div className="cf-card-t">Faturamento × Entradas</div>
                <div className="cf-card-s">{LOJAS.find(l=>l.id===loja).label} · últimos {hist.length} meses</div>
              </div>
              <div className="cf-legenda">
                {series.map(s => (
                  <button key={s.k} type="button" className={ocultas[s.k]?'off':''} onClick={()=>toggle(s.k)} aria-pressed={!ocultas[s.k]}>
                    <i className={s.linha?'tr':''} style={s.linha?{borderColor:s.cor}:{background:s.cor}}/>{s.label}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={hist} barGap={2} barCategoryGap="28%" margin={{top:8,right:8,left:0,bottom:0}}
                onClick={e => e?.activePayload?.[0] && onMes(e.activePayload[0].payload.mes)}>
                <CartesianGrid stroke={COR.grid} vertical={false}/>
                <XAxis dataKey="mesCurto" interval={0} tickFormatter={tickMes} tick={{fill:COR.ink2,fontSize:10.5}} axisLine={false} tickLine={false} tickMargin={6}/>
                <YAxis tickFormatter={kFmt} tick={{fill:COR.ink2,fontSize:11}} axisLine={false} tickLine={false} width={58}/>
                <Tooltip content={<TipMes/>} cursor={{fill:'rgba(22,24,26,.05)'}}/>
                {!ocultas.fat && (
                  <Bar dataKey="fat" fill={COR.fat} radius={[4,4,0,0]} maxBarSize={28} style={{cursor:'pointer'}}>
                    {hist.map(h => <Cell key={h.mes} fillOpacity={h.mes===mesSel?1:0.55}/>)}
                  </Bar>
                )}
                {!ocultas.ent && (
                  <Bar dataKey="ent" fill={COR.ent} radius={[4,4,0,0]} maxBarSize={28} style={{cursor:'pointer'}}>
                    {hist.map(h => <Cell key={h.mes} fillOpacity={h.mes===mesSel?1:0.55}/>)}
                  </Bar>
                )}
                {!ocultas.limite && (
                  <Line dataKey="limite" type="monotone" stroke={COR.limite} strokeWidth={2} strokeDasharray="5 4"
                    dot={{r:3,fill:'#fff',stroke:COR.limite,strokeWidth:2}} activeDot={{r:5}}/>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="cf-card">
            <div className="cf-card-h">
              <div>
                <div className="cf-card-t">Uso do faturamento</div>
                <div className="cf-card-s">Entradas ÷ faturamento · limite 72,5%</div>
              </div>
              <div className="cf-hero-mini" style={{color:status(mesAtual.uso).cor}}>
                {mesAtual.uso != null ? pctFmt(mesAtual.uso) : '—'}
                <span>{mesLongo(mesSel)}</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={hist} margin={{top:8,right:12,left:0,bottom:0}}
                onClick={e => e?.activePayload?.[0] && onMes(e.activePayload[0].payload.mes)}>
                <defs>
                  <linearGradient id="cfUsoLinha" x1="0" y1="0" x2="0" y2="1">
                    {paradas(usoMax, usoMin).map(([o,c],i) => <stop key={i} offset={o} stopColor={c}/>)}
                  </linearGradient>
                  <linearGradient id="cfUsoArea" x1="0" y1="0" x2="0" y2="1">
                    {paradas(usoMax, yMin).map(([o,c],i) => <stop key={i} offset={o} stopColor={c} stopOpacity={0.22 - o*0.18}/>)}
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={COR.grid} vertical={false}/>
                <XAxis dataKey="mesCurto" interval={0} tickFormatter={tickMes} tick={{fill:COR.ink2,fontSize:10.5}} axisLine={false} tickLine={false} tickMargin={6}/>
                <YAxis domain={[yMin, yMax]} tickFormatter={v=>`${v}%`} tick={{fill:COR.ink2,fontSize:11}} axisLine={false} tickLine={false} width={44} allowDataOverflow/>
                <Tooltip content={<TipUso/>} cursor={{stroke:COR.limite,strokeWidth:1}}/>
                <ReferenceLine y={LIMITE_PCT*100} stroke={FAIXA.excedido} strokeDasharray="5 4"
                  label={{value:'limite 72,5%',position:'insideTopRight',fill:'var(--danger-ink)',fontSize:10}}/>
                <ReferenceLine y={ATENCAO_PCT*100} stroke={FAIXA.atencao} strokeDasharray="2 4"
                  label={{value:'atenção 62%',position:'insideBottomRight',fill:'var(--warn-ink)',fontSize:10}}/>
                {usoMedio != null && (
                  <ReferenceLine y={usoMedio} stroke={COR.ink2} strokeOpacity={0.6} strokeDasharray="1 3"
                    label={{value:`média ${usoMedio.toFixed(1).replace('.',',')}%`,position:'insideBottomLeft',fill:COR.ink2,fontSize:10}}/>
                )}
                <ReferenceLine x={mesCurto(mesSel)} stroke={COR.ink2} strokeOpacity={0.35}/>
                <Area dataKey="usoPct" type="monotone" stroke="url(#cfUsoLinha)" strokeWidth={2.5} fill="url(#cfUsoArea)" connectNulls baseValue={yMin}
                  dot={p => p.payload.usoPct == null ? null : <circle key={p.index} cx={p.cx} cy={p.cy} r={4} fill="#fff" stroke={corUso(p.payload.usoPct)} strokeWidth={2}/>}
                  activeDot={p => <circle cx={p.cx} cy={p.cy} r={6} fill={corUso(p.payload.usoPct)} stroke="#fff" strokeWidth={2} style={{cursor:'pointer'}}/>}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

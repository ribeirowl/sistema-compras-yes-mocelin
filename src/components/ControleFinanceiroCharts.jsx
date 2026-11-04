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
const ATENCAO_PCT = 0.58

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
  const maxUso = Math.max(80, ...hist.map(h => h.usoPct || 0)) + 5

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
                  <linearGradient id="cfUso" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COR.ent} stopOpacity={0.35}/>
                    <stop offset="100%" stopColor={COR.ent} stopOpacity={0.02}/>
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={COR.grid} vertical={false}/>
                <XAxis dataKey="mesCurto" interval={0} tickFormatter={tickMes} tick={{fill:COR.ink2,fontSize:10.5}} axisLine={false} tickLine={false} tickMargin={6}/>
                <YAxis domain={[0, Math.ceil(maxUso/10)*10]} tickFormatter={v=>`${v}%`} tick={{fill:COR.ink2,fontSize:11}} axisLine={false} tickLine={false} width={44}/>
                <Tooltip content={<TipUso/>} cursor={{stroke:COR.limite,strokeWidth:1}}/>
                <ReferenceLine y={72.5} stroke="var(--danger-ink)" strokeDasharray="5 4"
                  label={{value:'limite 72,5%',position:'insideTopRight',fill:'var(--danger-ink)',fontSize:10}}/>
                <ReferenceLine y={58} stroke="var(--warn-ink)" strokeDasharray="2 4"
                  label={{value:'atenção 58%',position:'insideBottomRight',fill:'var(--warn-ink)',fontSize:10}}/>
                <ReferenceLine x={mesCurto(mesSel)} stroke={COR.ink2} strokeOpacity={0.35}/>
                <Area dataKey="usoPct" type="monotone" stroke={COR.ent} strokeWidth={2} fill="url(#cfUso)" connectNulls
                  dot={{r:4,fill:'#fff',stroke:COR.ent,strokeWidth:2}} activeDot={{r:6,style:{cursor:'pointer'}}}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

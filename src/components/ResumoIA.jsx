import { useEffect, useRef, useState } from 'react'
import { sb, sbFetchAll, getDataDate } from '../supabase.js'
import { montarIndicadores } from '../analise/indicadores.js'

// "Resumo do turno" (todos que veem o financeiro) + perguntas à IA (só o Gabriel).
// Os números vêm de indicadores.js; a IA só redige. A chamada passa pela função
// analise-ia do Supabase, que guarda a chave da Anthropic e gera 1 resumo por turno.

const CNPJ_CITY = { '35369505000102':'BELTRAO', '35369505000374':'TOLEDO' }
const FIN_KEY = 'sc_financial_months'
const TOKEN_KEY = 'sc_ia_token'
const HIST_KEY = 'sc_ia_conversa'

const AREAS = {
  ritmo_do_limite: { icone:'📈', nome:'Ritmo do limite' },
  financeiro:      { icone:'💰', nome:'Financeiro' },
  ruptura:         { icone:'🚨', nome:'Ruptura' },
  conferencias:    { icone:'🔎', nome:'Conferências' },
  transferencias:  { icone:'🔄', nome:'Transferências' },
}
const NIVEL = {
  ok:      { cor:'var(--ok-ink)',     bg:'#EAF7F0', txt:'OK' },
  atencao: { cor:'var(--warn-ink)',   bg:'#FDF4E3', txt:'Atenção' },
  critico: { cor:'var(--danger-ink)', bg:'#FCEEEB', txt:'Crítico' },
}

const lerToken = () => { try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' } }

async function carregarBase() {
  const since = new Date(); since.setMonth(since.getMonth() - 7)
  const sinceStr = `${since.getFullYear()}-${String(since.getMonth()+1).padStart(2,'0')}-01`
  const [nfsRaw, fin] = await Promise.all([
    sbFetchAll(() => sb.from('notas_fiscais').select('data_emissao,loja_cnpj,valor_total_centavos')
      .gte('data_emissao', sinceStr).order('id', { ascending:true })),
    sb.from('app_data').select('value').eq('key', FIN_KEY).maybeSingle(),
  ])
  const nfs = (nfsRaw || []).map(n => ({
    data: n.data_emissao, loja: CNPJ_CITY[String(n.loja_cnpj||'').replace(/\D/g,'')],
    valor: (parseInt(n.valor_total_centavos)||0) / 100,
  })).filter(n => n.data && n.loja)
  let finData = {}
  try { finData = JSON.parse(fin?.data?.value || '{}') } catch {}
  return { nfs, finData }
}

async function chamar(body, token) {
  const { data, error } = await sb.functions.invoke('analise-ia', {
    body, headers: token ? { 'x-ia-token': token } : {},
  })
  if (error) {
    let msg = error.message
    try { msg = (await error.context?.json())?.erro || msg } catch {}
    throw new Error(msg)
  }
  if (data?.erro) throw new Error(data.erro)
  return data
}

export default function ResumoIA({ ctx, podePerguntar }) {
  const [resumo, setResumo]   = useState(null)
  const [estado, setEstado]   = useState('carregando')  // carregando | ok | erro
  const [erro, setErro]       = useState('')
  const [aberto, setAberto]   = useState(true)
  const indicadoresRef = useRef(null)

  const obterIndicadores = async () => {
    const base = await carregarBase()
    indicadoresRef.current = montarIndicadores({ ...ctx, ...base, dataDate: getDataDate() })
    return indicadoresRef.current
  }

  const carregar = async (forcar = false) => {
    setEstado('carregando'); setErro('')
    try {
      const indicadores = await obterIndicadores()
      const r = await chamar({ tipo:'resumo', indicadores, forcar }, forcar ? lerToken() : '')
      setResumo(r); setEstado('ok')
    } catch (e) { setErro(e.message); setEstado('erro') }
  }

  // Gera/busca o resumo quando os dados do estoque estão carregados
  const pronto = (ctx.rawItems || []).length > 0
  useEffect(() => { if (pronto) carregar(false) }, [pronto]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!pronto) return null

  const quando = resumo?.gerado_em ? new Date(resumo.gerado_em).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' }) : ''

  return (
    <section className="ia-card">
      <div className="ia-head">
        <button type="button" className="ia-toggle" onClick={()=>setAberto(a=>!a)} aria-expanded={aberto}>
          <span className="ia-spark">✨</span>
          <span>
            <strong>Resumo do turno</strong>
            <small>{resumo?.turno ? `${resumo.turno === 'manha' ? 'Manhã' : 'Tarde'} · gerado ${quando}` : 'Análise com IA dos números de hoje'}</small>
          </span>
        </button>
        {podePerguntar && estado !== 'carregando' && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={()=>carregar(true)} title="Gera de novo com os números de agora">↻ Atualizar</button>
        )}
      </div>

      {aberto && (
        <div className="ia-body">
          {estado === 'carregando' && <div className="ia-load"><span className="ia-dot"/>Analisando os números…</div>}
          {estado === 'erro' && <div className="ia-erro">Não foi possível gerar o resumo: {erro}</div>}
          {estado === 'ok' && resumo?.blocos && (
            <>
              {resumo.manchete && <p className="ia-manchete">{resumo.manchete}</p>}
              <div className="ia-blocos">
                {resumo.blocos.map((b, i) => {
                  const a = AREAS[b.area] || { icone:'•', nome:b.area }, n = NIVEL[b.nivel] || NIVEL.ok
                  return (
                    <article key={i} className="ia-bloco" style={{ borderLeftColor:n.cor }}>
                      <div className="ia-bloco-h">
                        <span>{a.icone} {a.nome}</span>
                        <span className="ia-nivel" style={{ color:n.cor, background:n.bg }}>{n.txt}</span>
                      </div>
                      <div className="ia-bloco-t">{b.titulo}</div>
                      <p>{b.texto}</p>
                    </article>
                  )
                })}
              </div>
            </>
          )}
          {estado === 'ok' && resumo?.vazio && <div className="ia-load">Ainda não há resumo deste turno.</div>}
          {podePerguntar && <Perguntas obterIndicadores={async () => indicadoresRef.current || obterIndicadores()}/>}
        </div>
      )}
    </section>
  )
}

function Perguntas({ obterIndicadores }) {
  const [token, setToken]     = useState(lerToken)
  const [novoToken, setNovoToken] = useState('')
  const [conversa, setConversa] = useState(() => { try { return JSON.parse(sessionStorage.getItem(HIST_KEY) || '[]') } catch { return [] } })
  const [pergunta, setPergunta] = useState('')
  const [enviando, setEnviando] = useState(false)
  const fimRef = useRef(null)

  useEffect(() => {
    try { sessionStorage.setItem(HIST_KEY, JSON.stringify(conversa.slice(-20))) } catch {}
    fimRef.current?.scrollIntoView({ block:'nearest' })
  }, [conversa])

  if (!token) {
    return (
      <form className="ia-perg ia-token" onSubmit={e => { e.preventDefault(); const t = novoToken.trim(); if (!t) return; try { localStorage.setItem(TOKEN_KEY, t) } catch {}; setToken(t) }}>
        <span>Para liberar as perguntas neste computador, informe o código de acesso da IA (só uma vez):</span>
        <input type="password" className="filter-search" value={novoToken} onChange={e=>setNovoToken(e.target.value)} placeholder="Código de acesso" autoComplete="off"/>
        <button className="btn btn-sm btn-yellow" type="submit">Liberar</button>
      </form>
    )
  }

  const enviar = async e => {
    e.preventDefault()
    const q = pergunta.trim(); if (!q || enviando) return
    const historico = conversa.map(m => ({ role:m.role, content:m.content }))
    setConversa(c => [...c, { role:'user', content:q }]); setPergunta(''); setEnviando(true)
    try {
      const indicadores = await obterIndicadores()
      const r = await chamar({ tipo:'pergunta', pergunta:q, historico, indicadores }, token)
      setConversa(c => [...c, { role:'assistant', content:r.resposta }])
    } catch (err) {
      if (/token/i.test(err.message)) { try { localStorage.removeItem(TOKEN_KEY) } catch {}; setToken('') }
      setConversa(c => [...c, { role:'assistant', content:`⚠️ ${err.message}`, erro:true }])
    } finally { setEnviando(false) }
  }

  const sugestoes = ['Qual loja preciso segurar as compras esta semana?', 'O que devo comprar primeiro hoje?', 'Como este mês está em relação à média?']

  return (
    <div className="ia-perg">
      <div className="ia-perg-h">
        <strong>Pergunte à IA</strong>
        {conversa.length > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={()=>setConversa([])}>Limpar conversa</button>}
      </div>
      {conversa.length === 0 && (
        <div className="ia-sugs">
          {sugestoes.map(s => <button key={s} type="button" onClick={()=>setPergunta(s)}>{s}</button>)}
        </div>
      )}
      {conversa.length > 0 && (
        <div className="ia-conversa">
          {conversa.map((m, i) => <div key={i} className={`ia-msg ${m.role}${m.erro?' erro':''}`}>{m.content}</div>)}
          {enviando && <div className="ia-msg assistant"><span className="ia-dot"/>Pensando…</div>}
          <div ref={fimRef}/>
        </div>
      )}
      <form className="ia-input" onSubmit={enviar}>
        <input className="filter-search" value={pergunta} onChange={e=>setPergunta(e.target.value)} placeholder="Ex.: quanto ainda posso comprar em Toledo até o fim do mês?" disabled={enviando}/>
        <button className="btn btn-yellow btn-sm" type="submit" disabled={enviando || !pergunta.trim()}>Perguntar</button>
      </form>
    </div>
  )
}

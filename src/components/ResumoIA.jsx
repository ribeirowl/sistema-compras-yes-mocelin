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
// Atalho para a tela onde se resolve cada assunto
const ATALHO = {
  transferencias: { id:'transferencias', txt:'Abrir transferências' },
  conferencias:   { id:'pedidos',        txt:'Ver pedidos e chegadas' },
  ruptura:        { id:'BELTRAO',        txt:'Abrir sugestão de compra' },
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

export default function ResumoIA({ ctx, podePerguntar, onGoTab }) {
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

  const quando = resumo?.gerado_em ? new Date(resumo.gerado_em).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : ''
  const ORDEM = { critico:0, atencao:1, ok:2 }
  const blocos = [...(resumo?.blocos || [])].sort((x, y) => (ORDEM[x.nivel] ?? 3) - (ORDEM[y.nivel] ?? 3))
  const conta = n => blocos.filter(b => b.nivel === n).length

  return (
    <section className="ia2">
      <div className="ia2-hero">
        <div className="ia2-top">
          <button type="button" className="ia2-badge" onClick={()=>setAberto(a=>!a)} aria-expanded={aberto} title={aberto ? 'Recolher' : 'Expandir'}>
            <span className="ia2-spark">✦</span> Resumo do turno
            <span className="ia2-meta">{resumo?.turno ? `${resumo.turno === 'manha' ? 'Manhã' : 'Tarde'} · ${quando}` : 'Análise com IA'}</span>
            <span className={`ia2-caret${aberto ? '' : ' fechado'}`}>▾</span>
          </button>
          <div className="ia2-acoes">
            {estado === 'ok' && blocos.length > 0 && (
              <div className="ia2-contagem">
                {conta('critico') > 0 && <span className="c">{conta('critico')} crítico{conta('critico') > 1 ? 's' : ''}</span>}
                {conta('atencao') > 0 && <span className="a">{conta('atencao')} atenção</span>}
                {conta('ok') > 0 && <span className="o">{conta('ok')} ok</span>}
              </div>
            )}
            {podePerguntar && estado !== 'carregando' && (
              <button type="button" className="ia2-btn" onClick={()=>carregar(true)} title="Gera de novo com os números de agora">↻ Atualizar</button>
            )}
          </div>
        </div>
        {estado === 'carregando' && <div className="ia2-manchete ia2-carregando"><span className="ia-dot"/>Analisando os números do turno…</div>}
        {estado === 'erro' && <div className="ia2-manchete ia2-erro">Não foi possível gerar o resumo: {erro}</div>}
        {estado === 'ok' && resumo?.manchete && <p className="ia2-manchete">{resumo.manchete}</p>}
        {estado === 'ok' && resumo?.vazio && <p className="ia2-manchete">Ainda não há resumo deste turno.</p>}
      </div>

      {aberto && (
        <div className="ia2-corpo">
          {estado === 'carregando' && (
            <div className="ia2-grid">{[0,1,2].map(i => <div key={i} className="ia2-card ia2-skel"><span/><span/><span/></div>)}</div>
          )}
          {estado === 'ok' && blocos.length > 0 && (
            <div className="ia2-grid">
              {blocos.map((b, i) => {
                const a = AREAS[b.area] || { icone:'•', nome:b.area }, n = NIVEL[b.nivel] || NIVEL.ok
                const tab = ATALHO[b.area]
                return (
                  <article key={i} className={`ia2-card n-${b.nivel}`}>
                    <div className="ia2-card-h">
                      <span className="ia2-ico">{a.icone}</span>
                      <span className="ia2-area">{a.nome}</span>
                      <span className="ia2-nivel">{n.txt}</span>
                    </div>
                    <h4>{b.titulo}</h4>
                    <p>{b.texto}</p>
                    {tab && onGoTab && <button type="button" className="ia2-link" onClick={()=>onGoTab(tab.id)}>{tab.txt} →</button>}
                  </article>
                )
              })}
            </div>
          )}
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
  const [baseAberta, setBaseAberta] = useState(false)
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
        <span style={{display:'flex',gap:6}}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={()=>setBaseAberta(true)} title="O que a IA sabe sobre as compras da Yes">📚 Base de conhecimento</button>
          {conversa.length > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={()=>setConversa([])}>Limpar conversa</button>}
        </span>
      </div>
      {baseAberta && <BaseConhecimento token={token} onClose={()=>setBaseAberta(false)}/>}
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

// Editor da base de conhecimento: o que a IA sabe sobre as compras da Yes (regras,
// rotina, critérios). Vai junto em todo resumo e toda pergunta.
function BaseConhecimento({ token, onClose }) {
  const [texto, setTexto]   = useState('')
  const [padrao, setPadrao] = useState('')
  const [estado, setEstado] = useState('carregando')  // carregando | ok | salvando | salvo | erro
  const [erro, setErro]     = useState('')

  useEffect(() => {
    chamar({ tipo:'conhecimento' }, token)
      .then(r => { setTexto(r.texto); setPadrao(r.padrao); setEstado('ok') })
      .catch(e => { setErro(e.message); setEstado('erro') })
  }, [token])

  const salvar = async () => {
    setEstado('salvando')
    try { const r = await chamar({ tipo:'conhecimento', texto }, token); setTexto(r.texto); setEstado('salvo') }
    catch (e) { setErro(e.message); setEstado('erro') }
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:820,width:'94vw'}}>
        <div className="modal-header">
          <h2 className="modal-title">📚 Base de conhecimento da IA</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{padding:'12px 18px',display:'flex',flexDirection:'column',gap:10}}>
          <p style={{fontSize:12.5,color:'var(--ink-2)',margin:0}}>
            É o que a IA sabe sobre as compras da Yes: regras, sua rotina e critérios. Vai junto em todo resumo e toda pergunta.
            Escreva como explicaria para um comprador novo. Ao corrigir uma resposta errada da IA, acrescente a regra aqui.
          </p>
          {estado === 'carregando' && <div className="ia-load"><span className="ia-dot"/>Carregando…</div>}
          {estado === 'erro' && <div className="ia-erro">{erro}</div>}
          {estado !== 'carregando' && (
            <textarea value={texto} onChange={e=>{ setTexto(e.target.value); if (estado==='salvo') setEstado('ok') }}
              style={{width:'100%',minHeight:'55vh',fontFamily:'var(--mono)',fontSize:12,lineHeight:1.5,padding:10,border:'1px solid var(--line)',borderRadius:8,resize:'vertical'}}/>
          )}
          <div style={{display:'flex',gap:8,justifyContent:'space-between',alignItems:'center'}}>
            <button type="button" className="btn btn-sm btn-ghost" disabled={!padrao}
              onClick={()=>{ if (window.confirm('Voltar para o texto padrão? O que você escreveu será substituído.')) setTexto(padrao) }}>Restaurar padrão</button>
            <span style={{display:'flex',gap:8,alignItems:'center'}}>
              {estado === 'salvo' && <span style={{fontSize:12,color:'var(--ok-ink)'}}>✅ Salvo</span>}
              <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>Fechar</button>
              <button type="button" className="btn btn-sm btn-yellow" onClick={salvar} disabled={estado==='carregando'||estado==='salvando'}>
                {estado === 'salvando' ? 'Salvando…' : 'Salvar'}
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

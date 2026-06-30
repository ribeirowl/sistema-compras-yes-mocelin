import { useState, useCallback, useEffect, useRef } from 'react'
import { normStr } from '../utils.js'

const AI_KEY_LS = 'aiv_key'
const AI_GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models'
const AI_MODEL  = 'gemini-2.5-flash'

const AI_SYSTEM = `Você é o assistente de vendas interno da Yes! Mocelin, distribuidora Intelbras (filiais FB, DV, TO - Paraná). Usuário: vendedor interno. Tom: direto, colega de trabalho, sem enrolação.

ESCOPO: produto, disponibilidade, substituição de descontinuados. NÃO preço — preço é sempre "consulte no sistema".

FONTES:
- Os dados da base Yes Mocelin são injetados automaticamente na conversa com a tag [DADOS BASE YES MOCELIN].
- Site intelbras.com: só specs técnicas. Busque "(código) intelbras". Nunca use para preço ou estoque.
- Este assistente trabalha APENAS com produtos Intelbras. Se perguntarem sobre outra marca, diga que está fora do escopo.

BUSCA PRODUTO:
- Se vier [DADOS BASE YES MOCELIN] → use os dados injetados para responder.
- PRODUTO ATIVO → código, descrição, estoque por filial (FB/DV = BELTRAO, TO = TOLEDO). Sem preço.
- PRODUTO DESCONTINUADO → vai para SUBSTITUIÇÃO.
- NÃO ENCONTRADO → diz que não encontrou, pede mais detalhe. Nunca invente código.

SUBSTITUIÇÃO (descontinuado):
- Substituto Direto preenchido → confirma se ativo, apresenta como substituto oficial.
- Substituto Direto vazio → pesquisa intelbras.com para specs, identifica equivalente, apresenta como "sugestão técnica".
- Candidato não ativo → diz claramente, não force sugestão fraca.
- Nada → sugere escalar para compras.

REGRAS DURAS:
- Nunca invente código, prazo ou quantidade.
- Nunca cite/estime preço, de nenhuma fonte.
- Sempre disponibilidade por filial; se zerado mas com alternativa, ofereça transferência (avise que leva tempo).
- Fora do escopo (RH, outras marcas, financeiro, fechamento de pedido) → diga que não é sua área.

FORMATO: respostas curtas, sem markdown pesado. Lista só quando comparar produtos. Pergunta ambígua → pede 1 detalhe antes de adivinhar.`

function buildContext(text, rawItems, priceMap, discontinuedMap) {
  const codes = [...new Set((text.match(/\b\d{5,8}\b/g) || []))]
  if (!codes.length) return null

  const lines = []
  for (const code of codes) {
    const codeMap = new Map()
    for (const item of (rawItems || [])) {
      const ic = String(item.code || '').trim()
      if (ic === code) {
        if (!codeMap.has(ic)) codeMap.set(ic, { code: ic, desc: item.description || '', brand: item.brand || '', family: item.family || '', beltrao: 0, toledo: 0 })
        const g = codeMap.get(ic)
        if (item.cityGroup === 'BELTRAO') g.beltrao += (item.stock || 0)
        else if (item.cityGroup === 'TOLEDO') g.toledo += (item.stock || 0)
      }
    }
    const actives = [...codeMap.values()]
    const disc = discontinuedMap?.has(code) ? discontinuedMap.get(code) : null

    if (actives.length) {
      const p = actives[0]
      const pm = priceMap?.get(code) || {}
      lines.push(`PRODUTO ATIVO: ${code}`)
      lines.push(`Descrição: ${p.desc}`)
      if (p.brand || pm.brand) lines.push(`Marca: ${p.brand || pm.brand}`)
      if (p.family || pm.family) lines.push(`Família: ${p.family || pm.family}`)
      if (pm.ufOrigem) lines.push(`UF Origem: ${pm.ufOrigem}`)
      if (pm.multiple > 1) lines.push(`Qtd. Múltipla: ${pm.multiple}`)
      lines.push(`Estoque FB/DV (BELTRAO): ${p.beltrao} un`)
      lines.push(`Estoque TO (TOLEDO): ${p.toledo} un`)
    } else if (disc) {
      lines.push(`PRODUTO DESCONTINUADO: ${code}`)
      if (disc.description) lines.push(`Descrição: ${disc.description}`)
      if (disc.closedAt) lines.push(`Encerrado em: ${disc.closedAt}`)
      if (disc.substitute) {
        const subActive = (rawItems || []).some(i => String(i.code || '').trim() === disc.substitute)
        lines.push(`Substituto Direto: ${disc.substitute}${disc.substituteName ? ' - ' + disc.substituteName : ''}`)
        lines.push(`Substituto ativo na base: ${subActive ? 'SIM' : 'NÃO — consultar compras'}`)
        if (subActive) {
          const sg = new Map()
          for (const item of (rawItems || [])) {
            if (String(item.code || '').trim() === disc.substitute) {
              if (!sg.has(disc.substitute)) sg.set(disc.substitute, { beltrao: 0, toledo: 0 })
              const g = sg.get(disc.substitute)
              if (item.cityGroup === 'BELTRAO') g.beltrao += (item.stock || 0)
              else if (item.cityGroup === 'TOLEDO') g.toledo += (item.stock || 0)
            }
          }
          const ss = sg.get(disc.substitute)
          if (ss) {
            lines.push(`Estoque substituto FB/DV: ${ss.beltrao} un`)
            lines.push(`Estoque substituto TO: ${ss.toledo} un`)
          }
        }
      } else {
        lines.push(`Substituto Direto: não definido — verificar equivalente técnico`)
      }
    } else {
      lines.push(`NÃO ENCONTRADO: ${code} — não está na base de ativos nem em encerramentos`)
    }
    lines.push('')
  }
  return lines.join('\n').trim()
}

function mdToHtml(text) {
  if (!text) return ''
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inl = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
  return text.split('\n').map(l => {
    const t = l.trim()
    if (!t) return '<br/>'
    if (/^#{1,3}\s/.test(t)) return `<b>${inl(t.replace(/^#+\s/, ''))}</b><br/>`
    if (/^[-*]\s/.test(t)) return `<div style="margin:1px 0 1px 12px">• ${inl(t.slice(2))}</div>`
    return `<span>${inl(t)}</span><br/>`
  }).join('')
}

export default function AssistenteTab({ rawItems, priceMap, discontinuedMap }) {
  const [apiKey,    setApiKey]    = useState(() => localStorage.getItem(AI_KEY_LS) || '')
  const [keyInput,  setKeyInput]  = useState('')
  const [messages,  setMessages]  = useState([])
  const [input,     setInput]     = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef(null)
  const abortRef  = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming || !apiKey) return
    setInput('')

    const ctx = buildContext(text, rawItems, priceMap, discontinuedMap)
    const enriched = ctx ? `${text}\n\n[DADOS BASE YES MOCELIN]\n${ctx}` : text

    const userMsg = { role: 'user', content: text, id: Date.now() }
    setMessages(prev => [...prev, userMsg])

    const histForApi = [...messages, userMsg].map((m, idx, arr) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: (m.role === 'user' && idx === arr.length - 1) ? enriched : m.content }]
    }))

    setStreaming(true)
    const aId = Date.now() + 1
    setMessages(prev => [...prev, { role: 'assistant', content: '', id: aId, streaming: true }])

    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const res = await fetch(`${AI_GEMINI}/${AI_MODEL}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: AI_SYSTEM }] },
          contents: histForApi,
          tools: [{ google_search: {} }],
          generationConfig: { maxOutputTokens: 2048, temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } },
        })
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        const msg = e.error?.message || `HTTP ${res.status}`
        console.error('[Assistente] HTTP error:', res.status, msg)
        throw new Error(msg)
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = '', full = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop()
        for (const part of parts) {
          const line = part.replace(/^data:\s*/, '')
          if (!line || line === '[DONE]') continue
          try {
            const ev = JSON.parse(line)
            if (ev.error) { console.error('[Assistente] API error:', ev.error); continue }
            const parts = ev.candidates?.[0]?.content?.parts || []
            const chunk = parts.filter(p => !p.thought && p.text).map(p => p.text).join('')
            if (chunk) { full += chunk; setMessages(p => p.map(m => m.id === aId ? { ...m, content: full } : m)) }
          } catch (parseErr) { console.error('[Assistente] parse error:', parseErr) }
        }
      }
      setMessages(p => p.map(m => m.id === aId ? { ...m, streaming: false } : m))
    } catch (e) {
      if (e.name !== 'AbortError')
        setMessages(p => p.map(m => m.id === aId ? { ...m, content: `❌ Erro: ${e.message}`, streaming: false, error: true } : m))
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [input, streaming, apiKey, messages, rawItems, priceMap, discontinuedMap])

  const onKey = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }

  const saveKey = () => {
    const k = keyInput.trim()
    if (!k) return
    localStorage.setItem(AI_KEY_LS, k)
    setApiKey(k)
    setKeyInput('')
  }

  if (!apiKey) return (
    <div style={{ maxWidth: 480, margin: '60px auto', padding: 24 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 28 }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🤖</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Assistente IA — Yes Mocelin</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>
          Para ativar, você precisa de uma chave da API do Google AI Studio (gratuita).<br />
          Acesse <strong>aistudio.google.com</strong>, clique em <strong>Get API Key</strong> e cole aqui.
        </div>
        <input
          value={keyInput} onChange={e => setKeyInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && saveKey()}
          placeholder="Cole sua chave AIza..."
          style={{ width: '100%', padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 8, color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, marginBottom: 10 }} />
        <button onClick={saveKey}
          style={{ width: '100%', padding: 10, background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
          Ativar Assistente
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--topbar-h) - 1px)', background: 'var(--bg)' }}>
      <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)' }}>
        <span style={{ fontSize: 18 }}>🤖</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Assistente IA — Produtos Intelbras</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>Consulte disponibilidade, substitutos e specs. Preço: sempre no sistema.</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {streaming && <div style={{ fontSize: 10, color: 'var(--muted)' }}>⟳ respondendo...</div>}
          {messages.length > 0 && (
            <button onClick={() => setMessages([])}
              style={{ fontSize: 10, padding: '3px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--muted)', cursor: 'pointer' }}>
              limpar
            </button>
          )}
          <button onClick={() => { localStorage.removeItem(AI_KEY_LS); setApiKey('') }}
            style={{ fontSize: 10, padding: '3px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--muted)', cursor: 'pointer' }}>
            chave
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: 40, color: 'var(--muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🤖</div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>Pronto pra consultar</div>
            <div style={{ fontSize: 11, color: 'var(--muted2)' }}>Informe o código do produto ou descreva o que precisa</div>
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '80%', padding: '10px 14px',
              borderRadius: m.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              background: m.role === 'user' ? 'var(--accent)' : m.error ? 'var(--danger-bg)' : 'var(--card)',
              color: m.role === 'user' ? 'var(--bg)' : m.error ? 'var(--danger)' : 'var(--text)',
              border: m.role === 'user' ? 'none' : `1px solid ${m.error ? 'var(--danger)' : 'var(--border)'}`,
              fontSize: 13, lineHeight: 1.55,
            }}>
              {m.role === 'assistant'
                ? <span dangerouslySetInnerHTML={{ __html: mdToHtml(m.content) + (m.streaming ? '<span style="opacity:.4"> ▋</span>' : '') }} />
                : m.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', gap: 8 }}>
        <textarea
          ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey}
          placeholder="Código do produto ou pergunta... (Enter para enviar)"
          rows={1} disabled={streaming}
          style={{ flex: 1, padding: '10px 12px', background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 8, color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 13, resize: 'none', lineHeight: 1.5, minHeight: 40, maxHeight: 120, overflowY: 'auto' }}
          onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px' }} />
        <button onClick={send} disabled={streaming || !input.trim()}
          style={{ padding: '0 18px', background: streaming || !input.trim() ? 'var(--border)' : 'var(--accent)', color: streaming || !input.trim() ? 'var(--muted)' : 'var(--bg)', border: 'none', borderRadius: 8, fontWeight: 700, cursor: streaming || !input.trim() ? 'default' : 'pointer', fontSize: 13, transition: 'background .15s' }}>
          {streaming ? '...' : 'Enviar'}
        </button>
      </div>
    </div>
  )
}

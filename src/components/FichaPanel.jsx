import { useEffect, useState } from 'react'
import { FilePdf, DownloadSimple, ArrowSquareOut, X } from '@phosphor-icons/react'
import { useFichas, getFicha, abrirFicha } from '../fichas.js'

const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

// Botão pequeno para as linhas das tabelas — só aparece se o produto tem ficha ou manual
export function FichaButton({ item, compact = true }) {
  const fichas = useFichas()
  // Só Intelbras: código de outro fabricante pode coincidir com um código Intelbras
  const marca = String(item.brand || '').toUpperCase()
  const f = fichas && (!marca || marca.includes('INTELBRAS')) && getFicha(fichas, item.code)
  if (!f) return null
  return (
    <button className="btn btn-sm btn-ghost ficha-btn" title="Ficha técnica / manual"
      onClick={e => { e.stopPropagation(); abrirFicha(item) }}>
      <FilePdf size={16} weight="regular" />{!compact && <span>Ficha técnica</span>}
    </button>
  )
}

// Painel lateral que exibe o PDF dentro do sistema
export default function FichaPanel() {
  const fichas = useFichas()
  const [item, setItem] = useState(null)
  const [aba, setAba] = useState('ficha')

  useEffect(() => {
    const onOpen = e => { setItem(e.detail); setAba('ficha') }
    const onKey = e => { if (e.key === 'Escape') setItem(null) }
    window.addEventListener('abrir-ficha', onOpen)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('abrir-ficha', onOpen); window.removeEventListener('keydown', onKey) }
  }, [])

  if (!item) return null
  const f = fichas && getFicha(fichas, item.code)
  // Guia de compatibilidade genérico (não é o manual do produto): rótulo próprio para não confundir
  const isGuia = u => /compatibilidade|condominial|boas_pr/i.test(u || '')
  const tabs = f ? [['ficha', 'Ficha técnica', f.ficha], ['manual', isGuia(f.manual) ? 'Guia de compatibilidade' : 'Manual', f.manual]].filter(t => t[2]) : []
  const atual = tabs.find(t => t[0] === aba) || tabs[0]
  const url = atual?.[2]
  const nomeArq = `${item.code}_${slug(f?.modelo || item.description)}${atual?.[0] === 'manual' ? '_manual' : ''}.pdf`

  return (
    <div className="side-overlay" onClick={e => e.target === e.currentTarget && setItem(null)}>
      <div className="side-panel ficha-panel" role="dialog" aria-modal="true" aria-label="Ficha técnica">
        <div className="side-head">
          <FilePdf size={22} weight="regular" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="side-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {f?.modelo || item.description || item.code}
            </h2>
            <div className="side-item-meta" style={{ margin: 0 }}>{item.code}{item.description && f?.modelo ? ` · ${item.description}` : ''}</div>
          </div>
          {url && <>
            <a className="btn btn-sm btn-ghost" href={url} download={nomeArq} title="Baixar PDF"><DownloadSimple size={16} />Baixar</a>
            <a className="btn btn-sm btn-ghost" href={url} target="_blank" rel="noopener noreferrer" title="Abrir em nova aba"><ArrowSquareOut size={16} /></a>
          </>}
          <button className="side-close" onClick={() => setItem(null)} aria-label="Fechar"><X size={18} /></button>
        </div>
        {tabs.length > 1 && (
          <div className="ficha-tabs" role="tablist">
            {tabs.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={atual[0] === id}
                className={`ficha-tab${atual[0] === id ? ' active' : ''}`} onClick={() => setAba(id)}>{label}</button>
            ))}
          </div>
        )}
        <div className="ficha-body">
          {!fichas && <div className="ficha-empty">Carregando…</div>}
          {fichas && !url && <div className="ficha-empty">Não encontramos ficha técnica nem manual deste produto no site da Intelbras.</div>}
          {url && <iframe key={url} className="ficha-frame" src={`${url}#view=FitH`} title={`${atual[1]} ${item.code}`} />}
        </div>
      </div>
    </div>
  )
}

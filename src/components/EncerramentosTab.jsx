import { useState, useMemo } from 'react'
import { useDebounce, normStr } from '../utils.js'
import { Archive, CaretUp, CaretDown, Trash } from '@phosphor-icons/react'
import { todayStr } from '../utils.js'

// closedAt vem do parser como "DD/MM/AAAA" (toLocaleDateString pt-BR).
// Ordenar como texto daria errado, então converte para um número comparável.
const dataBR = s => {
  const m = String(s||'').match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? Number(`${m[3]}${m[2]}${m[1]}`) : null
}

const COLS = [
  { id:'code',           label:'Código',            sortable:true  },
  { id:'description',    label:'Descrição',         sortable:true  },
  { id:'substitute',     label:'Cód. Substituto',   sortable:true  },
  { id:'substituteName', label:'Info do Substituto', sortable:false },
  { id:'closedAt',       label:'Data Encerramento', sortable:true  },
]

const hojeBR = () => todayStr().split('-').reverse().join('/')

// Cadastro manual de substituição (ex.: aviso do executivo antes de sair na planilha da Intelbras)
function NovaSubstituicao({ subsManuais, onSaveSubs, userName, descricaoDe }) {
  const [code, setCode] = useState('')
  const [sub, setSub]   = useState('')
  const [info, setInfo] = useState('')
  const [erro, setErro] = useState('')
  const salvar = e => {
    e.preventDefault()
    const c = code.trim(), s = sub.trim()
    if (!/^\d{6,8}$/.test(c) || !/^\d{6,8}$/.test(s)) return setErro('Informe os dois códigos (6 a 8 dígitos).')
    if (c === s) return setErro('O substituto precisa ser outro código.')
    const nomeSub = descricaoDe(s)
    onSaveSubs({ ...subsManuais, [c]: {
      substitute: s,
      substituteName: info.trim() || (nomeSub ? `${s} - ${nomeSub}` : s),
      description: descricaoDe(c) || '',
      closedAt: hojeBR(),
      addedBy: userName || '',
    } })
    setCode(''); setSub(''); setInfo(''); setErro('')
  }
  return (
    <form onSubmit={salvar} className="filter-bar" style={{flexWrap:'wrap',gap:8,alignItems:'center'}}>
      <strong style={{fontSize:12}}>Cadastrar substituição:</strong>
      <input className="filter-search" style={{maxWidth:130}} placeholder="Código antigo" value={code} onChange={e=>setCode(e.target.value)} inputMode="numeric"/>
      <span style={{fontSize:12,color:'var(--ink-2)'}}>substituído por</span>
      <input className="filter-search" style={{maxWidth:130}} placeholder="Código novo" value={sub} onChange={e=>setSub(e.target.value)} inputMode="numeric"/>
      <input className="filter-search" style={{flex:1,minWidth:180}} placeholder="Observação (opcional)" value={info} onChange={e=>setInfo(e.target.value)}/>
      <button className="btn btn-yellow btn-sm" type="submit">Adicionar</button>
      {erro && <span style={{fontSize:12,color:'var(--danger)'}}>{erro}</span>}
    </form>
  )
}

export default function EncerramentosTab({ discontinuedMap, subsManuais = {}, onSaveSubs = null, userName = '', rawItems = [], priceMap }) {
  const [search, setSearch] = useState('')
  const dSearch = useDebounce(search, 250)
  // Data de encerramento começa da mais recente para a mais antiga
  const [sort, setSort] = useState({ col:'closedAt', dir:'desc' })

  const toggleSort = col => setSort(s =>
    s.col === col
      ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      // datas começam em desc (mais recente primeiro); texto começa em asc
      : { col, dir: col === 'closedAt' ? 'desc' : 'asc' }
  )

  const descricaoDe = code => discontinuedMap.get(code)?.description
    || priceMap?.get?.(code)?.description
    || rawItems.find(i => i.code === code)?.description || ''
  const remover = code => {
    if (!onSaveSubs || !window.confirm(`Remover a substituição manual do ${code}?`)) return
    const { [code]: _, ...resto } = subsManuais
    onSaveSubs(resto)
  }

  const items = useMemo(() => {
    const arr = []
    discontinuedMap.forEach((v, code) => arr.push({ code, ...v }))
    return arr
  }, [discontinuedMap])

  const filtered = useMemo(() => {
    if (!dSearch.trim()) return items
    const q = normStr(dSearch)
    return items.filter(i =>
      normStr(i.code).includes(q) ||
      normStr(i.description||'').includes(q) ||
      normStr(i.substitute||'').includes(q) ||
      normStr(i.substituteName||'').includes(q)
    )
  }, [items, dSearch])

  const sorted = useMemo(() => {
    const { col, dir } = sort
    const mult = dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (col === 'closedAt') {
        const va = dataBR(a.closedAt), vb = dataBR(b.closedAt)
        // itens sem data vão sempre para o fim, independente da direção
        if (va === null && vb === null) return a.code.localeCompare(b.code)
        if (va === null) return 1
        if (vb === null) return -1
        return va === vb ? a.code.localeCompare(b.code) : (va - vb) * mult
      }
      const va = String(a[col] ?? ''), vb = String(b[col] ?? '')
      // vazios por último
      if (!va && !vb) return a.code.localeCompare(b.code)
      if (!va) return 1
      if (!vb) return -1
      return va.localeCompare(vb, 'pt-BR') * mult
    })
  }, [filtered, sort])

  const semData = useMemo(() => filtered.filter(i => dataBR(i.closedAt) === null).length, [filtered])

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Encerramentos</h2>
          <p className="page-subtitle">Produtos fora de linha e descontinuados · {items.length} itens</p>
        </div>
      </div>

      {onSaveSubs && <NovaSubstituicao subsManuais={subsManuais} onSaveSubs={onSaveSubs} userName={userName} descricaoDe={descricaoDe}/>}

      <div className="filter-bar">
        <input className="filter-search" placeholder="Buscar código, descrição ou substituto..."
          value={search} onChange={e=>setSearch(e.target.value)}/>
        <span style={{fontSize:12,color:'var(--ink-2)'}}>
          {sorted.length} itens
          {semData>0 && <span style={{color:'var(--ink-3)'}}> · {semData} sem data</span>}
        </span>
      </div>

      {sorted.length===0
        ? (
          <div className="table-empty">
            <div className="table-empty-icon"><Archive size={30}/></div>
            <p>Nenhum item encerrado encontrado.</p>
          </div>
        )
        : (
          <div className="table-scroll" style={{overflowX:'auto'}}>
            <table className="product-table">
              <thead>
                <tr>
                  {COLS.map(c => {
                    const ativo = sort.col === c.id
                    return (
                      <th key={c.id}
                        onClick={c.sortable ? ()=>toggleSort(c.id) : undefined}
                        style={c.sortable ? {cursor:'pointer',userSelect:'none'} : undefined}
                        title={c.sortable ? 'Clique para ordenar' : undefined}>
                        <span style={{display:'inline-flex',alignItems:'center',gap:4}}>
                          {c.label}
                          {c.sortable && (
                            ativo
                              ? (sort.dir==='asc'
                                  ? <CaretUp size={12} weight="bold"/>
                                  : <CaretDown size={12} weight="bold"/>)
                              : <CaretDown size={12} style={{opacity:.25}}/>
                          )}
                        </span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map(item => (
                  <tr key={item.code} className="product-row">
                    <td className="mono" style={{whiteSpace:'nowrap'}}>
                      {item.code}
                      {item.manual && <span title={`Cadastrado à mão${item.addedBy?` por ${item.addedBy}`:''}`} style={{marginLeft:6,fontSize:10,padding:'1px 5px',borderRadius:4,background:'var(--info-bg, #e6f0fb)',color:'var(--info-ink)'}}>manual</span>}
                      {item.manual && onSaveSubs && <button className="btn btn-sm btn-ghost" style={{marginLeft:4,padding:'0 4px'}} title="Remover substituição manual" onClick={()=>remover(item.code)}><Trash size={13}/></button>}
                    </td>
                    <td title={item.description||''}>
                      <div className="col-desc-inner">{item.description||<span style={{color:'var(--ink-3)'}}>—</span>}</div>
                    </td>
                    <td className="mono" style={{color:item.substitute?'var(--info-ink)':'var(--ink-3)'}}>{item.substitute||'—'}</td>
                    <td style={{maxWidth:300,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:item.substituteName?'var(--ink)':'var(--ink-3)'}}
                      title={item.substituteName||''}>{item.substituteName||'—'}</td>
                    <td className="mono" style={{color:item.closedAt?'var(--ink-2)':'var(--ink-3)'}}>{item.closedAt||'—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  )
}

import { useState, useMemo } from 'react'
import { UF_DAYS } from '../constants.js'
import { normStr, fmtDate, addBizDays, parseLocalDate } from '../utils.js'

export default function PedidosTab({ purchaseHistory, productOverrides, rawItems, priceMap, purchaseRequests, availMap, orders }) {
  const [lojaFilter,   setLojaFilter]   = useState('TODOS')
  const [statusFilter, setStatusFilter] = useState('EM_TRANSITO')
  const [search,       setSearch]       = useState('')

  const items = useMemo(() => {
    const now = new Date()
    const seen = new Set()

    // 1. Carteira orders not yet received
    const fromCarteira = (orders||[])
      .filter(o => o.source === 'carteira' && !o.receivedAt)
      .map(o => {
        const key = `cart__${o.id}`
        seen.add(key)
        return {
          _key: key,
          code: o.code,
          description: o.description || o.code,
          brand: o.brand || '',
          cityGroup: o.cityGroup,
          qty: o.qty,
          purchaseDate: o.date,
          arrivalDate: o.arrivalDate || null,
          estimated: false,
          fromRequest: false,
          requestedBy: null,
          _source: 'carteira',
          pedidoParceiro: o.pedidoParceiro || '',
        }
      })

    // 2. History items with fromRequest (solicitações aprovadas)
    const fromHistory = (purchaseHistory||[])
      .filter(h => h.fromRequest)
      .map(h => {
        const price    = priceMap?.get(h.code)
        const ufOrigem = h.ufOrigem || price?.ufOrigem || ''
        const brand    = h.brand || price?.brand || ''
        let arrivalDate = null
        let estimated   = false
        if (h.arrivalDate) {
          arrivalDate = h.arrivalDate
        } else if (h.date) {
          let days = UF_DAYS[ufOrigem]
          if (!days) { const nb = normStr(brand); days = nb.includes('intelbras') ? UF_DAYS.SC : 10 }
          arrivalDate = addBizDays(h.date, days).toISOString().slice(0,10)
          estimated = true
        }
        const req = (purchaseRequests||[]).find(r => r.id === h.fromRequest)
        const key = `hist__${h.id}`
        return {
          _key: key,
          code: h.code,
          description: h.description || h.code,
          brand,
          cityGroup: h.cityGroup,
          qty: h.qty,
          purchaseDate: h.date,
          arrivalDate,
          estimated,
          fromRequest: true,
          requestedBy: req?.createdBy || null,
          _source: 'solicitacao',
          pedidoParceiro: '',
        }
      })

    // 3. Manual overrides (COMPRADO_COM_PREV / COMPRADO_SEM_PREV)
    const fromOverrides = Object.entries(productOverrides||{})
      .filter(([,v]) => v.status==='COMPRADO_COM_PREV'||v.status==='COMPRADO_SEM_PREV')
      .map(([key2, v]) => {
        const [code, cityGroup] = key2.split('__')
        const ri = rawItems.find(i=>i.code===code)||{}
        const key = `ov__${key2}`
        return {
          _key: key,
          code,
          description: ri.description||code,
          brand: ri.brand||'',
          cityGroup,
          qty: '—',
          purchaseDate: v.setAt ? v.setAt.slice(0,10) : '—',
          arrivalDate: v.arrivalDate||null,
          estimated: false,
          fromRequest: false,
          requestedBy: null,
          _source: 'manual',
          pedidoParceiro: '',
        }
      })

    let all = [...fromCarteira, ...fromHistory, ...fromOverrides]

    if (lojaFilter !== 'TODOS') all = all.filter(i => i.cityGroup === lojaFilter)
    if (statusFilter === 'EM_TRANSITO') all = all.filter(i => i.arrivalDate && parseLocalDate(i.arrivalDate) >= now)
    if (statusFilter === 'ATRASADO')    all = all.filter(i => i.arrivalDate && parseLocalDate(i.arrivalDate) < now)
    if (statusFilter === 'SEM_PREV')    all = all.filter(i => !i.arrivalDate)

    if (search) {
      const q = normStr(search)
      all = all.filter(i => normStr(i.code).includes(q) || normStr(i.description).includes(q))
    }

    return all.sort((a,b) => {
      const da = a.arrivalDate || '9999'
      const db = b.arrivalDate || '9999'
      return da.localeCompare(db)
    })
  }, [purchaseHistory, productOverrides, rawItems, orders, purchaseRequests, priceMap, lojaFilter, statusFilter, search, availMap])

  const lojas = useMemo(() => {
    const s = new Set([
      ...(orders||[]).filter(o=>o.source==='carteira'&&!o.receivedAt).map(o=>o.cityGroup),
      ...(purchaseHistory||[]).filter(h=>h.fromRequest).map(h=>h.cityGroup),
    ].filter(Boolean))
    return [...s].sort()
  }, [orders, purchaseHistory])

  const totalInTransit = useMemo(() => {
    const now = new Date()
    return items.filter(i => i.arrivalDate && parseLocalDate(i.arrivalDate) >= now).length
  }, [items])

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">🚚 Pedidos & Previsões</h2>
          <p className="page-subtitle">{items.length} pedido(s) · {totalInTransit} em trânsito</p>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <input className="filter-search" style={{minWidth:180}} placeholder="Buscar código ou descrição..." value={search} onChange={e=>setSearch(e.target.value)}/>
          <select className="filter-select" value={lojaFilter} onChange={e=>setLojaFilter(e.target.value)}>
            <option value="TODOS">Todas as lojas</option>
            {lojas.map(l=><option key={l} value={l}>{l==='BELTRAO'?'Beltrão':l==='TOLEDO'?'Toledo':l}</option>)}
          </select>
          <select className="filter-select" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
            <option value="TODOS">Todos</option>
            <option value="EM_TRANSITO">Em trânsito</option>
            <option value="ATRASADO">Atrasados</option>
            <option value="SEM_PREV">Sem previsão</option>
          </select>
        </div>
      </div>

      {items.length === 0
        ? <div className="table-empty"><div className="table-empty-icon">📭</div><p>Nenhum pedido encontrado.</p></div>
        : (
          <div className="table-scroll">
            <table className="product-table">
              <thead><tr>
                <th>Código</th>
                <th>Descrição</th>
                <th>Loja</th>
                <th className="num">Qtd</th>
                <th>Origem</th>
                <th>Solicitado por</th>
                <th>Previsão de Chegada</th>
              </tr></thead>
              <tbody>
                {items.map((item, idx) => {
                  const now = new Date()
                  const arrD = item.arrivalDate ? parseLocalDate(item.arrivalDate) : null
                  const daysTo = arrD ? Math.ceil((arrD - now) / 86400000) : null
                  const arrColor = daysTo === null ? 'var(--muted)'
                    : daysTo < 0  ? 'var(--danger)'
                    : daysTo < 7  ? 'var(--success)'
                    :                'var(--warning)'
                  return (
                    <tr key={item._key} style={{background:idx%2===0?'var(--card)':'var(--surface)'}}>
                      <td className="mono">{item.code}</td>
                      <td title={item.description} style={{maxWidth:260,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.description}</td>
                      <td><span className={`empresa-badge ${item.cityGroup==='BELTRAO'?'beltrao':item.cityGroup==='TOLEDO'?'toledo':'dv'}`}>{item.cityGroup==='BELTRAO'?'Beltrão':item.cityGroup==='TOLEDO'?'Toledo':'Dois Viz.'}</span></td>
                      <td className="num">{item.qty}</td>
                      <td>
                        {item._source === 'carteira'
                          ? <span style={{background:'var(--info-bg)',color:'var(--info)',fontSize:11,padding:'2px 7px',borderRadius:4,whiteSpace:'nowrap'}}>
                              🚚 Carteira{item.pedidoParceiro?` · ${item.pedidoParceiro}`:''}
                            </span>
                          : item._source === 'solicitacao'
                          ? <span style={{background:'var(--purple-bg)',color:'var(--purple)',fontSize:11,padding:'2px 7px',borderRadius:4,whiteSpace:'nowrap'}}>
                              📋 Solicitação
                            </span>
                          : <span style={{color:'var(--muted)',fontSize:11}}>Manual</span>
                        }
                      </td>
                      <td style={{fontSize:12,color:'var(--muted)'}}>{item.requestedBy || '—'}</td>
                      <td style={{color:arrColor,fontWeight:item.arrivalDate?600:400}}>
                        {item.arrivalDate
                          ? <>
                              {item.estimated && <span style={{color:'var(--muted)',fontSize:10,marginRight:3}} title="Estimativa por prazo de UF">~</span>}
                              {fmtDate(item.arrivalDate)}
                              {daysTo !== null && daysTo >= 0 && <span style={{fontSize:11,marginLeft:5,color:'var(--muted)'}}>({daysTo}d)</span>}
                              {daysTo !== null && daysTo < 0  && <span style={{fontSize:11,marginLeft:5,color:'var(--danger)'}}>atrasado</span>}
                            </>
                          : <span style={{color:'var(--muted)'}}>Sem previsão</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  )
}

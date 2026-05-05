import { useState, useMemo } from 'react'
import { UF_DAYS } from '../constants.js'
import { normStr, fmtDate, addBizDays } from '../utils.js'

export default function PedidosTab({ purchaseHistory, productOverrides, rawItems, priceMap, purchaseRequests, availMap }) {
  const [lojaFilter,   setLojaFilter]   = useState('TODOS')
  const [statusFilter, setStatusFilter] = useState('TODOS')
  const [search,       setSearch]       = useState('')

  const lojas = useMemo(() => {
    const s = new Set(purchaseHistory.map(h=>h.cityGroup).filter(Boolean))
    return [...s].sort()
  }, [purchaseHistory])

  const items = useMemo(() => {
    const now = new Date()
    const fromHistory = purchaseHistory
      .filter(h => Math.floor((now - new Date(h.date)) / 86400000) <= 90)
      .map(h => {
        const price    = priceMap?.get(h.code)
        const ufOrigem = h.ufOrigem || price?.ufOrigem || ''
        const brand    = h.brand || price?.brand || ''
        let arrivalDate = null
        let estimated   = false
        if (h.arrivalDate) {
          arrivalDate = h.arrivalDate
        } else if (h.date && (h.availType==='DISPONIVEL_IMEDIATO'||h.availType==='DISPONIVEL_MES'||(
            !h.availType && (() => { const av=availMap?.get(h.code); return !av||(av.origemImediato||av.origemMes) })())))  {
          let days = UF_DAYS[ufOrigem]
          if (!days) { const nb = normStr(brand); days = nb.includes('intelbras') ? UF_DAYS.SC : 10 }
          arrivalDate = addBizDays(h.date, days).toISOString().slice(0,10)
          estimated = true
        }
        const req = h.fromRequest ? (purchaseRequests||[]).find(r=>r.id===h.fromRequest) : null
        return {
          code: h.code, description: h.description||h.code, brand,
          cityGroup: h.cityGroup, qty: h.qty, pv: h.pv||0,
          purchaseDate: h.date, arrivalDate, estimated,
          availType: h.availType||'', ufOrigem, notes: h.notes||'',
          fromRequest: !!h.fromRequest, requestedBy: req?.createdBy||null,
        }
      })
    const fromOverrides = Object.entries(productOverrides||{})
      .filter(([,v]) => v.status==='COMPRADO_COM_PREV'||v.status==='COMPRADO_SEM_PREV')
      .map(([key, v]) => {
        const [code, cityGroup] = key.split('__')
        const ri = rawItems.find(i=>i.code===code)||{}
        return { code, description:ri.description||code, brand:ri.brand||'', cityGroup, qty:'—', pv:0,
          purchaseDate:v.setAt?v.setAt.slice(0,10):'—', arrivalDate:v.arrivalDate||null, availType:'override', notes:v.notes||'' }
      })
    const now2 = new Date()
    let all = [...fromHistory, ...fromOverrides]
    if (lojaFilter!=='TODOS') all = all.filter(i=>i.cityGroup===lojaFilter)
    if (statusFilter==='EM_TRANSITO') all = all.filter(i=>i.arrivalDate && new Date(i.arrivalDate) >= now2)
    if (statusFilter==='ATRASADO')    all = all.filter(i=>i.arrivalDate && new Date(i.arrivalDate) < now2)
    if (statusFilter==='SEM_PREV')    all = all.filter(i=>!i.arrivalDate)
    if (search) { const q=normStr(search); all=all.filter(i=>normStr(i.code).includes(q)||normStr(i.description).includes(q)) }
    return all.sort((a,b)=>(b.purchaseDate||'').localeCompare(a.purchaseDate||''))
  }, [purchaseHistory, productOverrides, rawItems, lojaFilter, statusFilter, search, availMap])

  const AVAIL_LABEL = { DISPONIVEL_IMEDIATO:'Imediato', DISPONIVEL_MES:'P/ Mês', SEM_DISPONIBILIDADE:'Sem disp.', override:'Manual' }
  const getAvailLabel = (item) => {
    if (item.availType && item.availType !== '') return AVAIL_LABEL[item.availType] || item.availType
    const av = availMap?.get(item.code)
    if (!av) return '—'
    const imediato = av.origemImediato
    const mes      = av.origemMes
    if (imediato === true)  return 'Imediato'
    if (mes === true)       return 'P/ Mês'
    if (imediato === false || mes === false) return 'Sem disp.'
    return '—'
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">🚚 Pedidos Realizados</h2>
          <p className="page-subtitle">{items.length} pedido(s) — últimos 90 dias</p>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <input className="filter-search" style={{minWidth:180}} placeholder="Buscar código..." value={search} onChange={e=>setSearch(e.target.value)}/>
          <select className="filter-select" value={lojaFilter} onChange={e=>setLojaFilter(e.target.value)}>
            <option value="TODOS">Todas as lojas</option>
            {lojas.map(l=><option key={l} value={l}>{l==='BELTRAO'?'Beltrão':l==='TOLEDO'?'Toledo':l}</option>)}
          </select>
          <select className="filter-select" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
            <option value="TODOS">Todos os status</option>
            <option value="EM_TRANSITO">Em trânsito</option>
            <option value="ATRASADO">Atrasados</option>
            <option value="SEM_PREV">Sem previsão</option>
          </select>
        </div>
      </div>
      {items.length===0
        ? <div className="table-empty"><div className="table-empty-icon">📭</div><p>Nenhum pedido nos últimos 90 dias.</p></div>
        : (
          <div className="table-scroll">
            <table className="product-table">
              <thead><tr>
                <th>Código</th>
                <th>Descrição</th>
                <th>Loja</th>
                <th className="num">Qtd</th>
                <th>Disponib.</th>
                <th>Origem</th>
                <th>Data</th>
                <th>Previsão Chegada</th>
              </tr></thead>
              <tbody>
                {items.map((item,idx) => {
                  const now = new Date()
                  const arrD = item.arrivalDate ? new Date(item.arrivalDate) : null
                  const daysTo = arrD ? Math.ceil((arrD - now) / 86400000) : null
                  const arrColor = daysTo===null ? 'var(--muted)'
                    : daysTo<0  ? 'var(--danger)'
                    : daysTo<7  ? 'var(--success)'
                    :              'var(--warning)'
                  return (
                    <tr key={item.code+item.cityGroup+idx} style={{background:idx%2===0?'var(--card)':'var(--surface)'}}>
                      <td className="mono">{item.code}</td>
                      <td title={item.description} style={{maxWidth:260,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.description}</td>
                      <td><span className={`empresa-badge ${item.cityGroup==='BELTRAO'?'beltrao':item.cityGroup==='TOLEDO'?'toledo':'dv'}`}>{item.cityGroup==='BELTRAO'?'Beltrão':item.cityGroup==='TOLEDO'?'Toledo':'Dois Viz.'}</span></td>
                      <td className="num">{item.qty}</td>
                      <td style={{fontSize:11,color:'var(--muted)'}}>{getAvailLabel(item)}</td>
                      <td>
                        {item.fromRequest
                          ? <span style={{background:'var(--purple-bg)',color:'var(--purple)',fontSize:11,padding:'2px 7px',borderRadius:4,whiteSpace:'nowrap'}}>
                              📋 {item.requestedBy||'Solicitação'}
                            </span>
                          : <span style={{color:'var(--muted)',fontSize:11}}>Compra direta</span>
                        }
                      </td>
                      <td>{fmtDate(item.purchaseDate)}</td>
                      <td style={{color:arrColor}}>
                        {item.arrivalDate
                          ? <>
                              {item.estimated&&<span style={{color:'var(--muted)',fontSize:10,marginRight:3}} title="Estimativa baseada no prazo por UF de origem">~</span>}
                              {fmtDate(item.arrivalDate)}
                              {daysTo!==null&&daysTo>=0&&<span style={{fontSize:11,marginLeft:4}}>({daysTo}d)</span>}
                              {daysTo!==null&&daysTo<0&&<span style={{fontSize:11,marginLeft:4,color:'var(--danger)'}}>atrasado</span>}
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

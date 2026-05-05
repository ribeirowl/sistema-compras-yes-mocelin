import { useState, useEffect, useCallback, useMemo } from 'react'
import { ROLE_CAPS, TABS_CFG, LOGO_KEY, SYNC_KEYS, UF_DAYS, HISTORY_KEY, ORDERS_KEY, REQUESTS_KEY, USERS_KEY, NOTIFS_KEY } from './constants.js'
import { fmtBRL, todayStr, addBizDays, normStr } from './utils.js'
import {
  sb, dbPull, dbRefresh,
  getRawItems, saveRawItems, getPriceMap, savePriceMap, getDiscMap, saveDiscMap,
  getHistory, saveHistory, getRequests, saveRequests, getOverrides, saveOverrides,
  getAvailMap, saveAvailMap, getOrders, saveOrders, getDataDate, saveDataDate,
  getUsers, saveUsers, getNotifs, saveNotifs,
} from './supabase.js'
import { loadSupabasePedidosForStatus } from './nf-logic.js'
import { readWb, parseStockReport, parsePriceTable } from './parsers.js'
import { applyRules } from './rules.js'
import LoginScreen from './components/LoginScreen.jsx'
import UploadPanel from './components/UploadPanel.jsx'
import Dashboard from './components/Dashboard.jsx'
import FilterBar from './components/FilterBar.jsx'
import ProductTable from './components/ProductTable.jsx'
import ExportModal from './components/ExportModal.jsx'
import PurchaseOrderModal from './components/PurchaseOrderModal.jsx'
import ProductSearchTab from './components/ProductSearchTab.jsx'
import DisponibilidadeTab from './components/DisponibilidadeTab.jsx'
import PedidosTab from './components/PedidosTab.jsx'
import SolicitacoesTab from './components/SolicitacoesTab.jsx'
import FinancialTab from './components/FinancialTab.jsx'
import EncerramentosTab from './components/EncerramentosTab.jsx'
import UsuariosTab from './components/UsuariosTab.jsx'
import ConfirmModal from './components/ConfirmModal.jsx'
import NotificationsPanel from './components/NotificationsPanel.jsx'

export default function App() {
  const [theme, setTheme] = useState(()=>localStorage.getItem('sc_theme')||'dark')
  useEffect(()=>{
    document.documentElement.classList.toggle('light', theme==='light')
    localStorage.setItem('sc_theme', theme)
  },[theme])
  const toggleTheme = () => setTheme(t => t==='dark'?'light':'dark')

  const [dbReady, setDbReady] = useState(false)

  const [role, setRole] = useState(()=>{
    try { const r=JSON.parse(localStorage.getItem('sc_remember')||'{}'); if(r.role){sessionStorage.setItem('sc_role',r.role);sessionStorage.setItem('sc_name',r.name);return r.role} } catch{}
    return sessionStorage.getItem('sc_role')||null
  })
  const [userName, setUserName] = useState(()=>{
    try { const r=JSON.parse(localStorage.getItem('sc_remember')||'{}'); if(r.name) return r.name } catch{}
    return sessionStorage.getItem('sc_name')||''
  })
  const caps = ROLE_CAPS[role] || ROLE_CAPS.SELLER

  const [rawItems,        setRawItems]        = useState([])
  const [priceMap,        setPriceMap]        = useState(new Map())
  const [discontinuedMap, setDiscontinuedMap] = useState(new Map())
  const [processed,       setProcessed]       = useState(false)
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState(null)
  const [showUploadPanel, setShowUploadPanel] = useState(false)

  const [purchaseHistory,  setPurchaseHistory]  = useState([])
  const [purchaseRequests, setPurchaseRequests] = useState([])
  const [productOverrides, setProductOverrides] = useState({})
  const [availMap,         setAvailMap]         = useState(new Map())
  const [orders,           setOrders]           = useState([])
  const [savedFeedback,    setSavedFeedback]    = useState(false)
  const [logo,             setLogo]             = useState(null)
  const [users,            setUsers]            = useState([])
  const [notifs,           setNotifs]           = useState([])
  const [showNotifPanel,   setShowNotifPanel]   = useState(false)
  const [confirmReset,     setConfirmReset]     = useState(false)
  const [syncError,        setSyncError]        = useState(false)

  useEffect(()=>{
    dbPull().then(ok => {
      if (!ok) setSyncError(true)
    }).finally(()=>{
      const ri = getRawItems()
      setRawItems(ri)
      setPriceMap(getPriceMap())
      setDiscontinuedMap(getDiscMap())
      setProcessed(ri.length>0)
      setPurchaseHistory(getHistory())
      setPurchaseRequests(getRequests())
      setProductOverrides(getOverrides())
      setAvailMap(getAvailMap())
      setOrders(getOrders())
      setUsers(getUsers())
      setNotifs(getNotifs())
      setLogo(localStorage.getItem(LOGO_KEY)||null)
      setDbReady(true)
      loadSupabasePedidosForStatus().catch(()=>{})
    })
  },[])

  useEffect(()=>{
    const onStorage = () => setLogo(localStorage.getItem(LOGO_KEY)||null)
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  },[])

  // Re-sync shared state from Supabase when user returns to the tab
  useEffect(()=>{
    const SHARED = [HISTORY_KEY, ORDERS_KEY, REQUESTS_KEY, USERS_KEY, NOTIFS_KEY]
    const onFocus = async () => {
      const changed = await dbRefresh(SHARED)
      if (changed[HISTORY_KEY])  setPurchaseHistory(()=>{ try{return JSON.parse(changed[HISTORY_KEY])}catch{return []} })
      if (changed[ORDERS_KEY])   setOrders(()=>{ try{return JSON.parse(changed[ORDERS_KEY])}catch{return []} })
      if (changed[REQUESTS_KEY]) setPurchaseRequests(()=>{ try{return JSON.parse(changed[REQUESTS_KEY])}catch{return []} })
      if (changed[USERS_KEY])    setUsers(()=>{ try{return JSON.parse(changed[USERS_KEY])}catch{return []} })
      if (changed[NOTIFS_KEY])   setNotifs(()=>{ try{return JSON.parse(changed[NOTIFS_KEY])}catch{return []} })
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  },[])

  const [activeTab,    setActiveTab]    = useState(()=>sessionStorage.getItem('sc_tab')||'dashboard')
  const [selections,   setSelections]   = useState({})
  const [filters,      setFilters]      = useState({search:'',priority:'',brand:'',onlySelected:false})
  const [sort,         setSort]         = useState({col:'priority',dir:'asc'})
  const [showExport,   setShowExport]   = useState(false)
  const [showOrder,    setShowOrder]    = useState(false)
  const [groupByBrand, setGroupByBrand] = useState(false)

  const handleLogin  = (r,n) => {
    setRole(r); setUserName(n)
    if (r==='SELLER' && getRawItems().length>0) setActiveTab('pesquisa')
  }
  const handleLogout = () => {
    sessionStorage.clear()
    window.location.href = '/'
  }

  const handleNewRequest = useCallback(req => {
    setPurchaseRequests(prev => {
      const reqs = [...prev, req]
      saveRequests(reqs)
      return reqs
    })
  }, [])

  const handleSaveOrder = useCallback((tabItemsArg, selectionsArg, activeTabArg, availMapArg, priceMapArg) => {
    const selected = tabItemsArg.filter(i => selectionsArg[i.id]?.selected)
    if (!selected.length) return
    try {
      const now = todayStr()
      const cityGroup = activeTabArg === 'TOLEDO' ? 'TOLEDO' : activeTabArg === 'BELTRAO' ? 'BELTRAO' : (selected[0]?.cityGroup||'BELTRAO')
      const newOrders = selected.map(item => {
        const av = availMapArg instanceof Map ? availMapArg.get(item.code) : undefined
        const availType = av?.origemImediato ? 'DISPONIVEL_IMEDIATO'
                        : av?.origemMes      ? 'DISPONIVEL_MES'
                        : 'SEM_DISPONIBILIDADE'
        const qty = selectionsArg[item.id]?.qty ?? item.adjustedQty
        const pv  = selectionsArg[item.id]?.pv ?? item.pv ?? 0
        return { id: Date.now().toString()+Math.random().toString(36).slice(2), code:item.code, description:item.description, brand:item.brand, cityGroup:item.cityGroup||cityGroup, qty, pv, date:now, availType, ufOrigem:item.ufOrigem||'' }
      })
      setOrders(prev => {
        const allOrders = [...prev, ...newOrders]
        saveOrders(allOrders)
        return allOrders
      })
      setPurchaseHistory(prev => {
        const allHistory = [...prev, ...newOrders.map(o=>({...o, enteredBy:'Gabriel Ribeiro'}))]
        saveHistory(allHistory)
        return allHistory
      })
      setSavedFeedback(true); setTimeout(()=>setSavedFeedback(false), 2500)
    } catch(e) {
      console.error('Erro ao salvar pedido:', e)
      alert('Erro ao salvar pedido: ' + e.message)
    }
  }, [])

  const handleReset = useCallback(async () => {
    try {
      await sb.from('app_data').delete().in('key', SYNC_KEYS)
      SYNC_KEYS.forEach(k => localStorage.removeItem(k))
      setRawItems([]); setPriceMap(new Map()); setDiscontinuedMap(new Map())
      setProcessed(false); setPurchaseHistory([]); setPurchaseRequests([])
      setProductOverrides({}); setAvailMap(new Map()); setOrders([])
      setSelections({}); setShowUploadPanel(false); setError(null)
      setConfirmReset(false)
    } catch(e) {
      setConfirmReset(false)
      alert('Erro ao resetar: ' + e.message)
    }
  }, [])

  const handleProcess = useCallback(async (stockFile, priceFile) => {
    setLoading(true); setError(null)
    try {
      let ri = getRawItems()
      let pm = getPriceMap()
      let dm = getDiscMap()

      if (stockFile) {
        const swb = await readWb(stockFile)
        ri = parseStockReport(swb)
        if (ri.length===0) throw new Error('Nenhum item encontrado. Verifique se é o Relatório de Sugestão de Compras correto.')
        saveRawItems(ri)
        saveDataDate(todayStr())
      }
      if (priceFile) {
        const pwb = await readWb(priceFile)
        const p = parsePriceTable(pwb)
        pm=p.priceMap; dm=p.discontinuedMap
        savePriceMap(pm, ri)
        saveDiscMap(dm)
      }
      if (!stockFile && !priceFile) throw new Error('Nenhum arquivo selecionado.')

      setRawItems(ri); setPriceMap(pm); setDiscontinuedMap(dm)

      const tabItems = applyRules(ri, pm, dm, getOrders())
      const allItems = [...tabItems.BELTRAO,...tabItems.TOLEDO,...tabItems.OUTROS,...tabItems.MANUAL,...tabItems.SEM_PRECO]
      const initSel  = {}
      allItems.forEach(i=>{
        initSel[i.id] = { selected: i.suggestion>0 && (i.priority==='ALTA'||i.priority==='MEDIA'), qty: Math.max(1,i.adjustedQty) }
      })
      setSelections(initSel)
      setProcessed(true); setShowUploadPanel(false)
      setActiveTab('dashboard')
      setFilters({search:'',priority:'',brand:'',onlySelected:false})
    } catch(err) { setError(err.message) }
    finally { setLoading(false) }
  }, [])

  const tabItems = useMemo(()=>
    processed ? applyRules(rawItems,priceMap,discontinuedMap,orders) : {BELTRAO:[],TOLEDO:[],OUTROS:[],MANUAL:[],SEM_PRECO:[]}
  ,[processed,rawItems,priceMap,discontinuedMap,orders])

  const allItems = useMemo(()=>
    [...tabItems.BELTRAO,...tabItems.TOLEDO,...tabItems.OUTROS,...tabItems.MANUAL,...tabItems.SEM_PRECO]
  ,[tabItems])

  const tabSummary = useMemo(()=>{
    const r={}
    for (const [tab,items] of Object.entries(tabItems)) {
      const selItems=items.filter(i=>selections[i.id]?.selected)
      r[tab]={
        total:       items.length,
        totalValue:  items.reduce((s,i)=>s+i.adjustedQty*i.pv,0),
        selectedValue:selItems.reduce((s,i)=>s+(selections[i.id]?.qty??i.adjustedQty)*(selections[i.id]?.pv??i.pv),0),
      }
    }
    return r
  },[tabItems,selections])

  const SPECIAL_TABS = ['dashboard','pesquisa','solicitacoes','financeiro','disponibilidade','pedidos','usuarios']
  const isSpecialTab = t => SPECIAL_TABS.includes(t)

  const pendingNotifs = useMemo(()=>{
    const today = todayStr()
    const sentIds = new Set((notifs||[]).map(n=>n.histId))
    return purchaseHistory
      .filter(h => {
        if (!h.fromRequest) return false
        if (sentIds.has(h.id)) return false
        let arr = h.arrivalDate
        if (!arr && h.date) {
          const ufOrigem = h.ufOrigem || ''
          const brand    = h.brand || ''
          let days = UF_DAYS[ufOrigem]
          if (!days) { const nb = normStr(brand); days = nb.includes('intelbras') ? UF_DAYS.SC : 10 }
          arr = addBizDays(h.date, days).toISOString().slice(0,10)
        }
        if (!arr || arr > today) return false
        const req  = (purchaseRequests||[]).find(r=>r.id===h.fromRequest)
        const name = req?.createdBy || null
        if (!name) return false
        const seller = (users||[]).find(u=>normStr(u.name)===normStr(name))
        return seller && seller.whatsapp
      })
      .map(h => {
        const req = (purchaseRequests||[]).find(r=>r.id===h.fromRequest)
        const seller = (users||[]).find(u=>normStr(u.name)===normStr(req?.createdBy||''))
        let arr = h.arrivalDate
        if (!arr && h.date) {
          const days = UF_DAYS[h.ufOrigem||''] || 10
          arr = addBizDays(h.date, days).toISOString().slice(0,10)
        }
        return { histId:h.id, code:h.code, description:h.description, qty:h.qty, arrivalDate:arr, sellerName:seller.name, whatsapp:seller.whatsapp }
      })
  },[purchaseHistory,purchaseRequests,users,notifs])

  const curTabItems = useMemo(()=>
    isSpecialTab(activeTab) ? [] : (tabItems[activeTab]||[])
  ,[activeTab,tabItems])

  const toggleSelect = useCallback(id=>setSelections(prev=>({...prev,[id]:{...prev[id],selected:!prev[id]?.selected}})),[])
  const setQty       = useCallback((id,qty)=>setSelections(prev=>({...prev,[id]:{...prev[id],qty:Math.max(0,qty)}})),[])
  const setPv        = useCallback((id,pv)=>setSelections(prev=>({...prev,[id]:{...prev[id],pv:Math.max(0,parseFloat(pv)||0)}})),[])
  const selectAll    = useCallback((ids,val)=>setSelections(prev=>{const n={...prev};ids.forEach(id=>{n[id]={...n[id],selected:val}});return n}),[])

  useEffect(()=>{ if(activeTab==='OUTROS') setGroupByBrand(true) },[activeTab])

  const tabBrands  = useMemo(()=>[...new Set(curTabItems.map(i=>i.brand).filter(Boolean))].sort(),[curTabItems])
  const selInTab   = useMemo(()=>curTabItems.filter(i=>selections[i.id]?.selected).length,[curTabItems,selections])
  const curTabCfg  = TABS_CFG.find(t=>t.id===activeTab)
  const pendingCnt = purchaseRequests.filter(r=>r.status==='PENDENTE').length

  if (!dbReady) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:'var(--bg)',flexDirection:'column',gap:16}}>
      <div style={{width:44,height:44,border:'4px solid var(--border)',borderTopColor:'var(--accent)',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
      <span style={{color:'var(--muted)',fontSize:14}}>Sincronizando dados...</span>
      {syncError && <span style={{color:'var(--warning)',fontSize:12,maxWidth:320,textAlign:'center'}}>⚠ Falha ao conectar com o servidor — usando dados locais</span>}
    </div>
  )

  if (!role) return <LoginScreen onLogin={handleLogin}/>

  const visibleTabs = TABS_CFG.filter(t=>t.roles.includes(role))

  const goTab = tab => {
    setActiveTab(tab)
    sessionStorage.setItem('sc_tab', tab)
    setFilters({search:'',priority:'',brand:'',onlySelected:false})
    setGroupByBrand(false)
    setShowExport(false)
    setShowOrder(false)
  }

  const renderContent = () => {
    if (!processed && role==='GABRIEL') {
      return <UploadPanel onProcess={handleProcess} loading={loading} error={error} dataDate={getDataDate()}/>
    }
    if (!processed) {
      return (
        <div className="table-empty" style={{marginTop:80}}>
          <div className="table-empty-icon">⏳</div>
          <p>Aguardando carregamento dos dados pelo administrador.</p>
          <p style={{marginTop:8,color:'var(--muted2)',fontSize:12}}>Peça ao Gabriel para carregar o relatório de estoque.</p>
        </div>
      )
    }
    if (showUploadPanel) {
      return <UploadPanel onProcess={handleProcess} loading={loading} error={error}
        onCancel={()=>{setShowUploadPanel(false);setError(null)}} dataDate={getDataDate()}/>
    }
    if (activeTab==='dashboard')
      return <Dashboard tabSummary={tabSummary} onGoTab={goTab} caps={caps} purchaseHistory={purchaseHistory} orders={orders}/>
    if (activeTab==='pesquisa')
      return <ProductSearchTab rawItems={rawItems} priceMap={priceMap} discontinuedMap={discontinuedMap}
        purchaseHistory={purchaseHistory} purchaseRequests={purchaseRequests}
        productOverrides={productOverrides} availMap={availMap} role={role} caps={caps}/>
    if (activeTab==='solicitacoes')
      return <SolicitacoesTab purchaseRequests={purchaseRequests}
        onUpdateRequests={reqs=>{setPurchaseRequests(reqs)}} caps={caps} role={role}
        purchaseHistory={purchaseHistory} onUpdateHistory={setPurchaseHistory} priceMap={priceMap} userName={userName} users={users}/>
    if (activeTab==='financeiro')
      return <FinancialTab purchaseHistory={purchaseHistory} onUpdateHistory={setPurchaseHistory}
        caps={caps} onDeleteOrder={updated=>setOrders(updated)} rawItems={rawItems} priceMap={priceMap} userName={userName}/>
    if (activeTab==='disponibilidade')
      return <DisponibilidadeTab rawItems={rawItems} priceMap={priceMap} discontinuedMap={discontinuedMap}
        purchaseHistory={purchaseHistory} purchaseRequests={purchaseRequests}
        productOverrides={productOverrides} onUpdateOverrides={setProductOverrides}
        availMap={availMap} onUpdateAvailMap={setAvailMap} onNewRequest={handleNewRequest} caps={caps}/>
    if (activeTab==='encerramentos')
      return <EncerramentosTab discontinuedMap={discontinuedMap}/>
    if (activeTab==='pedidos')
      return <PedidosTab purchaseHistory={purchaseHistory} productOverrides={productOverrides} rawItems={rawItems} priceMap={priceMap} purchaseRequests={purchaseRequests} availMap={availMap}/>
    if (activeTab==='usuarios')
      return <UsuariosTab users={users} onUpdateUsers={u=>{setUsers(u);saveUsers(u)}}/>
    return (
      <>
        <div className="page-header">
          <div>
            <h2 className="page-title">{curTabCfg?.icon} {curTabCfg?.label}</h2>
            <p className="page-subtitle">
              {tabSummary[activeTab]?.total??0} itens
              {caps.seePrices&&(tabSummary[activeTab]?.totalValue??0)>0&&` · ${fmtBRL(tabSummary[activeTab].totalValue)}`}
              {caps.seePrices&&(tabSummary[activeTab]?.selectedValue??0)>0&&` · Sel: ${fmtBRL(tabSummary[activeTab].selectedValue)}`}
            </p>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            {activeTab==='OUTROS'&&(
              <label className="filter-toggle">
                <input type="checkbox" checked={groupByBrand} onChange={e=>setGroupByBrand(e.target.checked)}/>
                <span>Por marca</span>
              </label>
            )}
            {selInTab>0&&activeTab!=='SEM_PRECO'&&caps.canExport&&(
              <>
                <button className="btn btn-secondary btn-sm" onClick={()=>setShowOrder(true)}>🖨️ Pedido</button>
                <button className="btn btn-yellow" onClick={()=>setShowExport(true)}>
                  Exportar ({selInTab})
                </button>
                <button
                  className={`btn btn-sm ${savedFeedback?'btn-success':'btn-secondary'}`}
                  onClick={()=>handleSaveOrder(curTabItems,selections,activeTab,availMap,priceMap)}
                  title="Salva o pedido no banco — desconta da sugestão de compra">
                  {savedFeedback?'✅ Salvo!':'💾 Salvar Pedido'}
                </button>
              </>
            )}
          </div>
        </div>
        <FilterBar filters={filters} sort={sort} brands={tabBrands}
          onFilterChange={setFilters} onSortChange={setSort}
          showBrandFilter={activeTab==='OUTROS'||activeTab==='MANUAL'||activeTab==='SEM_PRECO'}/>
        <ProductTable items={curTabItems} selections={selections}
          filters={filters} sort={sort}
          activeTab={activeTab} groupByBrand={groupByBrand&&activeTab==='OUTROS'}
          caps={caps}
          onToggleSelect={toggleSelect} onSetQty={setQty} onSetPv={setPv} onSelectAll={selectAll}/>
      </>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          {logo
            ? <img src={logo} alt="Logo" className="topbar-logo-img"/>
            : <div className="tb-badge">e</div>
          }
          <div className="topbar-names">
            <div className="topbar-title">Yes Mocelin</div>
            <div className="topbar-subtitle">Sistema de Compras</div>
          </div>
        </div>
        <div className="tb-sep"/>
        {processed&&!showUploadPanel&&<span className="topbar-info">{allItems.length} itens · {getDataDate()||'—'}</span>}
        <div className="tb-fill"/>
        <div className="topbar-actions">
          <span className="user-pill">{userName}<span className="topbar-role">{role}</span></span>
          {caps.canUpload&&processed&&!showUploadPanel&&(
            <button className="tbtn tbtn-gr" onClick={()=>{setShowUploadPanel(true);setError(null)}}>
              ↑ Dados
            </button>
          )}
          {caps.canUpload&&(
            <button className="tbtn tbtn-rd" onClick={()=>setConfirmReset(true)} title="Resetar todos os dados do sistema">
              ⚠ Reset
            </button>
          )}
          {caps.canApprove && (
            <button className="notif-bell" onClick={()=>setShowNotifPanel(true)} title="Notificações de chegada">
              🔔
              {pendingNotifs.length>0&&<span className="notif-badge">{pendingNotifs.length}</span>}
            </button>
          )}
          <button className="theme-toggle" onClick={toggleTheme} title="Alternar tema">
            {theme==='dark'?'☀':'🌙'}
          </button>
          <button className="tbtn tbtn-dim" onClick={handleLogout}>Sair</button>
        </div>
      </header>

      <div className="main-layout">
        {processed&&!showUploadPanel&&(
          <nav className="sidebar">
            {(()=>{
              const SECTIONS = [
                { key:'PRINCIPAL',   ids:['dashboard'] },
                { key:'SUGESTÕES',   ids:['BELTRAO','TOLEDO','OUTROS','MANUAL','SEM_PRECO'] },
                { key:'REVISÕES',    ids:['disponibilidade','encerramentos','pedidos','pesquisa'] },
                { key:'OPERACIONAL', ids:['solicitacoes','financeiro'] },
                { key:'ADMIN',       ids:['usuarios'] },
              ]
              const BADGE_CLS = { BELTRAO:'pu', TOLEDO:'bl', OUTROS:'bl', MANUAL:'or', SEM_PRECO:'rd', solicitacoes:'or', financeiro:'yw' }
              return SECTIONS.map(sec=>{
                const tabs = visibleTabs.filter(t=>sec.ids.includes(t.id))
                if (!tabs.length) return null
                return (
                  <div key={sec.key} className="sb-section">
                    <div className="sb-section-title">{sec.key}</div>
                    {tabs.map(tab=>{
                      const isSpec = isSpecialTab(tab.id)
                      const badge = tab.id==='solicitacoes' ? pendingCnt
                        : tab.id==='financeiro' ? purchaseHistory.length
                        : tab.id==='pedidos' ? purchaseHistory.filter(h=>Math.floor((Date.now()-new Date(h.date).getTime())/86400000)<=90).length
                        : isSpec||!tabSummary[tab.id] ? null
                        : (tabSummary[tab.id]?.total??0)
                      const sv = tabSummary[tab.id]?.selectedValue??0
                      const bCls = BADGE_CLS[tab.id]||''
                      return (
                        <button key={tab.id}
                          className={`sidebar-tab${activeTab===tab.id?' active':''}`}
                          onClick={()=>goTab(tab.id)}>
                          <span className="sidebar-tab-icon">{tab.icon}</span>
                          <span className="sidebar-tab-label">{tab.label}</span>
                          {badge!=null&&badge>0&&<span className={`sidebar-tab-badge${bCls?' '+bCls:''}`}>{badge}</span>}
                          {caps.seePrices&&sv>0&&!isSpec&&(
                            <span className="sidebar-tab-value">{fmtBRL(sv)}</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )
              })
            })()}
          </nav>
        )}

        <main className="content">
          {renderContent()}
        </main>
      </div>

      {showExport&&(
        <ExportModal items={curTabItems} selections={selections}
          tabLabel={curTabCfg?.label??''} activeTab={activeTab}
          cityGroup={activeTab==='BELTRAO'?'BELTRAO':activeTab==='TOLEDO'?'TOLEDO':null}
          caps={caps} onClose={()=>setShowExport(false)}/>
      )}
      {showOrder&&(
        <PurchaseOrderModal items={curTabItems} selections={selections}
          tabLabel={curTabCfg?.label??''} logo={logo}
          onClose={()=>setShowOrder(false)}/>
      )}
      {showNotifPanel&&(
        <NotificationsPanel
          pendingNotifs={pendingNotifs}
          onSent={histId=>{
            const n=[...notifs,{histId,sentAt:new Date().toISOString()}]
            setNotifs(n); saveNotifs(n)
          }}
          onClose={()=>setShowNotifPanel(false)}/>
      )}
      {confirmReset&&(
        <ConfirmModal
          title="Resetar todos os dados"
          message="Isso vai apagar TODOS os dados do sistema: pedidos, histórico, tabelas e disponibilidade. Essa ação não pode ser desfeita."
          confirmLabel="Sim, apagar tudo"
          confirmClass="btn-danger"
          onConfirm={handleReset}
          onCancel={()=>setConfirmReset(false)}/>
      )}
    </div>
  )
}

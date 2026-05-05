export const ROLE_CAPS = {
  GABRIEL: { seePrices:true,  seeFinancial:true,  canEdit:true,  canExport:true,  canRecord:true,  canApprove:true,  canUpload:true  },
  ADMIN:   { seePrices:true,  seeFinancial:true,  canEdit:false, canExport:false, canRecord:false, canApprove:false, canUpload:false },
  GERENCIA:{ seePrices:true,  seeFinancial:true,  canEdit:false, canExport:false, canRecord:false, canApprove:false, canUpload:false },
  SELLER:  { seePrices:false, seeFinancial:false, canEdit:false, canExport:false, canRecord:false, canApprove:false, canUpload:false },
}
export const UF_DAYS      = { SC:7, MG:9, AM:13 }
export const DAILY_LIMITS = { BELTRAO:35000, TOLEDO:20000 }

export const STATUS_CFG = {
  DISPONIVEL_IMEDIATO: { bg:'var(--success-bg)', txt:'var(--success)', label:'Disponível — Imediato' },
  DISPONIVEL_MES:      { bg:'var(--warning-bg)', txt:'var(--warning)', label:'Disponível em até 30 dias' },
  COMPRADO_COM_PREV:   { bg:'var(--info-bg)',     txt:'var(--info)',    label:'Comprado (em trânsito)' },
  COMPRADO_SEM_PREV:   { bg:'var(--warning-bg)', txt:'var(--warning)', label:'Comprado (sem previsão)' },
  COMPRADO_FATURADO:   { bg:'var(--info-bg)',     txt:'var(--info)',    label:'Comprado (Faturado)' },
  COMPRADO_AGUARD_FAT: { bg:'var(--warning-bg)', txt:'var(--warning)', label:'Comprado (Ag. Faturamento)' },
  SEM_ESTOQUE:         { bg:'var(--danger-bg)',   txt:'var(--danger)',  label:'Sem estoque no fornecedor' },
  AGUARDANDO_COMPRA:   { bg:'var(--purple-bg)',   txt:'var(--purple)',  label:'Aguardando compra' },
  ENCERRADO:           { bg:'var(--border2)',     txt:'var(--muted)',   label:'Fora de linha' },
  ENCERRADO_COM_SUB:   { bg:'var(--border2)',     txt:'var(--muted)',   label:'Encerrado — com substituto' },
  SEM_INFORMACAO:      { bg:'var(--card2)',       txt:'var(--muted2)',  label:'Sem informação' },
  CONSULTAR_COMPRAS:   { bg:'var(--warning-bg)', txt:'var(--warning)', label:'Consultar Compras' },
}

export const PRIORITY_ORDER  = { ALTA:0, MEDIA:1, NORMAL:2, BAIXA:3 }
export const PRIORITY_BG     = { ALTA:'var(--danger-bg)', MEDIA:'var(--warning-bg)', NORMAL:'var(--card)', BAIXA:'var(--card)' }
export const PRIORITY_COLORS = { ALTA:'var(--danger)', MEDIA:'var(--warning)', NORMAL:'var(--success)', BAIXA:'var(--muted)' }
export const PRIORITY_LABELS = { ALTA:'Alta', MEDIA:'Média', NORMAL:'Normal', BAIXA:'Baixa' }

export const HISTORY_KEY  = 'sc_purchase_history'
export const REQUESTS_KEY = 'sc_purchase_requests'
export const LOGO_KEY     = 'sc_logo_base64'
export const RAW_ITEMS_KEY= 'sc_raw_items'
export const PRICE_MAP_KEY= 'sc_price_map'
export const DISC_MAP_KEY = 'sc_disc_map'
export const OVERRIDES_KEY= 'sc_overrides'
export const DATA_DATE_KEY= 'sc_data_date'
export const AVAIL_MAP_KEY= 'sc_avail_map'
export const ORDERS_KEY   = 'sc_orders'
export const USERS_KEY    = 'sc_users'
export const NOTIFS_KEY   = 'sc_notifs'

export const TABS_CFG = [
  { id:'dashboard',       label:'Dashboard',      icon:'📊', color:'#FFD600', roles:['GABRIEL','ADMIN','GERENCIA'] },
  { id:'BELTRAO',         label:'Beltrão + DV',   icon:'🟣', color:'#9C8FFF', roles:['GABRIEL','ADMIN','GERENCIA'] },
  { id:'TOLEDO',          label:'Toledo',         icon:'🔵', color:'#4FC3F7', roles:['GABRIEL','ADMIN','GERENCIA'] },
  { id:'OUTROS',          label:'Outros Fornec.', icon:'📦', color:'#3DDC97', roles:['GABRIEL','ADMIN','GERENCIA'] },
  { id:'MANUAL',          label:'Análise Manual', icon:'⚠️', color:'#FFA726', roles:['GABRIEL','ADMIN','GERENCIA'] },
  { id:'SEM_PRECO',       label:'Sem Preço',      icon:'❗', color:'#FF4D4D', roles:['GABRIEL','ADMIN','GERENCIA'] },
  { id:'disponibilidade', label:'Disponibilidade',icon:'📋', color:'#3DDC97', roles:['GABRIEL','ADMIN','GERENCIA','SELLER'] },
  { id:'encerramentos',   label:'Encerramentos',  icon:'🚫', color:'#888888', roles:['GABRIEL','ADMIN','GERENCIA','SELLER'] },
  { id:'pedidos',         label:'Pedidos',        icon:'🚚', color:'#4FC3F7', roles:['SELLER'] },
  { id:'pesquisa',        label:'Pesquisa',       icon:'🔍', color:'#FFD600', roles:['GABRIEL','ADMIN','GERENCIA','SELLER'] },
  { id:'solicitacoes',    label:'Solicitações',   icon:'📋', color:'#FFA726', roles:['GABRIEL','ADMIN','GERENCIA','SELLER'] },
  { id:'financeiro',      label:'Financeiro',     icon:'💰', color:'#3DDC97', roles:['GABRIEL','ADMIN','GERENCIA'] },
  { id:'compras',         label:'Pedidos de Compra', icon:'🛒', color:'#FF8C42', roles:['GABRIEL','ADMIN','GERENCIA'] },
  { id:'nfe',             label:'Notas Fiscais',  icon:'📋', color:'#3DDC97', roles:['GABRIEL','ADMIN','GERENCIA'] },
  { id:'usuarios',        label:'Usuários',       icon:'👥', color:'#FF8C42', roles:['GABRIEL','ADMIN'] },
]

export const LOJAS = [
  { id:'fb', nome:'Francisco Beltrão', cnpj:'35.369.505/0001-02', cnpjRaw:'35369505000102' },
  { id:'tl', nome:'Toledo',            cnpj:'35.369.505/0003-74', cnpjRaw:'35369505000374' },
]
export const normCnpj  = c => (c||'').replace(/\D/g,'')
export const findLoja  = cnpj => LOJAS.find(l => l.cnpjRaw === normCnpj(cnpj))
export const lojaNome  = cnpj => findLoja(cnpj)?.nome || cnpj || '—'
export const toCents   = v => Math.round((parseFloat((v||0).toString().replace(',','.')) || 0) * 100)
export const fromCents = c => (parseInt(c)||0) / 100
export const fmtCents  = c => fromCents(c).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})

export const SYNC_KEYS = ['sc_purchase_history','sc_orders','sc_purchase_requests','sc_avail_map','sc_raw_items','sc_price_map','sc_disc_map','sc_overrides','sc_data_date','sc_logo_base64','sc_users','sc_notifs']

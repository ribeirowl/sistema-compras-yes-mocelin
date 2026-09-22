// Mapa central de ícones (Phosphor). Um único lugar para trocar/ajustar.
// Usar <TabIcon id="dashboard"/> ou importar os componentes direto.
import {
  SquaresFour, Storefront, Package, WarningCircle, CurrencyCircleDollar,
  ListChecks, Archive, Truck, MagnifyingGlass, ClipboardText, ArrowsLeftRight,
  Wallet, ChartBar, Users, Bell, SignOut, UploadSimple, CaretDown,
  Stack, Binoculars, ShoppingCart, CloudSlash,
} from '@phosphor-icons/react'

// id da aba (TABS_CFG) → ícone
export const TAB_ICONS = {
  dashboard:          SquaresFour,
  BELTRAO:            Storefront,
  TOLEDO:             Storefront,
  OUTROS:             Package,
  MANUAL:             WarningCircle,
  SEM_PRECO:          CurrencyCircleDollar,
  disponibilidade:    ListChecks,
  encerramentos:      Archive,
  pedidos:            Truck,
  pesquisa:           MagnifyingGlass,
  solicitacoes:       ClipboardText,
  transferencias:     ArrowsLeftRight,
  financeiro:         Wallet,
  'pedidos-intelbras':Truck,
  relatorios:         ChartBar,
  usuarios:           Users,
}

// chave do grupo da barra → ícone
export const GROUP_ICONS = {
  sugestoes: Stack,
  consultas: Binoculars,
  compras:   ShoppingCart,
}

export function TabIcon({ id, size = 17, weight = 'regular', ...rest }) {
  const Ico = TAB_ICONS[id]
  return Ico ? <Ico size={size} weight={weight} {...rest} /> : null
}

export function GroupIcon({ id, size = 17, weight = 'regular', ...rest }) {
  const Ico = GROUP_ICONS[id]
  return Ico ? <Ico size={size} weight={weight} {...rest} /> : null
}

export { Bell, SignOut, UploadSimple, CaretDown, MagnifyingGlass, WarningCircle, CloudSlash }

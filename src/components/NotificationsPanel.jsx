import { fmtDate } from '../utils.js'

export default function NotificationsPanel({ pendingNotifs, onSent, onClose }) {
  const buildWaLink = (n) => {
    const msg = `Olá ${n.sellerName}! Favor verificar se o item chegou às dependências:\n\n` +
      `📦 Código: ${n.code}\n` +
      `📝 Descrição: ${n.description}\n` +
      `🔢 Quantidade: ${n.qty} un.\n\n` +
      `Previsão de chegada era ${fmtDate(n.arrivalDate)}. Por favor confirme o recebimento.`
    const phone = '55' + n.whatsapp.replace(/\D/g,'')
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
  }

  const send = (n) => {
    window.open(buildWaLink(n), '_blank')
    onSent(n.histId)
  }

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:560}}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">🔔 Avisos de Chegada</h2>
            <p className="modal-sub">Pedidos com prazo vencido, aguardando confirmação</p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {pendingNotifs.length===0
            ? <div className="table-empty"><div className="table-empty-icon">✅</div><p>Nenhum aviso pendente.</p></div>
            : pendingNotifs.map(n=>(
              <div key={n.histId} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 0',borderBottom:'1px solid var(--border)'}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,marginBottom:2}}>{n.code} <span style={{fontWeight:400,color:'var(--muted)'}}>{(n.description||'').slice(0,40)}</span></div>
                  <div style={{fontSize:12,color:'var(--muted)'}}>
                    {n.qty} un. · Previsão: <span style={{color:'var(--danger)'}}>{fmtDate(n.arrivalDate)}</span> · Vendedor: <strong>{n.sellerName}</strong>
                  </div>
                </div>
                <button className="btn btn-sm" style={{background:'#25D366',color:'#fff',border:'none',whiteSpace:'nowrap'}}
                  onClick={()=>send(n)}>
                  📱 Enviar WA
                </button>
              </div>
            ))
          }
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'

const QLIK_CLIENT_ID = '' // Preencher quando receber da Intelbras
const QLIK_HOST      = 'https://bi-intelbras-parceiros.br.qlikcloud.com'
const QLIK_APP_ID    = 'b3d02243-054c-4c01-a2e6-e22af36ef153'
const QLIK_OBJECT_ID = 'NPvcDG'

export default function NotasIntelbrasTab() {
  const containerRef = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!QLIK_CLIENT_ID) return

    // Evita carregar o script duas vezes
    if (!document.getElementById('qlik-embed-script')) {
      const script = document.createElement('script')
      script.id             = 'qlik-embed-script'
      script.crossOrigin    = 'anonymous'
      script.type           = 'application/javascript'
      script.src            = 'https://cdn.jsdelivr.net/npm/@qlik/embed-web-components@1/dist/index.min.js'
      script.dataset.host        = QLIK_HOST
      script.dataset.clientId    = QLIK_CLIENT_ID
      script.dataset.redirectUri = `${window.location.origin}/oauth-callback.html`
      script.dataset.authType    = 'Oauth2'
      script.onload = () => setReady(true)
      document.head.appendChild(script)
    } else {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    if (!ready || !containerRef.current || !QLIK_CLIENT_ID) return
    const el = document.createElement('qlik-embed')
    el.setAttribute('ui',        'analytics/chart')
    el.setAttribute('app-id',    QLIK_APP_ID)
    el.setAttribute('object-id', QLIK_OBJECT_ID)
    el.setAttribute('theme',     'Sense Horizon')
    el.setAttribute('iframe',    'true')
    el.setAttribute('preview',   'true')
    containerRef.current.innerHTML = ''
    containerRef.current.appendChild(el)
    return () => { if (containerRef.current) containerRef.current.innerHTML = '' }
  }, [ready])

  if (!QLIK_CLIENT_ID) {
    return (
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div className="page-header">
          <div>
            <h2 className="page-title">📊 NF Intelbras</h2>
            <p className="page-subtitle">Notas faturadas disponibilizadas pela Intelbras</p>
          </div>
        </div>
        <div style={{background:'var(--warning-bg)',border:'1px solid var(--warning)',borderRadius:8,padding:24,maxWidth:560}}>
          <div style={{fontWeight:700,color:'var(--warning)',marginBottom:8}}>⚠ Configuração pendente</div>
          <p style={{fontSize:13,color:'var(--text)',margin:'0 0 12px'}}>
            Para ativar este painel, solicite à Intelbras o <strong>Client ID OAuth2</strong> do tenant Qlik Cloud
            (<code>bi-intelbras-parceiros.br.qlikcloud.com</code>).
          </p>
          <p style={{fontSize:12,color:'var(--muted)',margin:0}}>
            Após receber, informe ao administrador para preencher o campo <code>QLIK_CLIENT_ID</code>
            no arquivo <code>src/components/NotasIntelbrasTab.jsx</code>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
      <div className="page-header">
        <div>
          <h2 className="page-title">📊 NF Intelbras</h2>
          <p className="page-subtitle">Notas faturadas — Qlik Sense</p>
        </div>
      </div>
      <div style={{flex:1,minHeight:600,borderRadius:8,overflow:'hidden',border:'1px solid var(--border)',background:'var(--card)'}}>
        <div ref={containerRef} style={{width:'100%',height:'100%',minHeight:600}}/>
      </div>
    </div>
  )
}

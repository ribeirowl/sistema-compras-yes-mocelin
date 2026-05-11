import { useEffect, useRef } from 'react'

export default function NotasIntelbrasTab() {
  const containerRef = useRef(null)

  useEffect(() => {
    const el = document.createElement('qlik-embed')
    el.setAttribute('ui',        'analytics/chart')
    el.setAttribute('app-id',    'b3d02243-054c-4c01-a2e6-e22af36ef153')
    el.setAttribute('object-id', 'NPvcDG')
    el.setAttribute('theme',     'Sense Horizon')
    el.setAttribute('iframe',    'true')
    el.setAttribute('preview',   'true')
    containerRef.current.innerHTML = ''
    containerRef.current.appendChild(el)
    return () => { if (containerRef.current) containerRef.current.innerHTML = '' }
  }, [])

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
      <div className="page-header">
        <div>
          <h2 className="page-title">📊 Notas Faturadas — Intelbras</h2>
          <p className="page-subtitle">Painel de notas disponibilizado pela Intelbras via Qlik Sense</p>
        </div>
      </div>
      <div style={{flex:1,minHeight:600,borderRadius:8,overflow:'hidden',border:'1px solid var(--border)',background:'var(--card)'}}>
        <div ref={containerRef} style={{width:'100%',height:'100%',minHeight:600}}/>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { LOGO_KEY } from '../constants.js'
import { getUsers, dbPush, fetchLiveUsers } from '../supabase.js'

export default function LoginScreen({ onLogin }) {
  const [user,     setUser]     = useState(()=>{ try{return JSON.parse(localStorage.getItem('sc_remember')||'{}').username||''}catch{return ''} })
  const [pass,     setPass]     = useState('')
  const [err,      setErr ]     = useState('')
  const [remember, setRemember] = useState(()=>!!localStorage.getItem('sc_remember'))
  const [logo,     setLogo]     = useState(() => localStorage.getItem(LOGO_KEY)||null)

  const [loading, setLoading] = useState(false)

  const tryLogin = async () => {
    if (loading) return
    const uKey = user.trim().toLowerCase()
    setLoading(true)
    // Sempre tenta a lista mais recente do servidor; se não responder, usa a local.
    const live = await fetchLiveUsers()
    setLoading(false)
    const dynamicUsers = live || getUsers()
    const dynUser = dynamicUsers.find(u => u.active !== false && u.username === uKey)
    let role, name
    if (dynUser && dynUser.password === pass) {
      role = dynUser.role || 'SELLER'; name = dynUser.name
    } else {
      setErr('Usuário ou senha inválidos'); return
    }
    sessionStorage.setItem('sc_role', role)
    sessionStorage.setItem('sc_name', name)
    if (remember) localStorage.setItem('sc_remember', JSON.stringify({ username:uKey }))
    else localStorage.removeItem('sc_remember')
    onLogin(role, name)
  }

  const logoUpload = e => {
    const f = e.target.files[0]; if (!f) return
    const fr = new FileReader()
    fr.onload = ev => { const b = ev.target.result; localStorage.setItem(LOGO_KEY,b); dbPush(LOGO_KEY,b); setLogo(b) }
    fr.readAsDataURL(f)
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <span className="hc hc-tl"/><span className="hc hc-tr"/>
        <span className="hc hc-bl"/><span className="hc hc-br"/>

        {/* Logo / brand header */}
        <div className="login-logo-area">
          {logo
            ? <img src={logo} alt="Logo" className="login-logo-img"
                onClick={()=>document.getElementById('logo-up').click()}
                title="Clique para trocar o logo"/>
            : <div className="login-logo-placeholder" onClick={()=>document.getElementById('logo-up').click()}>
                <span>📷</span><span>Adicionar Logo</span>
              </div>
          }
          <input id="logo-up" type="file" accept="image/*" hidden onChange={logoUpload}/>
        </div>

        <h1 className="login-title">Bem-vindo</h1>
        <p className="login-sub">Sistema de Compras · Yes Mocelin</p>
        <p style={{fontSize:9,color:'rgba(245,194,0,0.4)',letterSpacing:'0.15em',marginBottom:4}}>v2.0</p>

        <div className="login-form">
          <div className="login-fg">
            <div className="login-fl-row">
              <span className="login-fl">USUÁRIO</span>
            </div>
            <input className="login-input" type="text" placeholder="seu usuário"
              value={user} onChange={e=>{setUser(e.target.value);setErr('')}}
              onKeyDown={e=>e.key==='Enter'&&tryLogin()}/>
          </div>
          <div className="login-fg">
            <div className="login-fl-row">
              <span className="login-fl">SENHA</span>
            </div>
            <input className="login-input" type="password" placeholder="••••••••"
              value={pass} onChange={e=>{setPass(e.target.value);setErr('')}}
              onKeyDown={e=>e.key==='Enter'&&tryLogin()}/>
          </div>
          {err && <div className="login-error">{err}</div>}
          <button className="login-btn" onClick={tryLogin} disabled={loading}>{loading?'ENTRANDO…':'ENTRAR'}</button>
        </div>

        <div className="login-footer">
          <div className="ndots">
            <span className="nd nd-g"/>
            <span className="nd nd-y"/>
            <span style={{marginLeft:3,fontSize:9,letterSpacing:'0.1em',color:'var(--muted2)'}}>ONLINE</span>
          </div>
          <label className="login-remember">
            <input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}
              style={{accentColor:'var(--accent)'}}/>
            LEMBRAR ACESSO
          </label>
        </div>
      </div>
    </div>
  )
}

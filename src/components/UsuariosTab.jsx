import { useState } from 'react'

export default function UsuariosTab({ users, onUpdateUsers }) {
  const EMPTY_USER = { id:'', username:'', password:'', name:'', whatsapp:'', role:'SELLER', active:true }
  const [form,    setForm]    = useState(null)
  const [errors,  setErrors]  = useState({})

  const openNew  = () => setForm({...EMPTY_USER})
  const openEdit = u  => setForm({...u})
  const closeForm= () => { setForm(null); setErrors({}) }

  const validate = () => {
    const e = {}
    if (!form.username.trim()) e.username = 'Obrigatório'
    if (!form.name.trim())     e.name     = 'Obrigatório'
    if (!form.id && !form.password.trim()) e.password = 'Obrigatório'
    if (form.whatsapp && !/^\d{10,11}$/.test(form.whatsapp.replace(/\D/g,''))) e.whatsapp = 'DDD + número (10 ou 11 dígitos)'
    const dup = users.find(u=>u.username===form.username.trim().toLowerCase()&&u.id!==form.id)
    if (dup) e.username = 'Usuário já existe'
    return e
  }

  const save = () => {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    const entry = {
      ...form,
      username:  form.username.trim().toLowerCase(),
      name:      form.name.trim(),
      password:  form.password || (users.find(u=>u.id===form.id)?.password||''),
      whatsapp:  form.whatsapp.replace(/\D/g,''),
      id:        form.id || (Date.now().toString()+Math.random().toString(36).slice(2)),
    }
    const updated = form.id
      ? users.map(u=>u.id===form.id?entry:u)
      : [...users, entry]
    onUpdateUsers(updated)
    closeForm()
  }

  const toggle = id => {
    const updated = users.map(u=>u.id===id?{...u,active:!u.active}:u)
    onUpdateUsers(updated)
  }

  const del = id => {
    if (!window.confirm('Excluir este usuário?')) return
    onUpdateUsers(users.filter(u=>u.id!==id))
  }

  const fld = (key,label,type='text',placeholder='') => (
    <div className="form-field">
      <label>{label}{key!=='whatsapp'&&key!=='password'&&<span style={{color:'var(--danger)'}}> *</span>}</label>
      <input className={`login-input${errors[key]?' input-error':''}`} type={type}
        value={form[key]||''} placeholder={placeholder||label}
        onChange={e=>{ setForm(p=>({...p,[key]:e.target.value})); setErrors(p=>({...p,[key]:''})) }}/>
      {errors[key]&&<span className="field-error">{errors[key]}</span>}
    </div>
  )

  return (
    <div style={{padding:24}}>
      <div className="page-header">
        <div>
          <h2 className="page-title">👥 Usuários</h2>
          <p className="page-subtitle">{users.length} cadastrado(s)</p>
        </div>
        <button className="btn btn-yellow" onClick={openNew}>+ Novo Vendedor</button>
      </div>

      {users.length===0
        ? <div className="table-empty"><div className="table-empty-icon">👤</div><p>Nenhum vendedor cadastrado.</p></div>
        : (
          <div className="table-scroll">
            <table className="product-table">
              <thead><tr>
                <th>Nome</th><th>Usuário</th><th>WhatsApp</th><th>Cargo</th><th>Ativo</th><th>Ações</th>
              </tr></thead>
              <tbody>
                {users.map((u,idx)=>(
                  <tr key={u.id} style={{background:idx%2===0?'var(--card)':'var(--surface)',opacity:u.active===false?.5:1}}>
                    <td><strong>{u.name}</strong></td>
                    <td className="mono">{u.username}</td>
                    <td>{u.whatsapp?`(${u.whatsapp.slice(0,2)}) ${u.whatsapp.slice(2)}`:'—'}</td>
                    <td>{{SELLER:'Vendedor',GERENCIA:'Gerência',GABRIEL:'Gabriel',ADMIN:'Admin'}[u.role]||u.role}</td>
                    <td>
                      <label style={{cursor:'pointer'}}>
                        <input type="checkbox" checked={u.active!==false} onChange={()=>toggle(u.id)}/>
                      </label>
                    </td>
                    <td>
                      <div style={{display:'flex',gap:4}}>
                        <button className="btn btn-sm btn-ghost" onClick={()=>openEdit(u)}>✏️ Editar</button>
                        <button className="btn btn-sm" style={{background:'var(--danger-bg)',color:'var(--danger)',border:'1px solid var(--danger)'}} onClick={()=>del(u.id)}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }

      {form && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&closeForm()}>
          <div className="modal">
            <div className="modal-header">
              <div><h2 className="modal-title">{form.id?'Editar Vendedor':'Novo Vendedor'}</h2></div>
              <button className="modal-close" onClick={closeForm}>✕</button>
            </div>
            <div className="modal-body">
              {fld('name',      'Nome completo')}
              {fld('username',  'Usuário (login)', 'text', 'minúsculo, sem espaço')}
              {fld('password',  form.id?'Nova senha (deixe em branco para manter)':'Senha','password')}
              {fld('whatsapp',  'WhatsApp (DDD + número)', 'text', '44999998888')}
              <div className="form-field">
                <label>Cargo</label>
                <select className="filter-select" style={{width:'100%'}} value={form.role}
                  onChange={e=>setForm(p=>({...p,role:e.target.value}))}>
                  <option value="SELLER">Vendedor</option>
                  <option value="GERENCIA">Gerência</option>
                  <option value="GABRIEL">Gabriel</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-yellow" onClick={save}>Salvar</button>
              <button className="btn btn-ghost" onClick={closeForm}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { Component } from 'react'

// Evita tela preta: captura erros de renderização e mostra a mensagem em vez de derrubar o app.
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('[ErrorBoundary]', error, info) }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }) }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: 'var(--text)' }}>
          <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', borderRadius: 8, padding: 16 }}>
            <h3 style={{ color: 'var(--danger)', marginTop: 0 }}>⚠ Erro ao renderizar esta tela</h3>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--muted)' }}>
              {String(this.state.error?.message || this.state.error)}
            </pre>
            <button className="btn btn-yellow" onClick={() => this.setState({ error: null })}>Tentar novamente</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

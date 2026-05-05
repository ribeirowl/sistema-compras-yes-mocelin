import { useState, useRef } from 'react'

export default function UploadPanel({ onProcess, loading, error, onCancel, dataDate }) {
  const [stockFile, setStockFile] = useState(null)
  const [priceFile, setPriceFile] = useState(null)
  const isUpdate = !!onCancel
  const canProcess = isUpdate ? (stockFile || priceFile) : stockFile

  const btnLabel = () => {
    if (loading) return <><span className="spinner"/>Processando...</>
    if (isUpdate) {
      if (stockFile && priceFile) return '▶ Atualizar Ambos'
      if (stockFile) return '▶ Atualizar Estoque'
      if (priceFile) return '▶ Atualizar Tabela de Preços'
    }
    return '▶ Processar e Salvar'
  }

  return (
    <div className="upload-page">
      <div className="upload-hero">
        <div className="upload-hero-icon">📊</div>
        <h2 className="upload-hero-title">{isUpdate ? 'Atualizar Dados' : 'Carregar Arquivos'}</h2>
        <p className="upload-hero-sub">
          {isUpdate
            ? `Última atualização: ${dataDate||'nunca'}. Suba um ou ambos os arquivos para atualizar.`
            : 'Faça upload do Relatório de Estoque e opcionalmente da Tabela de Preços para gerar as sugestões de compra.'}
        </p>
      </div>
      <div className="upload-grid">
        <DropZone label="Relatório de Estoque (Sugestão de Compras)" required={!isUpdate} file={stockFile} onChange={setStockFile}/>
        <DropZone label="Tabela de Preços Intelbras (aba Tabelas + Encerramentos)" file={priceFile} onChange={setPriceFile}/>
      </div>
      {error && <div className="upload-error">⚠️ {error}</div>}
      <div className="upload-actions" style={{display:'flex',gap:8,justifyContent:'center'}}>
        <button className="btn btn-yellow btn-lg" disabled={!canProcess||loading}
          onClick={()=>onProcess(stockFile,priceFile)}>
          {btnLabel()}
        </button>
        {onCancel && <button className="btn btn-ghost btn-lg" onClick={onCancel}>Cancelar</button>}
      </div>
    </div>
  )
}

export function DropZone({ label, required, file, onChange }) {
  const [drag, setDrag] = useState(false)
  const ref = useRef()
  return (
    <div className={`dropzone${file?' has-file':''}${drag?' dragging':''}`}
      onClick={()=>ref.current.click()}
      onDragOver={e=>{e.preventDefault();setDrag(true)}}
      onDragLeave={()=>setDrag(false)}
      onDrop={e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];if(f)onChange(f)}}>
      <input ref={ref} type="file" accept=".xls,.xlsx,.csv" hidden onChange={e=>onChange(e.target.files[0])}/>
      {file
        ? <div className="dropzone-file">
            <span>✅</span>
            <span className="dropzone-filename">{file.name}</span>
            <button className="dropzone-clear" onClick={e=>{e.stopPropagation();onChange(null)}}>✕</button>
          </div>
        : <>
            <span className="dropzone-icon">📁</span>
            <span className="dropzone-label">{label}{required&&<span className="required">*</span>}</span>
            <span className="dropzone-hint">Arraste ou clique<br/>.xlsx · .xls · .csv</span>
          </>
      }
    </div>
  )
}

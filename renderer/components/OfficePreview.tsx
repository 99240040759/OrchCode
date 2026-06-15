import React, { useState, useEffect, useRef } from 'react'

import { renderAsync } from 'docx-preview'

import { PptxRenderer } from 'pptx-browser'
import * as XLSX from 'xlsx'
import { Loader } from 'lucide-react'

interface OfficePreviewProps {
  displayFile: {
    name: string
    path: string
    base64?: string
  }
}

const base64ToBuffer = (base64Str: string): ArrayBuffer => {
  const binaryString = window.atob(base64Str)
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

const DocxPreview: React.FC<{ name: string; base64: string }> = ({ base64 }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!containerRef.current || !base64) return
    let active = true
    setLoading(true)
    setError(null)
    try {
      const buffer = base64ToBuffer(base64)
      renderAsync(buffer, containerRef.current, {
        className: 'docx-preview',
        inWrapper: false,
        ignoreWidth: true,
        ignoreHeight: true,
        useBase64URL: true
      } as any)
      .then(() => { if (active) setLoading(false) })
      .catch((err: any) => { if (active) { setError(err.message || String(err)); setLoading(false) } })
    } catch (err: any) {
      setError(err.message || String(err))
      setLoading(false)
    }
    return () => { active = false }
  }, [base64])

  return (
    <div className="office-preview-wrapper docx-view-wrapper">
      {loading && <div className="office-loading-spinner"><Loader className="animate-spin" size={20} /><span>Rendering Document...</span></div>}
      {error && <div className="office-error-message">Failed to load DOCX: {error}</div>}
      <div ref={containerRef} className={`docx-render-container ${loading || error ? 'docx-hidden' : ''}`} />
    </div>
  )
}

const XlsxPreview: React.FC<{ name: string; base64: string }> = ({ base64 }) => {
  const [sheets, setSheets] = useState<Array<{ name: string; grid: any[][] }>>([])
  const [activeSheetIdx, setActiveSheetIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setError(null)
    try {
      const buffer = base64ToBuffer(base64)
      const workbook = XLSX.read(buffer, { type: 'array' })
      const parsedSheets = workbook.SheetNames.map((sheetName) => {
        const worksheet = workbook.Sheets[sheetName]
        const grid = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: '' })
        return { name: sheetName, grid }
      })
      setSheets(parsedSheets)
      setActiveSheetIdx(0)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || String(err))
      setLoading(false)
    }
  }, [base64])

  if (loading) return <div className="office-loading-spinner"><Loader className="animate-spin" size={20} /><span>Loading Spreadsheet...</span></div>
  if (error) return <div className="office-error-message">Failed to load XLSX: {error}</div>
  if (sheets.length === 0) return <div className="office-error-message">No sheets found in workbook</div>

  const activeSheet = sheets[activeSheetIdx]
  const grid = activeSheet?.grid || []

  const getColLetter = (index: number) => {
    let temp = index
    let letter = ''
    while (temp >= 0) {
      letter = String.fromCharCode((temp % 26) + 65) + letter
      temp = Math.floor(temp / 26) - 1
    }
    return letter
  }

  const maxCols = grid.reduce((max, row) => Math.max(max, row.length), 0)
  const colsCount = Math.max(maxCols, 12)
  const rowsCount = Math.max(grid.length, 25)

  return (
    <div className="office-preview-wrapper xlsx-view-wrapper">
      <div className="xlsx-tabs-bar">
        {sheets.map((s, idx) => (
          <button key={idx} className={`xlsx-tab-btn ${idx === activeSheetIdx ? 'active' : ''}`} onClick={() => setActiveSheetIdx(idx)}>{s.name}</button>
        ))}
      </div>
      <div className="xlsx-table-container">
        <table className="xlsx-table-grid">
          <thead>
            <tr>
              <th className="xlsx-row-index-header"></th>
              {Array.from({ length: colsCount }).map((_, cIdx) => (
                <th key={cIdx} className="xlsx-col-header">{getColLetter(cIdx)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowsCount }).map((_, rIdx) => {
              const rowData = grid[rIdx] || []
              return (
                <tr key={rIdx}>
                  <td className="xlsx-row-index-cell">{rIdx + 1}</td>
                  {Array.from({ length: colsCount }).map((_, cIdx) => {
                    const val = rowData[cIdx]
                    return <td key={cIdx} className="xlsx-grid-cell">{val !== undefined ? String(val) : ''}</td>
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const PptxPreview: React.FC<{ name: string; base64: string }> = ({ name, base64 }) => {
  const [renderer, setRenderer] = useState<any>(null)
  const [slideCount, setSlideCount] = useState(0)
  const [activeSlide, setActiveSlide] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    const r = new PptxRenderer()
    try {
      const buffer = base64ToBuffer(base64)
      const file = new File([buffer], name, { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
      r.load(file)
        .then(() => {
          if (!active) return
          setRenderer(r)
          setSlideCount(r.slideCount)
          setActiveSlide(0)
          setLoading(false)
        })
        .catch((err: any) => { if (active) { setError(err.message || String(err)); setLoading(false) } })
    } catch (err: any) {
      setError(err.message || String(err))
      setLoading(false)
    }
    return () => { active = false; r.destroy() }
  }, [base64, name])

  useEffect(() => {
    if (!renderer || !canvasRef.current || slideCount === 0) return
    renderer.renderSlide(activeSlide, canvasRef.current, 1024).catch((err: any) => console.error('Failed to render slide:', err))
  }, [renderer, activeSlide, slideCount])

  if (loading) return <div className="office-loading-spinner"><Loader className="animate-spin" size={20} /><span>Loading Presentation...</span></div>
  if (error) return <div className="office-error-message">Failed to load PPTX: {error}</div>
  if (slideCount === 0) return <div className="office-error-message">No slides found in presentation</div>

  return (
    <div className="office-preview-wrapper pptx-view-wrapper">
      <div className="pptx-slide-container">
        <canvas ref={canvasRef} className="pptx-slide-canvas" />
      </div>
      <div className="pptx-carousel-bottom">
        <div className="pptx-carousel-list">
          {Array.from({ length: slideCount }).map((_, idx) => (
            <button key={idx} className={`pptx-carousel-btn ${idx === activeSlide ? 'active' : ''}`} onClick={() => setActiveSlide(idx)}>
              <div className="pptx-carousel-thumb-index">{idx + 1}</div>
              <div className="pptx-carousel-thumb-label">Slide {idx + 1}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const PdfPreview: React.FC<{ name: string; base64: string }> = ({ name, base64 }) => {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!base64) return
    const buffer = base64ToBuffer(base64)
    const blob = new Blob([buffer], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    setPdfUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [base64])

  if (!pdfUrl) return <div className="office-loading-spinner"><Loader className="animate-spin" size={20} /><span>Preparing PDF...</span></div>
  return (
    <div className="office-preview-wrapper pdf-view-wrapper">
      <iframe src={pdfUrl} className="pdf-view-iframe" title={name} />
    </div>
  )
}

export const OfficePreview: React.FC<OfficePreviewProps> = ({ displayFile }) => {
  const { name, base64 } = displayFile
  if (!base64) return <div className="office-error-message">No file content available</div>
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'docx') return <DocxPreview name={name} base64={base64} />
  if (ext === 'xlsx') return <XlsxPreview name={name} base64={base64} />
  if (ext === 'pptx') return <PptxPreview name={name} base64={base64} />
  if (ext === 'pdf') return <PdfPreview name={name} base64={base64} />
  return <div className="office-error-message">Unsupported office file format: .{ext}</div>
}

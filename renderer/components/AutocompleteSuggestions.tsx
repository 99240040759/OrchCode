import React from 'react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'

interface AutocompleteSuggestionsProps {
  showFileSuggestions: boolean
  filteredFiles: string[]
  suggestionIndex: number
  setSuggestionIndex: (idx: number) => void
  selectFileSuggestion: (file: string) => void
}

const AutocompleteSuggestions: React.FC<AutocompleteSuggestionsProps> = ({ showFileSuggestions, filteredFiles, suggestionIndex, setSuggestionIndex, selectFileSuggestion }) => {
  if (!showFileSuggestions || filteredFiles.length === 0) return null
  return (
    <div className="input-file-suggestions">
      {filteredFiles.map((file, idx) => {
        const isSelected = idx === suggestionIndex
        const parts = file.split('/')
        const name = parts[parts.length - 1]
        const dir = parts.slice(0, -1).join('/')
        return (
          <div key={file} onClick={() => selectFileSuggestion(file)} onMouseEnter={() => setSuggestionIndex(idx)} className={`input-file-suggestion-item${isSelected ? ' input-file-suggestion-item-selected' : ''}`}>
            <SymbolsFileIcon fileName={name} autoAssign={true} width={14} height={14} className="input-file-icon" />
            <div className="input-file-details">
              <span className="input-file-name">{name}</span>
              {dir && <span className="input-file-dir">{dir}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
export default AutocompleteSuggestions

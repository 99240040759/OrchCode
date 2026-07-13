import React from 'react'
import { Markdown } from './Markdown'

export function StreamBlockRenderer({ content }: { content: string }): React.JSX.Element {
  return <Markdown content={content} />
}

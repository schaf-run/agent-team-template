import { useState } from 'react'
import './CopyField.css'

interface CopyFieldProps {
  value: string
}

export default function CopyField({ value }: CopyFieldProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div className="copy-field">
      <div className="copy-field__value">{value}</div>
      <button
        className="copy-field__button"
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy to clipboard'}
      >
        {copied ? '✓' : 'Copy'}
      </button>
    </div>
  )
}

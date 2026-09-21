import './ProgressBar.css'

interface ProgressBarProps {
  percentage: number
}

export default function ProgressBar({ percentage }: ProgressBarProps) {
  const clampedPercentage = Math.max(0, Math.min(100, percentage))

  return (
    <div className="progress-bar">
      <div
        className="progress-bar__fill"
        style={{ width: `${clampedPercentage}%` }}
      />
    </div>
  )
}

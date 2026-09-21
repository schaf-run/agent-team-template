import { useParams } from 'react-router-dom'

// Placeholder viewer route.
export default function ViewerPage() {
  const { slug } = useParams<{ slug: string }>()

  return (
    <main>
      <h1>Viewer</h1>
      <p>Model slug: {slug}</p>
    </main>
  )
}

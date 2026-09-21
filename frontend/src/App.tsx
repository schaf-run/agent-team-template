import { Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'
import ViewerPage from './pages/ViewerPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/m/:slug" element={<ViewerPage />} />
    </Routes>
  )
}

export default App

import { useEffect, useState } from 'react'
import Home from './pages/Home'
import Admin from './pages/Admin'

export default function App() {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  if (path.startsWith('/admin')) {
    return <Admin />
  }
  return <Home />
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LegalScreen, pageKind } from './legal.tsx'

function Root() {
  const kind = pageKind(window.location.pathname);
  if (kind) {
    return <LegalScreen kind={kind} />;
  }
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

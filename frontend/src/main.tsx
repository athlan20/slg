import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initLang } from './i18n/lang';
import { applyTheme, readStoredTheme } from './theme';
import './styles/index.css';

applyTheme(readStoredTheme());
initLang();

const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 挂载点');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

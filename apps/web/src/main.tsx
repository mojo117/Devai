import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

registerSW({ 
  immediate: false,
  onNeedRefresh() {
    console.log('[PWA] New version available, will update on next visit');
  },
  onOfflineReady() {
    console.log('[PWA] App ready to work offline');
  },
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    console.log('[PWA] Page restored from bfcache');
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

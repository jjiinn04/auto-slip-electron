import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Electron 개발 모드 CSP 경고 억제 (렌더러에서 설정해야 적용됨; 프로덕션엔 main의 CSP 헤더 적용)
(globalThis as { ELECTRON_DISABLE_SECURITY_WARNINGS?: boolean }).ELECTRON_DISABLE_SECURITY_WARNINGS = true;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

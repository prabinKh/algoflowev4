import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const container = document.getElementById('root');
console.log("Main.tsx: Root container:", container);
if (container) {
  console.log("Main.tsx: Mounting App...");
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

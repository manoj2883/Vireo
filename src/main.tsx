import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { AppRoutes } from '@/routes';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      {/* Honour prefers-reduced-motion everywhere: animations jump to their finished state. */}
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </MotionConfig>
    </ThemeProvider>
  </React.StrictMode>
);

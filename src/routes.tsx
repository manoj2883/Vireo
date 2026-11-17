import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { LaunchPage } from '@/pages/LaunchPage';
import { HomePage } from '@/pages/HomePage';
import { WarmUpPage } from '@/pages/WarmUpPage';
import { FieldNotesPage } from '@/pages/FieldNotesPage';
import { StoriesPage } from '@/pages/StoriesPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { TrustPage } from '@/pages/TrustPage';
import { UploadPage } from '@/pages/UploadPage';

// The live session pulls in the audio worklet and media code; load it only when needed.
const LivePage = lazy(() => import('@/pages/LivePage').then((m) => ({ default: m.LivePage })));
const RoleplayPage = lazy(() => import('@/pages/RoleplayPage').then((m) => ({ default: m.RoleplayPage })));

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LaunchPage />} />
      <Route element={<AppShell />}>
        <Route path="/app" element={<HomePage />} />
        <Route path="/warm-up" element={<WarmUpPage />} />
        <Route path="/notes/:id" element={<FieldNotesPage />} />
        <Route path="/stories" element={<StoriesPage />} />
        <Route path="/trust" element={<TrustPage />} />
        <Route path="/upload" element={<UploadPage />} />
      </Route>
      <Route
        path="/session"
        element={
          <Suspense fallback={<p className="p-8 text-ink-muted">Opening the session</p>}>
            <LivePage />
          </Suspense>
        }
      />
      <Route
        path="/roleplay"
        element={
          <Suspense fallback={<p className="p-8 text-ink-muted">Finding your partner</p>}>
            <RoleplayPage />
          </Suspense>
        }
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

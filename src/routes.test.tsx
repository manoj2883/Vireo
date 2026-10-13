import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { AppRoutes } from '@/routes';
import { getAllStories } from '@/services/db';

// Keep the route tests away from IndexedDB, camera and the Gemini socket.
vi.mock('@/services/db', () => ({
  getTeardownBySessionId: vi.fn().mockResolvedValue(undefined),
  getAllStories: vi.fn().mockResolvedValue([]),
  saveStory: vi.fn(),
  deleteStory: vi.fn(),
}));
vi.mock('@/legacy/LegacyApp', () => ({ default: () => <p>Legacy session screen</p> }));

function renderAt(path: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </ThemeProvider>
  );
}

describe('routes', () => {
  it('/ shows the launch page', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1, name: /see your voice/i })).toBeInTheDocument();
  });

  it('/app shows Home inside the app shell', () => {
    renderAt('/app');
    expect(screen.getByRole('navigation', { name: 'App' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('/warm-up links on to the session', () => {
    renderAt('/warm-up');
    expect(screen.getByRole('link', { name: 'Start speaking' })).toHaveAttribute('href', '/session');
  });

  it('/session loads the existing session screen', async () => {
    renderAt('/session');
    expect(await screen.findByText('Legacy session screen')).toBeInTheDocument();
  });

  it('/notes/:id says when there are no notes', async () => {
    renderAt('/notes/does-not-exist');
    expect(await screen.findByRole('heading', { name: /no field notes/i })).toBeInTheDocument();
  });

  it('/stories marks Story Bank as current', async () => {
    renderAt('/stories');
    expect(await screen.findByRole('link', { name: 'Story Bank' })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(getAllStories).toHaveBeenCalled());
  });

  it('unknown paths show the not-found page', () => {
    renderAt('/nope');
    expect(screen.getByRole('heading', { name: /nothing sings here/i })).toBeInTheDocument();
  });
});

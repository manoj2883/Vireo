import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from './ThemeProvider';
import { THEME_STORAGE_KEY } from './themes';
import { ThemeToggle } from './ThemeToggle';

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>
  );
}

describe('ThemeProvider', () => {
  it('defaults to the dark Dawn chorus theme', () => {
    renderToggle();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to Field guide theme' })).toBeInTheDocument();
  });

  it('toggles to light and remembers the choice', () => {
    renderToggle();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Field guide theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(screen.getByRole('button', { name: 'Switch to Dawn chorus theme' })).toBeInTheDocument();
  });

  it('restores a saved theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    renderToggle();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('ignores an invalid saved value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    renderToggle();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

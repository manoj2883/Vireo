import { Link, NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { VireoWordmark } from '@/components/brand/VireoMark';
import { ThemeToggle } from '@/theme/ThemeToggle';

const NAV = [
  { to: '/app', label: 'Home' },
  { to: '/stories', label: 'Story Bank' },
];

export function AppShell() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-container flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <div className="flex flex-wrap items-center gap-6 sm:gap-9">
          <VireoWordmark to="/app" />
          <nav aria-label="App" className="flex flex-wrap gap-1.5 text-label">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) =>
                  cn(
                    'rounded-pill px-4 py-2.5 transition-colors',
                    isActive ? 'bg-surface-100 text-foreground' : 'text-ink-muted hover:text-foreground'
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild>
            <Link to="/warm-up">New session</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-container px-4 pb-24 pt-8 sm:px-8 sm:pt-12">
        <Outlet />
      </main>
    </div>
  );
}

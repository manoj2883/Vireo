import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-container flex-col justify-center gap-6 px-4 sm:px-8">
      <h1 className="font-display text-display-l font-normal">Nothing sings here.</h1>
      <p className="text-body text-ink-muted">That page doesn’t exist.</p>
      <div>
        <Button asChild variant="outline">
          <Link to="/app">Go to Home</Link>
        </Button>
      </div>
    </div>
  );
}

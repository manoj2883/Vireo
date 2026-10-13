import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

/** Warm-up (`/warm-up`). Full screen arrives in Phase 5. */
export function WarmUpPage() {
  return (
    <div className="flex max-w-[760px] flex-col gap-8">
      <h1 className="font-display text-[clamp(36px,4.2vw,56px)] font-normal leading-[1.06] tracking-[-0.02em]">
        Warm up, then you speak.
      </h1>
      <p className="text-body text-ink-muted">
        The prompt, talk type, coaching mode and camera check come with the new warm-up screen. For now this goes
        straight to the existing session screen.
      </p>
      <div>
        <Button asChild size="lg">
          <Link to="/session">Start speaking</Link>
        </Button>
      </div>
    </div>
  );
}

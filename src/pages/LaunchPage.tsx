import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { VireoWordmark } from '@/components/brand/VireoMark';
import { ThemeToggle } from '@/theme/ThemeToggle';

/** Launch page (`/`). The animated sonogram hero arrives with Phase 2; full page in Phase 5. */
export function LaunchPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-container items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <VireoWordmark />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="outline">
            <Link to="/app">Open Vireo</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto flex max-w-container flex-col gap-10 px-4 pb-24 pt-16 sm:px-8 sm:pt-24">
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
          className="max-w-[14ch] font-display text-[clamp(52px,8vw,112px)] font-normal leading-[0.95] tracking-[-0.035em]"
        >
          See your voice the way your audience hears it.
        </motion.h1>
        <p className="max-w-[560px] text-[19px] leading-[30px] text-ink-muted">
          Vireo draws your speech as a sonogram and pins field-guide notes to the moments that matter, each one backed
          by the exact words you said.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/warm-up">Try a session</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/app">Open Vireo</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}

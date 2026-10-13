import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { TeardownView } from '@/components/TeardownView';
import { getTeardownBySessionId } from '@/services/db';
import type { TeardownReport } from '@/types';

type LoadState = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; report: TeardownReport };

/** Field notes (`/notes/:id`). Shows the existing teardown view until Phase 5 replaces it. */
export function FieldNotesPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getTeardownBySessionId(id)
      .then((report) => {
        if (!cancelled) setState(report ? { status: 'ready', report } : { status: 'missing' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'missing' });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.status === 'loading') {
    return <p className="text-ink-muted">Opening your field notes</p>;
  }

  if (state.status === 'missing') {
    return (
      <div className="flex max-w-[640px] flex-col gap-6">
        <h1 className="font-display text-display-l font-normal">No field notes for this session.</h1>
        <p className="text-body text-ink-muted">
          They may have been deleted, or the session ended before Vireo could write them.
        </p>
        <div>
          <Button asChild variant="outline">
            <Link to="/app">Back to Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <TeardownView
      report={state.report}
      flatStretches={[]}
      durationSec={state.report.durationSec || 1}
      onBackToDashboard={() => navigate('/app')}
    />
  );
}

import { accuracyText, ACCURACY, ACCURACY_REPORT_URL, explanationFor, type ExplainContext, type ScoreId } from '@/lib/scoreExplanations';
import { cn } from '@/lib/utils';

/**
 * "How this was scored": a disclosure under a score or headline number, from the one shared
 * explanation file. `data-how-scored` lets a test check every displayed score has one.
 */
export function HowScored({ id, className, ...ctx }: { id: ScoreId; className?: string } & ExplainContext) {
  const e = explanationFor(id);
  const inputs = e.inputs(ctx);
  const target = e.target(ctx);
  return (
    <details data-how-scored={id} className={cn('group mt-2 text-[14px] leading-[21px] text-ink-muted', className)}>
      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-sm font-semibold underline-offset-4 hover:text-ink hover:underline">
        How this was scored<span className="sr-only">: {e.title}</span>
      </summary>
      <div className="mt-1 flex max-w-[560px] flex-col gap-2 rounded-md bg-surface-100 p-4 text-ink">
        <p className="m-0">{e.measures}</p>
        <p className="m-0 text-ink-muted">{e.formula}</p>
        {inputs.length > 0 && (
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {inputs.map((i) => (
              <div key={i.label} className="contents">
                <dt className="text-ink-muted">{i.label}</dt>
                <dd className="m-0 tabular-nums">{i.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {target && (
          <p className="m-0">
            <span className="font-semibold">Target:</span> {target.text} <span className="text-ink-muted">{target.source}</span>
          </p>
        )}
        <p className="m-0 text-ink-muted">
          {accuracyText(e, ctx)}{' '}
          {e.accuracy.kind === 'measured' && (
            <a href={ACCURACY_REPORT_URL} className="text-olive underline underline-offset-4" target="_blank" rel="noreferrer">
              {ACCURACY.published ? 'Full accuracy report' : 'How accuracy will be measured'}
            </a>
          )}
        </p>
      </div>
    </details>
  );
}

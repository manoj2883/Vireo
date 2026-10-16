import type { NaturalPhrasing as Item } from '@/types/fieldNotes';

/**
 * "Say it more naturally": lines whose phrasing would sound non-native or unclear, each quoted
 * from the transcript, with how a native speaker would say it. Nothing when there are none.
 */
export function NaturalPhrasing({ items, open }: { items: Item[] | undefined; open: boolean }) {
  if (!items?.length) return null;
  return (
    <section aria-labelledby="natural-h">
      <details open={open} className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-3">
          <h2 id="natural-h" className="m-0 font-display text-[44px] font-normal leading-[48px] tracking-[-0.02em]">
            Say it more naturally
          </h2>
          <span className="text-label text-ink-muted group-open:hidden">Show {items.length}</span>
          <span className="hidden text-label text-ink-muted group-open:inline">Hide</span>
        </summary>
        <ul className="m-0 mt-5 flex list-none flex-col gap-4 p-0">
          {items.map((item) => (
            <li key={item.original} className="flex flex-col gap-2 rounded-lg bg-surface-100 p-6">
              <p className="m-0 text-body text-ink-muted">
                You said: <q className="italic">{item.original}</q>
              </p>
              <p className="m-0 font-display text-[clamp(20px,2vw,26px)] leading-[1.4]">{item.natural}</p>
              <p className="m-0 text-small text-ink-muted">{item.why}</p>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

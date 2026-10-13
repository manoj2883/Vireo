import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { relativeDay } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Sonogram } from '@/components/sonogram';
import { deleteStory, getSession, listStories, newId, saveStory, type StoredSession, type StoredStory, type StoryKind } from '@/storage/localDb';
import { importLegacyStoriesOnce } from '@/storage/legacyImport';
import type { TalkType } from '@/live/metrics/pace';
import { keyPointResults } from '@/lib/storyPoints';

const TAGS: Record<StoryKind, string[]> = {
  story: ['Interview', 'Research', 'Pitch', 'Talk', 'Toast'],
  bit: ['Opener', 'Callback', 'Closer'],
};

const TAG_TALK_TYPE: Record<string, TalkType> = { Interview: 'interview', Research: 'talk', Pitch: 'pitch', Talk: 'talk', Toast: 'toast' };

type Card = { story: StoredStory; session?: StoredSession };

/** Story Bank (`/stories`): stories and bits ready on demand, each with its last rehearsal drawn. */
export function StoriesPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<StoryKind>('story');
  const [filter, setFilter] = useState('All');
  const [cards, setCards] = useState<Card[] | null>(null);
  const [counts, setCounts] = useState({ story: 0, bit: 0 });
  const [editing, setEditing] = useState<StoredStory | 'new' | null>(null);
  const tabIds = { story: useId(), bit: useId(), panel: useId() };

  const load = useCallback(async () => {
    await importLegacyStoriesOnce().catch(() => 0);
    const all = await listStories();
    setCounts({ story: all.filter((s) => s.kind === 'story').length, bit: all.filter((s) => s.kind === 'bit').length });
    const mine = all.filter((s) => s.kind === tab);
    const withSessions = await Promise.all(mine.map(async (story) => ({ story, session: story.lastSessionId ? await getSession(story.lastSessionId) : undefined })));
    setCards(withSessions);
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = (cards ?? []).filter((c) => filter === 'All' || c.story.tag === filter);

  function rehearse(story: StoredStory) {
    navigate('/warm-up', {
      state: {
        preset: {
          storyId: story.kind === 'story' ? story.id : undefined,
          prompt: story.title,
          talkType: TAG_TALK_TYPE[story.tag] ?? 'free',
        },
      },
    });
  }

  function onTabKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const next = tab === 'story' ? 'bit' : 'story';
      setTab(next);
      setFilter('All');
      document.getElementById(tabIds[next])?.focus();
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-[720px]">
          <h1 className="m-0 font-display text-[clamp(52px,7vw,92px)] font-normal leading-[0.96] tracking-[-0.035em]">Story Bank</h1>
          <p className="m-0 mt-4 text-[19px] leading-[30px] text-ink-muted">
            The stories and lines you want ready on demand. Rehearse one and Vireo checks you hit its key points, not just how you sounded.
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {tab === 'story' ? 'New story' : 'New bit'}
        </Button>
      </section>

      {editing && (
        <StoryEditor
          kind={editing === 'new' ? tab : editing.kind}
          initial={editing === 'new' ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line">
        <div role="tablist" aria-label="Library" className="flex gap-8" onKeyDown={onTabKey}>
          {(['story', 'bit'] as const).map((k) => (
            <button
              key={k}
              id={tabIds[k]}
              type="button"
              role="tab"
              aria-selected={tab === k}
              aria-controls={tabIds.panel}
              tabIndex={tab === k ? 0 : -1}
              onClick={() => {
                setTab(k);
                setFilter('All');
              }}
              className={cn('-mb-px inline-flex min-h-11 items-baseline gap-2 border-b-2 font-display text-[30px]', tab === k ? 'border-olive text-ink' : 'border-transparent text-ink-muted')}
            >
              {k === 'story' ? 'Stories' : 'Bits'} <span className="font-sans text-[15px]">{counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 pb-3" role="group" aria-label="Filter by tag">
          {['All', ...TAGS[tab]].map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={filter === t}
              onClick={() => setFilter(t)}
              className={cn('min-h-10 rounded-pill px-4 text-[15px]', filter === t ? 'bg-paper font-semibold text-paper-foreground' : 'bg-surface-100 text-ink-muted hover:text-ink')}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div id={tabIds.panel} role="tabpanel" aria-labelledby={tabIds[tab]}>
        {cards === null ? (
          <p className="text-ink-muted">Opening your Story Bank</p>
        ) : shown.length === 0 ? (
          <div className="flex max-w-[620px] flex-col gap-4 py-6">
            <p className="m-0 font-display text-note-title">{cards.length ? 'Nothing with that tag yet.' : tab === 'story' ? 'No stories yet.' : 'No bits yet.'}</p>
            <p className="m-0 text-body text-ink-muted">
              {tab === 'story'
                ? 'Add a story you tell often: an interview answer, a research summary, a pitch. Give it a few key points and Vireo will check you hit them each time you rehearse.'
                : 'Bits are short lines you want ready: an opener, a callback, a calm close.'}
            </p>
          </div>
        ) : (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-5 p-0">
            {shown.map(({ story, session }, i) => (
              <StoryCard key={story.id} story={story} session={session} featured={i === 0} onRehearse={() => rehearse(story)} onEdit={() => setEditing(story)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StoryCard({
  story,
  session,
  featured,
  onRehearse,
  onEdit,
}: {
  story: StoredStory;
  session?: StoredSession;
  featured: boolean;
  onRehearse: () => void;
  onEdit: () => void;
}) {
  const titleId = useId();
  const points = keyPointResults(story, session);
  return (
    <li>
      <article aria-labelledby={titleId} className={cn('flex h-full flex-col gap-4 rounded-lg p-7', featured ? 'bg-paper text-paper-foreground' : 'bg-surface-100')}>
        <div className="flex items-baseline justify-between gap-3">
          <span className={cn('font-semibold', featured ? 'text-paper-foreground' : 'text-olive')}>{story.tag}</span>
          <span className="text-small opacity-75">{story.length}</span>
        </div>
        <h2 id={titleId} className="m-0 font-display text-[28px] font-normal leading-8">
          {story.title}
        </h2>
        {story.gist && <p className="m-0 text-[16px] leading-[25px] opacity-85">{story.gist}</p>}
        <div className="h-12" aria-hidden="true">
          {session?.segments.length ? (
            <Sonogram variant="mini" segments={session.segments} pauses={session.pauses} label="" className="h-12" />
          ) : (
            <div className="mt-9 h-px bg-line" />
          )}
        </div>
        {points.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Key points">
            {points.map((p) => (
              <li key={p.label} className="flex items-center gap-2.5 text-[15px]">
                <span
                  aria-hidden="true"
                  className={cn('h-2.5 w-2.5 shrink-0 rounded-pill', p.hit ? (featured ? 'bg-paper-foreground' : 'bg-olive') : 'shadow-[inset_0_0_0_1.5px_rgb(var(--line))]')}
                />
                <span className={cn(!p.hit && 'opacity-70')}>
                  {p.label}
                  <span className="sr-only">{p.hit === null ? ', not rehearsed yet' : p.hit ? ', hit last time' : ', missed last time'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-2">
          <span className="text-small opacity-75">{session ? `Rehearsed ${relativeDay(session.createdAt).toLowerCase()}` : 'Not rehearsed yet'}</span>
          <span className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onEdit} className={cn('min-h-11', featured && 'text-paper-foreground hover:bg-surface-000/10')}>
              Edit
            </Button>
            <Button size="sm" onClick={onRehearse} className={cn('min-h-11', featured ? 'bg-surface-000 text-ink hover:bg-surface-000/90' : 'bg-transparent text-ink shadow-[inset_0_0_0_1.5px_rgb(var(--line))] hover:bg-surface-200')}>
              Rehearse
            </Button>
          </span>
        </div>
      </article>
    </li>
  );
}

function StoryEditor({ kind, initial, onCancel, onSaved }: { kind: StoryKind; initial?: StoredStory; onCancel: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [tag, setTag] = useState(initial?.tag ?? TAGS[kind][0]);
  const [length, setLength] = useState(initial?.length ?? (kind === 'story' ? '2 minutes' : '15 seconds'));
  const [gist, setGist] = useState(initial?.gist ?? '');
  const [points, setPoints] = useState((initial?.keyPoints ?? []).join('\n'));
  const titleRef = useRef<HTMLInputElement>(null);
  const ids = { title: useId(), tag: useId(), length: useId(), gist: useId(), points: useId(), heading: useId() };

  useEffect(() => titleRef.current?.focus(), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const now = new Date().toISOString();
    await saveStory({
      id: initial?.id ?? newId(kind),
      kind,
      title: title.trim(),
      tag,
      length: length.trim(),
      gist: gist.trim(),
      keyPoints: points
        .split('\n')
        .map((p) => p.trim())
        .filter(Boolean),
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
      lastSessionId: initial?.lastSessionId,
    });
    onSaved();
  }

  async function remove() {
    if (!initial) return;
    await deleteStory(initial.id);
    onSaved();
  }

  const field = 'w-full rounded-md border-0 bg-surface-000 px-4 py-3 text-body text-foreground shadow-[inset_0_0_0_1px_rgb(var(--line))]';
  return (
    <form onSubmit={submit} aria-labelledby={ids.heading} className="flex flex-col gap-5 rounded-lg bg-surface-100 p-6 sm:p-8" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <h2 id={ids.heading} className="m-0 font-display text-note-title font-normal">
        {initial ? `Edit ${kind}` : kind === 'story' ? 'New story' : 'New bit'}
      </h2>
      <div className="flex flex-col gap-2">
        <label htmlFor={ids.title} className="text-label">
          {kind === 'story' ? 'Title, or the question it answers' : 'The line'}
        </label>
        <input id={ids.title} ref={titleRef} required value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor={ids.tag} className="text-label">
            Tag
          </label>
          <select id={ids.tag} value={tag} onChange={(e) => setTag(e.target.value)} className={field}>
            {TAGS[kind].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={ids.length} className="text-label">
            Length
          </label>
          <input id={ids.length} value={length} onChange={(e) => setLength(e.target.value)} className={field} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={ids.gist} className="text-label">
          {kind === 'story' ? 'The gist, in a sentence' : 'The setup'}
        </label>
        <input id={ids.gist} value={gist} onChange={(e) => setGist(e.target.value)} className={field} />
      </div>
      {kind === 'story' && (
        <div className="flex flex-col gap-2">
          <label htmlFor={ids.points} className="text-label">
            Key points, one per line
          </label>
          <textarea id={ids.points} rows={4} value={points} onChange={(e) => setPoints(e.target.value)} className={field} aria-describedby={`${ids.points}-help`} />
          <span id={`${ids.points}-help`} className="text-small text-ink-muted">
            Vireo checks you hit these, in order, every time you rehearse.
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {initial ? (
          <Button type="button" variant="ghost" onClick={remove}>
            Delete {kind}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </div>
    </form>
  );
}

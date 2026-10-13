import { useSyncExternalStore } from 'react';
import type { LiveSessionEngine, LiveSnapshot } from './LiveSessionEngine';

/** Subscribe a component to a live session's snapshot. */
export function useLiveSnapshot(engine: LiveSessionEngine): LiveSnapshot {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
}

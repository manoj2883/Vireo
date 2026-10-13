import { useEffect, useId, useMemo, useState } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { cn } from '@/lib/utils';
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion';
import { describeSonogram, layoutSonogram, type TimeWindow } from './geometry';
import type { AnnotationTone, PauseSpan, SonogramAnnotation, SonogramMode, SonogramVariant, WordSegment } from './types';

export interface SonogramProps {
  segments: readonly WordSegment[];
  pauses?: readonly PauseSpan[];
  annotations?: readonly SonogramAnnotation[];
  /** static: the whole answer. reveal: draws in once with a playhead. scrolling: the last few seconds, live. */
  mode?: SonogramMode;
  /** Defaults to ribbon for scrolling and hero otherwise. */
  variant?: SonogramVariant;
  /** Live clock in ms (scrolling mode). */
  nowMs?: number;
  /** Width of the scrolling window. */
  windowMs?: number;
  /** Explicit time range for static and reveal modes. */
  window?: TimeWindow;
  /** Widen long answers so they stay legible; the wrapper scrolls horizontally. */
  minPxPerSecond?: number;
  revealDurationMs?: number;
  /** Change to replay the reveal. */
  revealKey?: string | number;
  onRevealComplete?: () => void;
  /** Overrides the generated screen-reader description. */
  label?: string;
  className?: string;
}

const STROKE_CLASS = { speech: 'stroke-olive', rushed: 'stroke-olive', filler: 'stroke-amber' } as const;
const TONE_FILL: Record<AnnotationTone, string> = {
  amber: 'fill-amber',
  sky: 'fill-sky',
  olive: 'fill-olive',
  muted: 'fill-ink-muted',
};
const TONE_STROKE: Record<AnnotationTone, string> = {
  amber: 'stroke-amber',
  sky: 'stroke-sky',
  olive: 'stroke-olive',
  muted: 'stroke-ink-muted',
};

export function Sonogram({
  segments,
  pauses = [],
  annotations = [],
  mode = 'static',
  variant,
  nowMs,
  windowMs = 6000,
  window,
  minPxPerSecond,
  revealDurationMs = 3200,
  revealKey,
  onRevealComplete,
  label,
  className,
}: SonogramProps) {
  const resolvedVariant: SonogramVariant = variant ?? (mode === 'scrolling' ? 'ribbon' : 'hero');
  const scrolling = mode === 'scrolling';
  // useId contains colons, which break url(#id) references.
  const clipId = `sonogram-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const layoutWindow = useMemo<TimeWindow | undefined>(() => {
    if (scrolling) {
      const now = nowMs ?? 0;
      return { startMs: now - windowMs, endMs: now };
    }
    return window;
  }, [scrolling, nowMs, windowMs, window]);

  const layout = useMemo(
    () =>
      layoutSonogram({
        segments,
        pauses,
        annotations,
        variant: resolvedVariant,
        window: layoutWindow,
        nowMs: scrolling ? nowMs : undefined,
        minPxPerSecond: scrolling ? undefined : minPxPerSecond,
      }),
    [segments, pauses, annotations, resolvedVariant, layoutWindow, scrolling, nowMs, minPxPerSecond]
  );

  const { width, height, spec } = layout;

  // Reveal: a clip rect and playhead sweep left to right once, on a spring.
  const reduceMotion = usePrefersReducedMotion();
  const revealing = mode === 'reveal' && !reduceMotion;
  const sweep = useMotionValue(revealing ? spec.padX : width);
  const playheadOpacity = useTransform(sweep, [width - 1, width], [0.7, 0]);
  const [revealDone, setRevealDone] = useState(!revealing);

  useEffect(() => {
    if (!revealing) {
      sweep.set(width);
      setRevealDone(true);
      return;
    }
    setRevealDone(false);
    sweep.set(spec.padX);
    const controls = animate(sweep, width, {
      type: 'spring',
      duration: revealDurationMs / 1000,
      bounce: 0,
      onComplete: () => {
        setRevealDone(true);
        onRevealComplete?.();
      },
    });
    return () => controls.stop();
    // onRevealComplete is a callback prop; re-running the sweep when it changes identity would restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealing, revealKey, width, spec.padX, revealDurationMs, sweep]);

  const description = label ?? describeSonogram(segments, pauses, annotations);
  const nonScaling = scrolling ? 'non-scaling-stroke' : undefined;
  const legibleWidth = minPxPerSecond && width > spec.width;

  const svg = (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={legibleWidth ? width : '100%'}
      height={scrolling ? '100%' : undefined}
      preserveAspectRatio={scrolling ? 'none' : 'xMidYMid meet'}
      role="img"
      aria-label={description}
      className={cn('block', !legibleWidth && className)}
      data-mode={mode}
      data-variant={resolvedVariant}
    >
      <defs>
        <clipPath id={clipId}>
          <motion.rect x={0} y={0} height={height} width={sweep} />
        </clipPath>
      </defs>

      {spec.axis && (
        <g aria-hidden="true">
          <line x1={spec.padX} y1={spec.axis.baselineY} x2={width - spec.padX} y2={spec.axis.baselineY} className="stroke-line" strokeWidth={1} />
          <line x1={spec.padX} y1={spec.axis.top} x2={spec.padX} y2={spec.axis.baselineY} className="stroke-line" strokeWidth={1} />
          <text x={spec.padX - 8} y={spec.axis.top + 30} textAnchor="end" fontSize={12} className="fill-ink-muted font-sans">
            high
          </text>
          <text x={spec.padX - 8} y={spec.axis.baselineY - 4} textAnchor="end" fontSize={12} className="fill-ink-muted font-sans">
            low
          </text>
        </g>
      )}
      {scrolling && (
        <line x1={0} y1={height - 10} x2={width} y2={height - 10} className="stroke-line" strokeWidth={1} vectorEffect="non-scaling-stroke" aria-hidden="true" />
      )}

      {scrolling &&
        layout.pauses.map((p, i) => (
          <rect
            key={`pause-${i}`}
            x={p.xa}
            y={14}
            width={Math.max(0, p.xb - p.xa)}
            height={height - 24}
            rx={8}
            className="fill-sky"
            fillOpacity={0.12}
            data-testid="pause-mark"
            aria-hidden="true"
          />
        ))}

      <g clipPath={`url(#${clipId})`} aria-hidden="true">
        {layout.strokes.map((s) => (
          <path
            key={s.key}
            d={s.d}
            fill="none"
            className={STROKE_CLASS[s.kind]}
            strokeOpacity={s.opacity}
            strokeWidth={s.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect={nonScaling}
            data-kind={s.kind}
            data-harmonic={s.harmonic}
          />
        ))}
        {layout.labels.map((l) => (
          <text
            key={`label-${l.wordIndex}`}
            x={l.x}
            y={spec.labelY ?? 0}
            textAnchor="middle"
            fontSize={spec.labelFontSize}
            className={cn('font-sans', l.kind === 'filler' ? 'fill-amber' : 'fill-ink-muted')}
          >
            {l.text}
          </text>
        ))}
      </g>

      {layout.annotations.length > 0 && (
        <motion.g
          aria-hidden="true"
          initial={false}
          animate={{ opacity: revealDone ? 1 : 0 }}
          transition={{ type: 'spring', duration: 0.7, bounce: 0 }}
          data-testid="annotations"
        >
          {layout.annotations.map((a) => (
            <g key={a.key}>
              <path d={a.bracket} fill="none" className={TONE_STROKE[a.tone]} strokeWidth={1.5} />
              <text
                x={a.textX}
                y={a.textY}
                textAnchor="middle"
                fontSize={spec.annotationFontSize}
                className={cn('font-display italic', TONE_FILL[a.tone])}
              >
                {a.text}
              </text>
            </g>
          ))}
        </motion.g>
      )}

      {mode === 'reveal' && (
        <motion.line
          x1={sweep}
          x2={sweep}
          y1={spec.axis ? spec.axis.top - 8 : 0}
          y2={spec.axis ? spec.axis.baselineY + 4 : height}
          className="stroke-ink"
          strokeWidth={1.5}
          style={{ opacity: revealing ? playheadOpacity : 0 }}
          aria-hidden="true"
        />
      )}
      {scrolling && (
        <line x1={width} y1={6} x2={width} y2={height - 6} className="stroke-ink" strokeWidth={2} vectorEffect="non-scaling-stroke" aria-hidden="true" />
      )}
    </svg>
  );

  if (legibleWidth) {
    return (
      <div className={cn('overflow-x-auto', className)} tabIndex={0} aria-label="Scroll the sonogram">
        {svg}
      </div>
    );
  }
  return svg;
}

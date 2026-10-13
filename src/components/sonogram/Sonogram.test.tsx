import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Sonogram } from './Sonogram';
import { DEMO_ANNOTATIONS, DEMO_LABEL, DEMO_PAUSES, DEMO_SEGMENTS } from './demo';

function mockReducedMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes('reduce'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList
  );
}

afterEach(() => vi.restoreAllMocks());

describe('<Sonogram>', () => {
  it('renders three strokes per word, coloured by kind', () => {
    const { container } = render(<Sonogram segments={DEMO_SEGMENTS} pauses={DEMO_PAUSES} />);
    const paths = container.querySelectorAll('path[data-harmonic]');
    expect(paths).toHaveLength(DEMO_SEGMENTS.length * 3);
    expect(container.querySelectorAll('path.stroke-amber[data-kind="filler"]')).toHaveLength(9);
    expect(container.querySelectorAll('path.stroke-olive[data-kind="rushed"]')).toHaveLength(18);
  });

  it('is announced as one image with a summary', () => {
    render(<Sonogram segments={DEMO_SEGMENTS} pauses={DEMO_PAUSES} />);
    expect(screen.getByRole('img', { name: /12 words, 3 fillers, 1 pause/ })).toBeInTheDocument();
  });

  it('uses a custom label when given', () => {
    render(<Sonogram segments={DEMO_SEGMENTS} label={DEMO_LABEL} />);
    expect(screen.getByRole('img', { name: DEMO_LABEL })).toBeInTheDocument();
  });

  it('draws annotations in the field-guide italic', () => {
    render(<Sonogram segments={DEMO_SEGMENTS} pauses={DEMO_PAUSES} annotations={DEMO_ANNOTATIONS} />);
    const note = screen.getByText('a pause that landed');
    expect(note).toHaveClass('font-display', 'italic', 'fill-sky');
  });

  it('shows the finished drawing straight away under reduced motion', async () => {
    mockReducedMotion(true);
    const { container } = render(<Sonogram mode="reveal" segments={DEMO_SEGMENTS} pauses={DEMO_PAUSES} annotations={DEMO_ANNOTATIONS} />);
    const clip = container.querySelector('clipPath rect')!;
    await waitFor(() => expect(parseFloat(clip.getAttribute('width')!)).toBe(1200));
    await waitFor(() => expect(screen.getByTestId('annotations')).not.toHaveStyle({ opacity: '0' }));
  });

  it('starts the reveal from the left edge with notes hidden', () => {
    mockReducedMotion(false);
    const { container } = render(<Sonogram mode="reveal" segments={DEMO_SEGMENTS} annotations={DEMO_ANNOTATIONS} />);
    const clip = container.querySelector('clipPath rect')!;
    expect(parseFloat(clip.getAttribute('width')!)).toBeLessThan(1200);
    expect(screen.getByTestId('annotations')).toHaveStyle({ opacity: '0' });
  });

  it('scrolls a six-second ribbon that stretches to its container', () => {
    const { container } = render(
      <Sonogram mode="scrolling" segments={DEMO_SEGMENTS} pauses={[{ startMs: 5000 }]} nowMs={6000} />
    );
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('data-variant', 'ribbon');
    expect(svg).toHaveAttribute('preserveAspectRatio', 'none');
    expect(screen.getByTestId('pause-mark')).toBeInTheDocument();
    expect(container.querySelector('path[data-harmonic]')).toHaveAttribute('vector-effect', 'non-scaling-stroke');
  });

  it('wraps long answers in a keyboard-scrollable region', () => {
    render(<Sonogram segments={[{ text: 'long', startMs: 0, endMs: 60_000, kind: 'speech' }]} minPxPerSecond={100} />);
    expect(screen.getByLabelText('Scroll the sonogram')).toHaveAttribute('tabindex', '0');
  });
});

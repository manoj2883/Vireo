/** "Land it": when the answer has no clear closing line, up to two built only from the speaker's words. */
export function LandingLine({ landing }: { landing: { hasClearClose: boolean; suggestions: string[] } | undefined }) {
  if (!landing || landing.hasClearClose || landing.suggestions.length === 0) return null;
  return (
    <section aria-labelledby="landing-h" className="paper-scope flex flex-col gap-4 rounded-lg bg-paper p-7 text-paper-foreground sm:p-10">
      <p id="landing-h" className="m-0 text-label opacity-75">
        Your answer didn’t land on a clear line. Try ending with
      </p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {landing.suggestions.map((s) => (
          <li key={s} className="font-display text-[clamp(26px,3vw,38px)] leading-[1.15] tracking-[-0.01em]">
            “{s}”
          </li>
        ))}
      </ul>
      <p className="m-0 text-small opacity-75">Built only from your own words, and short enough to say in one breath.</p>
    </section>
  );
}

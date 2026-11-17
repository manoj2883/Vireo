/** Replace everything between two marker comments in a generated doc, keeping the markers. */
export function replaceBetween(text: string, start: string, end: string, content: string): string {
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a === -1 || b === -1 || b < a) throw new Error(`Markers ${start} and ${end} not found in order.`);
  return `${text.slice(0, a + start.length)}\n${content}\n${text.slice(b)}`;
}

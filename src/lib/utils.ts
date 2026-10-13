import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge needs to know Vireo's custom font sizes, or it treats `text-metric` and
 * `text-amber` as the same group and silently drops the size.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display-xl', 'display-l', 'note-title', 'annotation', 'metric', 'heading', 'body', 'small', 'label'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

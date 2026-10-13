export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'vireo-theme';

/** Display names from the design system. */
export const THEME_NAMES: Record<Theme, string> = {
  dark: 'Dawn chorus',
  light: 'Field guide',
};

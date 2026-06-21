// Exact translation of theme.dart — single source of truth
export const colors = {
  // Accent — cream white
  cream:      '#BFAE98',
  creamDark:  '#EDE3D2',
  // Light mode
  pageLight:            '#F2EFE8',
  surfaceLight:         '#EDE9E1',
  surfaceElevatedLight: '#E8E4DC',
  surface2Light:        '#DEDAD1',
  borderLight:          'rgba(0,0,0,0.1)',
  textPrimLight:        '#1A1815',
  textSecLight:         '#7A766E',
  textFaintLight:       '#B0AAA0',
  // Dark mode
  pageDark:             '#1A1816',
  surfaceDark:          '#242220',
  surfaceElevatedDark:  '#2E2C2A',
  surface2Dark:         '#3A3836',
  borderDark:           '#3A3836',
  textPrimDark:         '#F0EDE8',
  textSecDark:          '#A09790',
  textFaintDark:        '#6B6560',
  // Status
  statusGreen: '#4ADE80',
  statusAmber: '#FBBF24',
  statusRed:   '#F87171',
  // Badge chips
  badgePreview: '#D97706',
  badgeNew:     '#2563EB',
  badgeFast:    '#16A34A',
  badgeFree:    '#0D9488',
  // Code block — always dark
  codeBackground: '#1E1E2E',
  codeText:       '#CDD6F4',
  codeLang:       '#6C7086',
} as const;

export const radius = { xs:8, sm:12, md:16, lg:20, xl:24, pill:50 } as const;

export const spacing = { xs:4, sm:8, md:12, lg:16, xl:20, xxl:28 } as const;

export const iconSize = { xs:13, sm:16, sub:18, md:20, lg:24 } as const;

export const size = { iconButton:36, searchBar:46 } as const;

// Runtime theme resolved against current mode
export type Theme = {
  page: string; surface: string; surfaceHigh: string; surface2: string;
  border: string; textPrim: string; textSec: string; textFaint: string;
  accent: string;
};

export function resolveTheme(dark: boolean): Theme {
  return dark ? {
    page: colors.pageDark, surface: colors.surfaceDark,
    surfaceHigh: colors.surfaceElevatedDark, surface2: colors.surface2Dark,
    border: colors.borderDark, textPrim: colors.textPrimDark,
    textSec: colors.textSecDark, textFaint: colors.textFaintDark,
    accent: colors.creamDark,
  } : {
    page: colors.pageLight, surface: colors.surfaceLight,
    surfaceHigh: colors.surfaceElevatedLight, surface2: colors.surface2Light,
    border: colors.borderLight, textPrim: colors.textPrimLight,
    textSec: colors.textSecLight, textFaint: colors.textFaintLight,
    accent: colors.cream,
  };
}

export function applyTheme(dark: boolean) {
  const t = resolveTheme(dark);
  const r = document.documentElement.style;
  r.setProperty('--page', t.page);
  r.setProperty('--surface', t.surface);
  r.setProperty('--surface-high', t.surfaceHigh);
  r.setProperty('--surface2', t.surface2);
  r.setProperty('--border', t.border);
  r.setProperty('--text-prim', t.textPrim);
  r.setProperty('--text-sec', t.textSec);
  r.setProperty('--text-faint', t.textFaint);
  r.setProperty('--accent', t.accent);
  r.setProperty('--r-xs', `${radius.xs}px`);
  r.setProperty('--r-sm', `${radius.sm}px`);
  r.setProperty('--r-md', `${radius.md}px`);
  r.setProperty('--r-lg', `${radius.lg}px`);
  r.setProperty('--r-xl', `${radius.xl}px`);
  r.setProperty('--r-pill', `${radius.pill}px`);
  r.setProperty('--sp-xs', `${spacing.xs}px`);
  r.setProperty('--sp-sm', `${spacing.sm}px`);
  r.setProperty('--sp-md', `${spacing.md}px`);
  r.setProperty('--sp-lg', `${spacing.lg}px`);
  r.setProperty('--sp-xl', `${spacing.xl}px`);
  r.setProperty('--sp-xxl', `${spacing.xxl}px`);
  r.setProperty('--icon-sm', `${iconSize.sm}px`);
  r.setProperty('--icon-md', `${iconSize.md}px`);
  r.setProperty('--icon-lg', `${iconSize.lg}px`);
  r.setProperty('--status-green', colors.statusGreen);
  r.setProperty('--status-amber', colors.statusAmber);
  r.setProperty('--status-red', colors.statusRed);
  r.setProperty('--code-bg', colors.codeBackground);
  r.setProperty('--code-text', colors.codeText);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

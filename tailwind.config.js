/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./renderer/**/*.{ts,tsx}', './renderer/index.html'],
  theme: {
    extend: {
      colors: {
        /* App surface palette — derived from #1b1b1f */
        'oc-base': 'var(--oc-base)',
        'oc-surface': 'var(--oc-surface)',
        'oc-raised': 'var(--oc-raised)',
        'oc-hover': 'var(--oc-hover)',
        'oc-active': 'var(--oc-active)',
        'oc-border': 'var(--oc-border)',
        'oc-border-sub': 'var(--oc-border-sub)',
        /* Text tiers */
        'tx-dim': 'var(--tx-dim)',
        'tx-muted': 'var(--tx-muted)',
        'tx-sub': 'var(--tx-sub)',
        'tx-main': 'var(--tx-main)',
        'tx-bright': 'var(--tx-bright)',
        /* shadcn compat */
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        }
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      width: { sidebar: 'var(--sidebar-width)', avatar: 'var(--avatar-size)' },
      minWidth: { sidebar: 'var(--sidebar-width)', artifact: 'var(--artifact-min-width)' },
      maxWidth: { chat: 'var(--chat-max-width)' },
      maxHeight: { input: '200px' },
      minHeight: { input: '24px' },
      height: {
        topbar: 'var(--topbar-height)',
        titlebar: 'var(--titlebar-height)',
        avatar: 'var(--avatar-size)'
      },
      padding: {
        'nav-y': 'var(--nav-item-py)',
        'repo-y': 'var(--repo-item-py)',
        'agent-y': 'var(--agent-item-py)'
      },
      spacing: {
        'agent-indent': 'var(--agent-indent)',
        'nav-gap': 'var(--nav-item-gap)',
        'section-gap': 'var(--section-gap)',
        'folder-child': 'var(--folder-child-mt)',
        'folder-gap': 'var(--folder-item-gap)',
        titlebar: 'var(--titlebar-height)'
      },
      fontSize: {
        '3xs': ['10px', { lineHeight: '1.4' }],
        '2xs': ['11px', { lineHeight: '1.4' }],
        xs: ['12px', { lineHeight: '1.4' }],
        sm: ['13px', { lineHeight: '1.5' }],
        base: ['14px', { lineHeight: '1.6' }]
      },
      fontFamily: {
        sans: ['Sora', 'sans-serif']
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        spin: 'spin 1s linear infinite'
      },
      keyframes: {
        'accordion-down': {
          from: { height: 0 },
          to: { height: 'var(--radix-accordion-content-height)' }
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: 0 }
        },
        spin: { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } }
      }
    }
  },
  plugins: [
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('tailwindcss-animate')
  ]
}

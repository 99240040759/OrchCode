/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./renderer/**/*.{ts,tsx}', './renderer/index.html'],
  theme: {
    extend: {
      colors: {
        /* Legacy aliases re-routed strictly to shadcn theme tokens */
        'oc-base': 'var(--background)',
        'oc-surface': 'var(--card)',
        'oc-raised': 'var(--muted)',
        'oc-hover': 'var(--accent)',
        'oc-active': 'var(--secondary)',
        'oc-border': 'var(--border)',
        'oc-border-sub': 'var(--border)',
        'tx-dim': 'var(--muted-foreground)',
        'tx-muted': 'var(--muted-foreground)',
        'tx-sub': 'var(--muted-foreground)',
        'tx-main': 'var(--foreground)',
        'tx-bright': 'var(--foreground)',
        /* shadcn theme tokens */
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)'
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)'
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)'
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)'
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)'
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)'
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)'
        },
        sidebar: {
          DEFAULT: 'var(--sidebar)',
          foreground: 'var(--sidebar-foreground)',
          primary: 'var(--sidebar-primary)',
          'primary-foreground': 'var(--sidebar-primary-foreground)',
          accent: 'var(--sidebar-accent)',
          'accent-foreground': 'var(--sidebar-accent-foreground)',
          border: 'var(--sidebar-border)',
          ring: 'var(--sidebar-ring)'
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

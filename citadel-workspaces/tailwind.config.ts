import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      /**
       * The smallest tier holds a 12px floor.
       *
       * The appearance default sets the document root to 14px, and Tailwind's
       * rem scale assumes 16 — so every size in the app renders at 87.5% of its
       * nominal value and `text-xs` lands at 10.5px. Lighthouse measured 44.85%
       * of the landing page's text as illegible, and 228 elements use this
       * class, so that is not a corner of the design: it is most of the small
       * print in the product, below the size at which small print is readable.
       *
       * `max()` rather than a fixed 12px, because the point of the setting is
       * that it scales. At a 16px root this is exactly 12px as before; at 18px
       * it grows to 13.5px; at the 12px minimum the floor holds instead of
       * dropping to 9px. Only the illegible direction is clamped.
       */
      fontSize: {
        xs: ['max(12px, 0.75rem)', { lineHeight: 'max(16px, 1rem)' }],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        "control-border": "hsl(var(--control-border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          // For destructive TEXT on a normal background. `DEFAULT` is a
          // surface colour and is too dark to read as body text in dark mode.
          emphasis: "hsl(var(--destructive-emphasis))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        /* The Radix popper surface. index.css defines --popover and
           --popover-foreground, but this key was missing — so `.bg-popover`
           was never generated and every ui/ primitive asking for it
           (popover, tooltip, dropdown-menu, select, context-menu) rendered
           TRANSPARENT. Twenty-odd surfaces were patched one at a time with a
           local bg-card/bg-surface override; the rest, including the message
           context menu on every chat bubble, showed the page through them. */
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        /* Same omission as popover, in the shadcn sidebar primitive: it
           references bg-sidebar / bg-sidebar-accent / border-sidebar-border,
           none of which resolved, so SidebarMenuButton's hover, active and
           data-[active=true] rules produced no CSS at all. index.css aliases
           these onto the palette. */
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        /* Elevated surface: menus, popovers, hover and selected rows. The app
           had ~10 near-identical hexes doing this job; they collapse here. */
        surface: {
          DEFAULT: "hsl(var(--surface))",
          foreground: "hsl(var(--surface-foreground))",
        },
        /* The lighter brand tone, for accent text and icons on a dark surface.
           Distinct from `primary`, which is a button FILL and must carry
           primary-foreground text at AA. */
        "primary-accent": "hsl(var(--primary-accent))",
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          // For success TEXT. DEFAULT is a surface colour: white sits on it,
          // which pins its lightness, and as text it was 3.54:1 on its own
          // bg-success/20 tint -- the "Active" badge.
          emphasis: "hsl(var(--success-emphasis))",
        },
        "read-receipt": "hsl(var(--read-receipt))",
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          // Same reasoning as success.emphasis above.
          emphasis: "hsl(var(--warning-emphasis))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "fade-out": {
          "0%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
        "slide-in": {
          "0%": { transform: "translateX(100%)" },
          "100%": { transform: "translateX(0)" },
        },
        "slide-out": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(100%)" },
        },
        "notch-in": {
          "0%": { transform: "translateY(100%)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "notch-out": {
          "0%": { transform: "translateY(0)", opacity: "1" },
          "100%": { transform: "translateY(100%)", opacity: "0" },
        },
        "shake": {
          "0%, 100%": { transform: "translateX(0)" },
          "10%, 30%, 50%, 70%, 90%": { transform: "translateX(-4px)" },
          "20%, 40%, 60%, 80%": { transform: "translateX(4px)" },
        },
        // A ring that swells outward and dissolves — the visual grammar of a
        // ringing phone. Deliberately slower and softer than animate-ping.
        "ring-pulse": {
          "0%": { transform: "scale(1)", opacity: "0.7" },
          "70%": { transform: "scale(1.4)", opacity: "0" },
          "100%": { transform: "scale(1.4)", opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        // `forwards`: an entrance animation must HOLD its end state. The rule this
        // replaced had it; without it a finished fade reverts to the underlying
        // style, so a list that mounts after the page settles can be observed
        // part-way through — which is how the a11y scan started reading white
        // text at partial opacity as a #34353f contrast failure.
        "fade-in": "fade-in 0.3s ease-out forwards",
        // The notch of the new-messages pill; `forwards` holds the end state, as above.
        "notch-in": "notch-in 0.22s cubic-bezier(0.2, 0.8, 0.2, 1) forwards",
        "notch-out": "notch-out 0.16s ease-in forwards",
        "fade-out": "fade-out 0.3s ease-out",
        "slide-in": "slide-in 0.3s ease-out",
        "slide-out": "slide-out 0.3s ease-out",
        "shake": "shake 0.5s ease-in-out",
        "ring-pulse": "ring-pulse 2.4s ease-out infinite",
      },
      fontFamily: {
        sans: ["SF Pro Display", "system-ui", "sans-serif"],
        body: ["SF Pro Text", "system-ui", "sans-serif"],
      },
      typography: {
        DEFAULT: {
          css: {
            color: 'hsl(var(--foreground))',
            a: {
              color: 'hsl(var(--primary))',
              '&:hover': {
                color: 'hsl(var(--primary))',
              },
            },
            // List markers were left at Typography's default, gray-300, which
            // measures 1.47:1 against the light theme's white page — a bullet
            // nobody can see. The rest of the prose colours were tokenised and
            // these were missed, so the defect only existed in light mode.
            //
            // axe does not evaluate ::marker pseudo-elements, so the
            // accessibility suite passed over it in both schemes; it took
            // measuring the computed marker colour to find.
            //
            // muted-foreground is the right token rather than foreground: a
            // marker is structure, not content, and should read as secondary
            // without disappearing. It is defined per-theme, so one value
            // serves both — hence the same assignment for the invert variant,
            // which otherwise falls back to its own gray default.
            '--tw-prose-bullets': 'hsl(var(--muted-foreground))',
            '--tw-prose-counters': 'hsl(var(--muted-foreground))',
            '--tw-prose-invert-bullets': 'hsl(var(--muted-foreground))',
            '--tw-prose-invert-counters': 'hsl(var(--muted-foreground))',
          },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
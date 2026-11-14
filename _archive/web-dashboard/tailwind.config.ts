// Copied from replica/design/tailwind.config.ts, content globs widened for this app.
import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        border: "var(--color-border)",
        "border-input": "var(--color-border-input)",
        text: "var(--color-text)",
        muted: "var(--color-text-muted)",
        accent: "var(--color-accent)",
        "on-accent": "var(--color-on-accent)",
        danger: "var(--color-danger)",
        success: "var(--color-success)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        xs: ["var(--text-xs-size)", { lineHeight: "var(--text-xs-line)" }],
        sm: ["var(--text-sm-size)", { lineHeight: "var(--text-sm-line)" }],
        base: ["var(--text-base-size)", { lineHeight: "var(--text-base-line)" }],
        lg: ["var(--text-lg-size)", { lineHeight: "var(--text-lg-line)" }],
        xl: ["var(--text-xl-size)", { lineHeight: "var(--text-xl-line)" }],
        display: ["var(--text-display-size)", { lineHeight: "var(--text-display-line)" }],
      },
      // spacing: intentionally NOT overridden. Tailwind's default scale is already
      // 4px-based (1=4px, 2=8px, 3=12px, 4=16px...). Remapping numeric keys to the
      // token scale made h-5..h-8 resolve to 24..64px and broke sizing.
      borderRadius: {
        sm: "var(--radius-sm)", md: "var(--radius-md)",
        lg: "var(--radius-lg)", pill: "var(--radius-pill)",
      },
      boxShadow: { card: "var(--shadow-card)", pop: "var(--shadow-pop)" },
      transitionDuration: { fast: "var(--motion-fast)", base: "var(--motion-base)" },
      transitionTimingFunction: { brand: "var(--motion-ease)" },
    },
  },
} satisfies Config;

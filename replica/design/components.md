# Components

One spec per component. Build these in isolation (a `/design` route) before
any screen — that's the design-system check in Step 4. Every state is real,
including the ones the recon only implied: focus, disabled, loading, error,
empty. Tokens are role names from `tokens.json`; never a raw hex in a
component.

## Primitives

```
Button
  variants  primary (bg accent), secondary (bg surface, border border),
            ghost (transparent, border on hover), danger (bg danger)
  sizes     sm 32px, md 40px, lg 48px
  states    default, hover (bg darkens ~8%), active, focus-visible
            (2px ring, accent, 2px offset), disabled (opacity .4, no pointer
            events), loading (spinner replaces icon, label stays for
            screen readers via aria-live="off" + visually-hidden text)
  tokens    bg accent|surface|danger, text on-accent|text, radius md,
            font sm/600, padding-x space-4
  a11y      real <button>; danger variant gets an explicit confirm step
            before firing, never a bare click (see Modal below) — this is
            the fix for the original's pattern of giving "Create Filter"
            and "Reset Active Device" the same visual weight despite very
            different risk
  used on   all screens with an action

Input (text, password, search)
  variants  text, password (toggle reveal), search (leading icon)
  states    default (border border-input), focus (border accent, 2px ring),
            invalid (border danger, helper text below in danger),
            disabled (opacity .5)
  tokens    bg surface, border border-input, text text, placeholder
            text-muted, radius md, padding space-3/space-4
  a11y      <label> always present (visually hidden where the design omits
            it), aria-invalid + aria-describedby on error
  used on   S02 login, S07 filter editor, S18 GeoIP input, S24 password
            confirm, S13 OAuth username display

Badge / pill
  variants  neutral (surface + border), accent, danger-soft (for "Active"
            state), count (numeric, e.g. community filter count)
  sizes     sm (20px tall), md (24px tall)
  states    static only — badges don't take focus
  tokens    bg surface with 1px border, text text-muted or role color,
            radius pill, font xs/500
  used on   S21 (community count), S24 (Active device), S25 (lock icon
            badge), S03 (user-count badge — own install-base count, not
            the original's 1M+ claim)

Tabs
  variants  underline-style (My Filters / Community), segmented (PSN / Xbox
            toggle)
  states    selected (bg surface, text text, elevated), unselected
            (text-muted, transparent), focus-visible (ring), disabled
  tokens    radius md for segmented container, pill for the active segment
  a11y      role="tablist"/"tab"/"tabpanel", arrow-key navigation between
            tabs
  used on   S21 filters, S18/S19-equivalent tool tabs (GeoIP only — resolver
            is skipped)

Data table
  variants  dense (IP/device list), card-row (traffic table alternative on
            narrow viewports)
  states    empty (icon + heading + body + primary action — see Empty
            State), loading (skeleton rows), filled, paginated
  tokens    header text-muted/xs/600 uppercase, row border-bottom border,
            row hover bg surface
  a11y      real <table> with <th scope="col">; row actions reachable by
            keyboard, not icon-only with no label
  used on   S05 traffic table, S20 device list (the address-book redesign —
            see architecture.md), S27 invoice history

Empty state
  variants  icon + heading + body + CTA
  states    default only
  tokens    icon in a circular surface chip, heading lg/600, body
            sm/text-muted, CTA button primary
  used on   S06/S21 (no filters yet), S10 (no traffic-control rules yet),
            S05 (no capture started)

Progress / meter bar
  variants  determinate only (e.g. "switches used 1/3")
  states    default, at-limit (fill reaches end, label turns danger)
  tokens    track bg surface, fill bg accent, radius pill, height 6px
  a11y      role="progressbar" with aria-valuenow/min/max and a visible
            numeric label — never color alone to convey "near the limit"
  used on   S24 device-switch meter

Avatar
  variants  image, initials fallback
  sizes     sm 24px, md 32px, lg 40px
  tokens    radius pill, border border (1px) so it reads against bg
  used on   nav sidebar footer (account chip), S13 linked-account card

Toast / notification
  variants  success, error, info
  states    appearing (slide + fade in, motion-base), visible, dismissing
  tokens    bg surface, border-left 3px in role color, radius md, shadow pop
  a11y      role="status" (info/success) or role="alert" (error);
            auto-dismiss only for success/info, never for error
  used on   all screens after a save/delete/sync action

Modal / dialog
  variants  form (filter editor), confirm (destructive actions)
  states    open, closing, with a required confirm variant for anything
            danger-styled (type-to-confirm or a second explicit click, per
            the Button note above)
  tokens    bg surface, shadow pop, radius lg, backdrop bg black/50% blur-sm
  a11y      focus-trapped, Escape closes (confirm variant: Escape = cancel,
            not confirm), returns focus to the trigger on close
  used on   S07 filter editor, S10 traffic-control rule builder, S15 export,
            S24 reset-active-device confirm

Accordion item
  variants  FAQ question, filter group header
  states    collapsed, expanded, focus-visible
  tokens    header text/base/500, chevron rotates 180° on expand
            (motion-base), body text-muted/sm
  a11y      button header with aria-expanded, body has aria-hidden when
            collapsed
  used on   S17 support/FAQ, S06 filter group headers
```

## Navigation

```
Nav sidebar
  variants  expanded (240px), collapsed (icon rail, 64px)
  states    item: default (text-muted), hover (bg surface), active (bg
            surface + 3px accent left border + text text — not the
            original's full maroon-glow fill; see note below), locked
            (lock icon, 60% opacity — e.g. an unpurchased add-on)
  tokens    bg bg, border-right border, item radius md, item padding
            space-3/space-4
  a11y      <nav> with aria-current="page" on the active link; collapse
            toggle has an accessible label, not icon-only
  used on   every dashboard screen

  Note: the original fills the active nav item with a full accent-tinted
  background plus a bottom-of-sidebar accent glow behind the account chip.
  That glow is a brand flourish (trade dress), not a usability pattern —
  the clone uses a simple left-border indicator instead and gets its own
  flourish from replica-brand once the palette is final.
```

## Dashboard-specific

```
Stat tile
  variants  single metric (My Products counts), metric + trend (not
            observed, reserved for later)
  states    default, loading (skeleton)
  tokens    bg surface, border border, radius lg, label text-muted/sm,
            value xl/700
  used on   S26 My Products, S27 Billing summary

Quick action row
  variants  icon + title + subtitle, with chevron/external-link affordance
  states    default, hover (bg lightens one step), focus-visible
  tokens    bg surface (nested one level — see "nested surface" note),
            radius md
  used on   S03 dashboard home

  Note on nesting: the original achieves a second depth of "card inside a
  card" (e.g. the Quick Actions rows inside the Quick Actions panel) with a
  slightly lighter fill, not a new named color. The clone does the same:
  nested rows get surface + a 1px border, no new token.

Account-link card (PSN / Xbox)
  variants  not-linked (connect CTA), linked (avatar + display name +
            unlink), token-expired (warning row + reconnect CTA)
  tokens    bg surface, border border, platform icon in brand-neutral chip
  used on   S13 integrations settings (kept), S25 Xbox gate (kept as the
            upsell shell; Party Chat/Gamertag Resolver items inside it are
            not — see recon.md skip list)

Rule card (Traffic Control, own-device only)
  variants  one per action: drop, lag/delay, throttle, reorder, duplicate
  states    idle, running (live stat counters update), paused, invalid
            (target isn't one of the machine's own interface addresses —
            rejected at the form level, not just a warning)
  tokens    bg surface, border border, action icon in accent-tinted chip,
            live counters mono/sm
  a11y      emergency-stop button is always reachable by keyboard and has
            its own distinct danger styling, never grouped visually with
            the start/pause controls
  used on   S10

Stat counter (live)
  variants  packets processed, dropped, delayed, reordered, duplicated
  states    live-updating (aria-live="polite", throttled to avoid spamming
            screen readers on fast counters)
  tokens    value mono/lg, label text-muted/xs
  used on   S05 capture stats, S10 traffic-control stats

Filter toggle switch
  variants  built-in (read-only source badge), custom (editable)
  states    on, off, syncing (spinner replaces thumb briefly)
  tokens    track bg surface when off / accent when on, thumb on-accent
  a11y      role="switch" with aria-checked, not a bare checkbox restyled
            without the role
  used on   S06, S09

Theme / accent picker
  variants  theme: 3 swatches (ultra-dark, dark, light); accent: color
            swatch grid
  states    selected (ring in accent color + check icon), hover
  tokens    swatch radius pill, selected ring 2px accent
  used on   S14 settings
```

## Not specced (skip)

No component spec for the Gamertag Resolver's result row, the Username AI
"decrypt" animation/state, or the Traffic Control player-targeting picker
(an IP-from-capture-table selector feeding a rule) — these only exist to
support the skipped features in `recon.md`/`features.csv` and have no clone
screen to appear on.

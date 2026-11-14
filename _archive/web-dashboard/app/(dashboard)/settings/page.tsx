// S14 — theme, accent, language, 2FA.
import { Card } from "@/components/ui/Card";
import { TwoFactorCard } from "./TwoFactorCard";
import { AccountActions } from "./AccountActions";
import { getProfile, type Theme } from "@/lib/data";

const THEMES: { id: Theme; label: string }[] = [
  { id: "ultra_dark", label: "Ultra dark" },
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
];

const ACCENTS = ["#3a5ce0", "#2fae63", "#e5484d", "#d98f2a", "#a855f7"];

const LANGUAGES: { id: string; label: string }[] = [
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
  { id: "fr", label: "Français" },
  { id: "it", label: "Italiano" },
  { id: "pt", label: "Português" },
  { id: "ru", label: "Русский" },
  { id: "ar", label: "العربية" },
];

export default async function SettingsPage() {
  const profile = await getProfile();
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-text">Settings</h1>
        <p className="mt-1 text-sm text-muted">Appearance, language, and account security.</p>
      </div>

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold text-text">Theme</h2>
        <div role="radiogroup" aria-label="Theme" className="flex gap-3">
          {THEMES.map((t) => (
            <label
              key={t.id}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-border-input px-3 py-2 text-sm text-text has-[:checked]:border-accent has-[:checked]:ring-2 has-[:checked]:ring-accent"
            >
              <input type="radio" name="theme" value={t.id} defaultChecked={profile.theme === t.id} className="sr-only" />
              {t.label}
            </label>
          ))}
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold text-text">Accent color</h2>
        <div role="radiogroup" aria-label="Accent color" className="flex gap-3">
          {ACCENTS.map((c) => (
            <label key={c} className="relative">
              <input type="radio" name="accent" value={c} defaultChecked={c === profile.accentColor} className="peer sr-only" />
              <span
                style={{ backgroundColor: c }}
                aria-hidden="true"
                className="block h-8 w-8 rounded-pill ring-offset-2 ring-offset-bg peer-checked:ring-2 peer-checked:ring-accent cursor-pointer"
              />
              <span className="sr-only">Use this accent color</span>
            </label>
          ))}
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold text-text">Language</h2>
        <select
          aria-label="Language"
          defaultValue={profile.language}
          className="h-10 rounded-md border border-border-input bg-surface px-3 text-sm text-text"
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </Card>

      <TwoFactorCard enabled={profile.twoFactorEnabled} />
      <AccountActions />
    </div>
  );
}

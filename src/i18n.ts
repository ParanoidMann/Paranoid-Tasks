// UI strings live in src/locales/<language>.json; en.json is the reference
// and the fallback. Must not import "obsidian" so it can be used from tests.
import en from "./locales/en.json";
import ru from "./locales/ru.json";

export type TranslationKey = keyof typeof en;
type Translations = Record<TranslationKey, string>;

/** Typed so that a locale missing a key fails the build. */
const LOCALES: Record<string, Translations> = {
	en,
	ru: ru satisfies Translations,
};

export const LANGUAGES = ["en", "ru"] as const;
export type Language = (typeof LANGUAGES)[number];

let current: Translations = en;

/** Switches the UI language; unknown languages fall back to English. */
export function setLanguage(language: string): void {
	current = LOCALES[language] ?? en;
}

/** Translated string with `{name}` placeholders replaced from `vars`. */
export function t(key: TranslationKey, vars: Record<string, string | number> = {}): string {
	let text = current[key] ?? en[key];
	for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
	return text;
}

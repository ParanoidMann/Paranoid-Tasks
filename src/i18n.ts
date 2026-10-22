// UI strings live in src/locales/<language>.json; en.json is the reference
// and the fallback. Must not import "obsidian" so it can be used from tests.
import en from "./locales/en.json";
import ru from "./locales/ru.json";
import de from "./locales/de.json";

export type TranslationKey = keyof typeof en;
type Translations = Record<TranslationKey, string>;

/** Typed so that a locale missing a key fails the build. */
const LOCALES: Record<string, Translations> = {
	en,
	ru: ru satisfies Translations,
	de: de satisfies Translations,
};

export const LANGUAGES = ["en", "ru", "de"] as const;
export type Language = (typeof LANGUAGES)[number];

let current: Translations = en;
let currentLanguage = "en";

/** Switches the UI language; unknown languages fall back to English. */
export function setLanguage(language: string): void {
	currentLanguage = LOCALES[language] ? language : "en";
	current = LOCALES[currentLanguage];
}

/** A YYYY-MM-DD date in the UI language, e.g. "Oct 30, 2026" / "30 окт. 2026 г.". */
export function formatDate(date: string): string {
	const [y, m, d] = date.split("-").map(Number);
	return new Date(y, m - 1, d).toLocaleDateString(currentLanguage, { day: "numeric", month: "short", year: "numeric" });
}

/** Translated string with `{name}` placeholders replaced from `vars`. */
export function t(key: TranslationKey, vars: Record<string, string | number> = {}): string {
	let text = current[key] ?? en[key];
	for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
	return text;
}

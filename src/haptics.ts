import { Platform } from "obsidian";

interface HapticsPlugin {
	impact(options: { style: "LIGHT" | "MEDIUM" | "HEAVY" }): Promise<void>;
}

/**
 * A very short vibration on phones, to mark an important action (removing or deleting a task).
 * Uses the Capacitor Haptics plugin of Obsidian's mobile app (the only way on iOS, which has no
 * navigator.vibrate) and falls back to navigator.vibrate. Does nothing on desktop or if unavailable.
 */
export function hapticTap(): void {
	if (!Platform.isMobile) return;
	const haptics = (window as unknown as { Capacitor?: { Plugins?: { Haptics?: HapticsPlugin } } }).Capacitor?.Plugins
		?.Haptics;
	if (haptics) {
		haptics.impact({ style: "LIGHT" }).catch(() => navigator.vibrate?.(10));
	} else {
		navigator.vibrate?.(10);
	}
}

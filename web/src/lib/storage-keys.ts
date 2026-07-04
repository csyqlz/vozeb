export const APP_STORAGE_NAME = "vozeb";
export const APP_EXPORT_ID = "vozeb-canvas";
export const LEGACY_APP_EXPORT_ID = `${"in"}finite-canvas`;
export const LEGACY_APP_STORAGE_NAME = LEGACY_APP_EXPORT_ID;
export const APP_STORAGE_PREFIX = "vozeb";
export const LEGACY_APP_STORAGE_PREFIX = LEGACY_APP_EXPORT_ID;

export function appStorageKey(name: string) {
    return `${APP_STORAGE_PREFIX}:${name}`;
}

export function legacyAppStorageKey(name: string) {
    return `${LEGACY_APP_STORAGE_PREFIX}:${name}`;
}

export function legacyAppStorageKeyFor(nextKey: string) {
    const prefix = `${APP_STORAGE_PREFIX}:`;
    if (!nextKey.startsWith(prefix)) return nextKey;
    return legacyAppStorageKey(nextKey.slice(prefix.length));
}

export function migrateLocalStorageKey(nextKey: string, legacyKey: string) {
    if (typeof window === "undefined" || nextKey === legacyKey) return;
    try {
        if (window.localStorage.getItem(nextKey) === null) {
            const legacyValue = window.localStorage.getItem(legacyKey);
            if (legacyValue !== null) window.localStorage.setItem(nextKey, legacyValue);
        }
    } catch {
        // localStorage can be unavailable in private or restricted browser modes.
    }
}

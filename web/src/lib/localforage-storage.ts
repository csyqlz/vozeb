import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

import { APP_STORAGE_NAME, LEGACY_APP_STORAGE_NAME, legacyAppStorageKeyFor } from "@/lib/storage-keys";

localforage.config({
    name: APP_STORAGE_NAME,
    storeName: "app_state",
});

const legacyLocalforage = localforage.createInstance({ name: LEGACY_APP_STORAGE_NAME, storeName: "app_state" });

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        try {
            const value = (await localforage.getItem<string>(name)) || null;
            if (value) return value;
            const legacyValue = (await legacyLocalforage.getItem<string>(legacyAppStorageKeyFor(name))) || (await legacyLocalforage.getItem<string>(name)) || null;
            if (legacyValue) await localforage.setItem(name, legacyValue);
            return legacyValue;
        } catch {
            return window.localStorage.getItem(name);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.setItem(name, value);
        } catch {
            window.localStorage.setItem(name, value);
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.removeItem(name);
        } catch {
            window.localStorage.removeItem(name);
        }
    },
};

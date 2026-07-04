import { create } from "zustand";
import { persist } from "zustand/middleware";

import { appStorageKey, legacyAppStorageKey, migrateLocalStorageKey } from "@/lib/storage-keys";

export type ThemeName = "light" | "dark";

type ThemeStore = {
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
};

const THEME_STORE_KEY = appStorageKey("theme_store");
migrateLocalStorageKey(THEME_STORE_KEY, legacyAppStorageKey("theme_store"));

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            theme: "light",
            setTheme: (theme) => set({ theme }),
        }),
        { name: THEME_STORE_KEY },
    ),
);

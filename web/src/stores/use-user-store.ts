"use client";

import { create } from "zustand";

export type LocalUser = {
    id: string;
    username: string;
    email?: string;
    displayName: string;
    avatarUrl?: string;
    role: "admin" | "user";
    status: "active" | "disabled";
    pointsBalance: number;
    checkedInToday: boolean;
    lastCheckInDate?: string;
};

type UserStore = {
    user: LocalUser | null;
    setUser: (user: LocalUser | null) => void;
    clearSession: () => void;
};

export const useUserStore = create<UserStore>()((set) => ({
    user: null,
    setUser: (user) => set({ user }),
    clearSession: () => set({ user: null }),
}));

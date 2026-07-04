import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AuthUserHydrator } from "@/components/auth/auth-user-hydrator";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { getCurrentUser } from "@/lib/auth/session";

export default async function UserLayout({ children }: { children: ReactNode }) {
    const user = await getCurrentUser();
    if (!user) redirect("/login");

    return (
        <AuthUserHydrator
            user={{ id: user.id, username: user.username, email: user.email, displayName: user.displayName, role: user.role, status: user.status, pointsBalance: user.pointsBalance, checkedInToday: user.checkedInToday, lastCheckInDate: user.lastCheckInDate }}
        >
            <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
        </AuthUserHydrator>
    );
}

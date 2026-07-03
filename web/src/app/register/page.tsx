import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { getAuthSettings, listPublicUsers } from "@/lib/auth/store";
import { getCurrentUser } from "@/lib/auth/session";

type RegisterPageProps = {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
    const params = searchParams ? await searchParams : {};
    const nextPath = safeNextPath(firstValue(params.next));
    const [user, settings, users] = await Promise.all([getCurrentUser(), getAuthSettings(), listPublicUsers()]);
    if (user) redirect(nextPath);

    const firstUser = users.length === 0;
    return <AuthForm mode="register" nextPath={nextPath} registrationEnabled={settings.registrationEnabled || firstUser} emailRegistrationEnabled={!firstUser && settings.emailRegistrationEnabled} firstUser={firstUser} />;
}

function firstValue(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
}

function safeNextPath(value: string | undefined) {
    return value?.startsWith("/") && !value.startsWith("//") ? value : "/canvas";
}

import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { getCurrentUser } from "@/lib/auth/session";

type LoginPageProps = {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
    const params = searchParams ? await searchParams : {};
    const nextPath = safeNextPath(firstValue(params.next));
    const authError = authErrorMessage(firstValue(params.error));
    const user = await getCurrentUser();
    if (user) redirect(nextPath);

    return <AuthForm mode="login" nextPath={nextPath} authError={authError} />;
}

function firstValue(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
}

function safeNextPath(value: string | undefined) {
    return value?.startsWith("/") && !value.startsWith("//") ? value : "/canvas";
}

function authErrorMessage(value: string | undefined) {
    if (!value) return "";
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

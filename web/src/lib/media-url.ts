const ABSOLUTE_OR_SPECIAL_URL_RE = /^[a-z][a-z\d+.-]*:/i;

export function resolveGeneratedMediaUrl(value: string, baseUrl?: string | null) {
    const mediaUrl = value.trim();
    if (!mediaUrl || ABSOLUTE_OR_SPECIAL_URL_RE.test(mediaUrl)) return mediaUrl;

    const base = parseBaseUrl(baseUrl);
    if (!base) return mediaUrl;

    try {
        // Leading-slash result URLs belong to the upstream API host, not the app host.
        if (mediaUrl.startsWith("/")) return new URL(mediaUrl, base.origin).toString();
        return new URL(mediaUrl, directoryBaseUrl(base)).toString();
    } catch {
        return mediaUrl;
    }
}

function parseBaseUrl(baseUrl?: string | null) {
    const value = baseUrl?.trim();
    if (!value) return null;
    try {
        return new URL(value);
    } catch {
        if (typeof window === "undefined") return null;
        try {
            return new URL(value, window.location.origin);
        } catch {
            return null;
        }
    }
}

function directoryBaseUrl(url: URL) {
    if (url.pathname.endsWith("/")) return url.toString();
    const next = new URL(url.toString());
    next.pathname = next.pathname.replace(/\/[^/]*$/, "/");
    next.search = "";
    next.hash = "";
    return next.toString();
}

"use client";

import localforage from "localforage";

import { nanoid } from "nanoid";
import { browserReadableMediaUrl } from "@/lib/browser-media-url";
import { readImageMeta } from "@/lib/image-utils";
import { APP_STORAGE_NAME, LEGACY_APP_STORAGE_NAME } from "@/lib/storage-keys";

export type UploadedImage = {
    url: string;
    storageKey: string;
    remoteUrl?: string;
    serverUrl?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const store = localforage.createInstance({ name: APP_STORAGE_NAME, storeName: "image_files" });
const legacyStore = localforage.createInstance({ name: LEGACY_APP_STORAGE_NAME, storeName: "image_files" });
const objectUrls = new Map<string, string>();

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const blob = typeof input === "string" ? await fetchImageBlob(input) : input;
    const storageKey = `image:${nanoid()}`;
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = await readImageMeta(url);
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return browserReadableMediaUrl(fallback);
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    let blob = await store.getItem<Blob>(storageKey);
    if (!blob) {
        blob = await legacyStore.getItem<Blob>(storageKey);
        if (blob) await store.setItem(storageKey, blob);
    }
    if (!blob) return browserReadableMediaUrl(fallback);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function resolveStoredImageDataUrl(storageKey?: string, fallback = "") {
    const blob = storageKey ? await getImageBlob(storageKey) : null;
    if (!blob) return fallback ? safeFallbackImageDataUrl(fallback) : fallback;
    return blobToDataUrl(blob);
}

export async function getImageBlob(storageKey: string) {
    const blob = await store.getItem<Blob>(storageKey);
    if (blob) return blob;
    const legacyBlob = await legacyStore.getItem<Blob>(storageKey);
    if (legacyBlob) await store.setItem(storageKey, legacyBlob);
    return legacyBlob;
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const stored = image.storageKey ? await resolveStoredImageDataUrl(image.storageKey, "") : "";
    if (stored) return stored;
    const candidates = uniqueImageSources([image.dataUrl, image.url]);
    let fallback = "";
    for (const url of candidates) {
        if (!url || url.startsWith("data:")) return url;
        fallback ||= browserReadableMediaUrl(url);
        try {
            return await fetchImageAsDataUrl(url);
        } catch {
            // A stale blob URL should not block the remote/server fallback.
        }
    }
    return fallback;
}

function uniqueImageSources(values: Array<string | undefined>) {
    return Array.from(new Set(values.map((value) => (value || "").trim()).filter(Boolean)));
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
            await legacyStore.removeItem(key);
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}

async function fetchImageBlob(url: string) {
    const response = await fetch(browserReadableMediaUrl(url), { cache: "no-store" });
    if (!response.ok) throw new Error("读取图片失败");
    return response.blob();
}

async function fetchImageAsDataUrl(url: string) {
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await fetchImageBlob(url));
}

async function safeFallbackImageDataUrl(url: string) {
    try {
        return await fetchImageAsDataUrl(url);
    } catch {
        return browserReadableMediaUrl(url);
    }
}

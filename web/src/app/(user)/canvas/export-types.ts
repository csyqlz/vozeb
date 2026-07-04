import type { CanvasProject } from "./stores/use-canvas-store";
import { APP_EXPORT_ID, LEGACY_APP_EXPORT_ID } from "@/lib/storage-keys";

export type CanvasExportFile = {
    app: typeof APP_EXPORT_ID | typeof LEGACY_APP_EXPORT_ID;
    version: 3;
    exportedAt: string;
    projects: CanvasProjectExportItem[];
};

export type CanvasProjectExportItem = {
    project: CanvasProject;
    files: CanvasExportAsset[];
};

export type CanvasExportAsset = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

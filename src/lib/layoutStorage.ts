import type { GalleryLayouts, GalleryRoomConfig } from "../types";

const LAYOUT_STORAGE_KEY = "image-hang.gallery-layouts";
const ROOM_STORAGE_KEY = "image-hang.room-config";

export const defaultRoomConfig: GalleryRoomConfig = {
  width: 18,
  depth: 22,
  height: 5.2,
};

export function loadStoredLayouts(): GalleryLayouts {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GalleryLayouts) : {};
  } catch {
    return {};
  }
}

export function saveStoredLayouts(layouts: GalleryLayouts) {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layouts));
}

export function clearStoredLayouts() {
  localStorage.removeItem(LAYOUT_STORAGE_KEY);
}

export function loadStoredRoomConfig(): GalleryRoomConfig {
  try {
    const raw = localStorage.getItem(ROOM_STORAGE_KEY);

    if (!raw) {
      return defaultRoomConfig;
    }

    const parsed = JSON.parse(raw) as GalleryRoomConfig;

    return {
      width: Number.isFinite(parsed.width) ? parsed.width : defaultRoomConfig.width,
      depth: Number.isFinite(parsed.depth) ? parsed.depth : defaultRoomConfig.depth,
      height: Number.isFinite(parsed.height) ? parsed.height : defaultRoomConfig.height,
    };
  } catch {
    return defaultRoomConfig;
  }
}

export function saveStoredRoomConfig(config: GalleryRoomConfig) {
  localStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify(config));
}

export function clearStoredRoomConfig() {
  localStorage.removeItem(ROOM_STORAGE_KEY);
}

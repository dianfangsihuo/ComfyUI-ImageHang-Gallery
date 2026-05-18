import type { GalleryLayouts } from "../types";

const LAYOUT_STORAGE_KEY = "image-hang.gallery-layouts";

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

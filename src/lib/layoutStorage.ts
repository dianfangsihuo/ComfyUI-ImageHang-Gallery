import type {
  EditorSettings,
  GalleryCustomWall,
  GalleryDoor,
  GalleryLayouts,
  GalleryRoomConfig,
} from "../types";

const LAYOUT_STORAGE_KEY = "image-hang.gallery-layouts";
const ROOM_STORAGE_KEY = "image-hang.room-config";
const WALL_STORAGE_KEY = "image-hang.custom-walls";
const DOOR_STORAGE_KEY = "image-hang.doors";
const SETTINGS_STORAGE_KEY = "image-hang.editor-settings";

export const defaultRoomConfig: GalleryRoomConfig = {
  width: 18,
  depth: 22,
  height: 5.2,
  roomCount: 1,
};

export const defaultEditorSettings: EditorSettings = {
  shortcuts: {
    openMarket: "KeyB",
    toggleView: "KeyV",
    moveTool: "KeyG",
    rotateTool: "KeyR",
    scaleTool: "KeyS",
    nudgeLeft: "KeyJ",
    nudgeRight: "KeyL",
    nudgeForward: "KeyI",
    nudgeBackward: "KeyK",
    rotateLeft: "KeyQ",
    rotateRight: "KeyE",
    scaleUp: "Equal",
    scaleDown: "Minus",
    grabSelection: "KeyF",
    deleteSelection: "Delete",
  },
  mouseSensitivity: 0.0024,
  walkSpeed: 4.2,
  sprintSpeed: 7.1,
  jumpPower: 5.4,
};

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

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
      roomCount: Number.isFinite(parsed.roomCount)
        ? Math.min(5, Math.max(1, Math.round(parsed.roomCount)))
        : defaultRoomConfig.roomCount,
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

export function loadStoredCustomWalls(): GalleryCustomWall[] {
  try {
    const raw = localStorage.getItem(WALL_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GalleryCustomWall[]) : [];
  } catch {
    return [];
  }
}

export function saveStoredCustomWalls(walls: GalleryCustomWall[]) {
  localStorage.setItem(WALL_STORAGE_KEY, JSON.stringify(walls));
}

export function clearStoredCustomWalls() {
  localStorage.removeItem(WALL_STORAGE_KEY);
}

export function loadStoredDoors(): GalleryDoor[] {
  try {
    const raw = localStorage.getItem(DOOR_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GalleryDoor[]) : [];
  } catch {
    return [];
  }
}

export function saveStoredDoors(doors: GalleryDoor[]) {
  localStorage.setItem(DOOR_STORAGE_KEY, JSON.stringify(doors));
}

export function clearStoredDoors() {
  localStorage.removeItem(DOOR_STORAGE_KEY);
}

export function loadStoredEditorSettings(): EditorSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);

    if (!raw) {
      return defaultEditorSettings;
    }

    const parsed = JSON.parse(raw) as Partial<EditorSettings>;

    return {
      shortcuts: {
        ...defaultEditorSettings.shortcuts,
        ...(parsed.shortcuts ?? {}),
      },
      mouseSensitivity: clampNumber(
        parsed.mouseSensitivity,
        defaultEditorSettings.mouseSensitivity,
        0.0008,
        0.006,
      ),
      walkSpeed: clampNumber(parsed.walkSpeed, defaultEditorSettings.walkSpeed, 1.5, 9),
      sprintSpeed: clampNumber(parsed.sprintSpeed, defaultEditorSettings.sprintSpeed, 2.5, 14),
      jumpPower: clampNumber(parsed.jumpPower, defaultEditorSettings.jumpPower, 2.5, 9),
    };
  } catch {
    return defaultEditorSettings;
  }
}

export function saveStoredEditorSettings(settings: EditorSettings) {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function clearStoredEditorSettings() {
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
}

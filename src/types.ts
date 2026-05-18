export type GalleryImageSource = "local" | "supabase" | "sample";
export type AppMode = "view" | "edit";
export type GalleryWall = "north" | "south" | "west" | "east";

export interface GalleryImage {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  createdAt: string;
  source: GalleryImageSource;
}

export interface UploadResult {
  image: GalleryImage;
  warning?: string;
}

export interface GalleryFrameLayout {
  wall: GalleryWall;
  offset: number;
  height: number;
  width: number;
}

export type GalleryLayouts = Record<string, GalleryFrameLayout>;

export interface GalleryRoomConfig {
  width: number;
  depth: number;
  height: number;
}

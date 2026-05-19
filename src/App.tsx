import {
  Eye,
  DoorOpen,
  ImagePlus,
  Loader2,
  Maximize2,
  Move,
  Pencil,
  Plus,
  RotateCcw,
  Ruler,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import GalleryScene, { getDefaultLayout } from "./components/GalleryScene";
import {
  clearStoredImages,
  createGalleryImage,
  isSupabaseConfigured,
  loadStoredImages,
  removeStoredImage,
  revokeImageUrl,
} from "./lib/galleryStorage";
import {
  clearStoredLayouts,
  clearStoredRoomConfig,
  clearStoredCustomWalls,
  clearStoredDoors,
  defaultRoomConfig,
  loadStoredCustomWalls,
  loadStoredDoors,
  loadStoredLayouts,
  loadStoredRoomConfig,
  saveStoredCustomWalls,
  saveStoredDoors,
  saveStoredLayouts,
  saveStoredRoomConfig,
} from "./lib/layoutStorage";
import { createSampleImages } from "./lib/sampleArt";
import type {
  AppMode,
  EditorTransformTool,
  EditorViewMode,
  GalleryCustomWall,
  GalleryDoor,
  GalleryFrameLayout,
  GalleryImage,
  GalleryLayouts,
  GalleryRoomConfig,
  GalleryWall,
  GalleryWallTarget,
} from "./types";

type EditableSelection =
  | { type: "artwork"; id: string }
  | { type: "wall"; id: string }
  | { type: "door"; id: string }
  | { type: "room"; roomIndex: number };

const wallLabels: Record<GalleryWall, string> = {
  north: "前墙",
  south: "后墙",
  west: "左墙",
  east: "右墙",
};

const builtWallOptions = Object.entries(wallLabels) as Array<[GalleryWall, string]>;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseBuiltWallTarget(target: GalleryWallTarget) {
  if (target === "north" || target === "south" || target === "west" || target === "east") {
    return { roomIndex: 0, wall: target as GalleryWall };
  }

  const match = String(target).match(/^room-(\d+):(north|south|west|east)$/);
  if (!match) {
    return null;
  }

  return { roomIndex: Number(match[1]), wall: match[2] as GalleryWall };
}

function builtWallTarget(roomIndex: number, wall: GalleryWall): GalleryWallTarget {
  return roomIndex === 0 ? wall : `room-${roomIndex}:${wall}`;
}

function getWallLength(room: GalleryRoomConfig, wall: GalleryWall) {
  return wall === "north" || wall === "south" ? room.width : room.depth;
}

function getWallTargetLength(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  target: GalleryWallTarget,
) {
  const built = parseBuiltWallTarget(target);

  if (built) {
    return getWallLength(room, built.wall);
  }

  return customWalls.find((wall) => wall.id === target)?.length ?? room.width;
}

function getWallTargetHeight(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  target: GalleryWallTarget,
) {
  return customWalls.find((wall) => wall.id === target)?.height ?? room.height;
}

function getWallOffsetLimit(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  target: GalleryWallTarget,
) {
  return Math.max(2.2, getWallTargetLength(room, customWalls, target) / 2 - 1.8);
}

function getDefaultFrameWidth(image: GalleryImage) {
  const aspect = image.width / image.height || 1.42;
  return Math.min(3.4, Math.max(2.15, aspect * 2.15));
}

function calculateGalleryCapacity(
  room: GalleryRoomConfig,
  customWalls: GalleryCustomWall[],
  images: GalleryImage[],
  layouts: GalleryLayouts,
) {
  const horizontalGap = 0.7;
  const verticalGap = 0.55;
  const averageWidth =
    images.length > 0
      ? images.reduce(
          (sum, image) => sum + (layouts[image.id]?.width ?? getDefaultFrameWidth(image)),
          0,
        ) / images.length
      : 3;
  const averageAspect =
    images.length > 0
      ? images.reduce((sum, image) => sum + (image.width / image.height || 1.42), 0) /
        images.length
      : 1.42;
  const averageHeight = averageWidth / averageAspect;
  const usableHeight = Math.max(0, room.height - 1.4 - 0.85);
  const rows = Math.max(1, Math.floor((usableHeight + verticalGap) / (averageHeight + verticalGap)));

  const builtinTargets = Array.from({ length: room.roomCount }, (_, roomIndex) =>
    builtWallOptions.map(([wall]) => builtWallTarget(roomIndex, wall)),
  ).flat();
  const allTargets = [...builtinTargets, ...customWalls.map((wall) => wall.id)];

  return allTargets.reduce((total, target) => {
    const usableLength = Math.max(0, getWallTargetLength(room, customWalls, target) - 2.4);
    const columns = Math.max(
      0,
      Math.floor((usableLength + horizontalGap) / (averageWidth + horizontalGap)),
    );

    return total + columns * rows;
  }, 0);
}

function App() {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [layouts, setLayouts] = useState<GalleryLayouts>(() => loadStoredLayouts());
  const [roomConfig, setRoomConfig] = useState<GalleryRoomConfig>(() => loadStoredRoomConfig());
  const [customWalls, setCustomWalls] = useState<GalleryCustomWall[]>(() =>
    loadStoredCustomWalls(),
  );
  const [doors, setDoors] = useState<GalleryDoor[]>(() => loadStoredDoors());
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedDoorId, setSelectedDoorId] = useState<string | null>(null);
  const [selectedRoomIndex, setSelectedRoomIndex] = useState(0);
  const [selectedObject, setSelectedObject] = useState<EditableSelection | null>(null);
  const [transformTool, setTransformTool] = useState<EditorTransformTool>("move");
  const [pendingPlacementIds, setPendingPlacementIds] = useState<string[]>([]);
  const [mode, setMode] = useState<AppMode>("view");
  const [editorViewMode, setEditorViewMode] = useState<EditorViewMode>("topdown");
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<GalleryImage[]>([]);
  const samples = useMemo(() => createSampleImages(), []);
  const sceneImages = images.length > 0 ? images : samples;
  const placedSceneImages = sceneImages.filter(
    (image) => !pendingPlacementIds.includes(image.id) || layouts[image.id],
  );
  const selectedIndex = sceneImages.findIndex((image) => image.id === selectedImageId);
  const selectedImage = selectedIndex >= 0 ? sceneImages[selectedIndex] : undefined;
  const selectedLayout =
    selectedImage &&
    (layouts[selectedImage.id] ??
      getDefaultLayout(selectedImage, Math.max(selectedIndex, 0), roomConfig));
  const capacity = useMemo(
    () => calculateGalleryCapacity(roomConfig, customWalls, sceneImages, layouts),
    [customWalls, layouts, roomConfig, sceneImages],
  );
  const remainingCapacity = Math.max(0, capacity - sceneImages.length);
  const supabaseReady = isSupabaseConfigured();

  function switchMode(nextMode: AppMode) {
    setMode(nextMode);

    if (nextMode === "view") {
      setSelectedImageId(null);
      setSelectedWallId(null);
      setSelectedDoorId(null);
      setSelectedObject(null);
    }
  }

  function selectArtwork(id: string) {
    setSelectedObject({ type: "artwork", id });
    setSelectedImageId(id);
    setSelectedWallId(null);
    setSelectedDoorId(null);
  }

  function selectWall(id: string) {
    setSelectedObject({ type: "wall", id });
    setSelectedWallId(id);
    setSelectedImageId(null);
    setSelectedDoorId(null);
  }

  function selectDoor(id: string) {
    setSelectedObject({ type: "door", id });
    setSelectedDoorId(id);
    setSelectedImageId(null);
    setSelectedWallId(null);
  }

  function selectRoom(roomIndex: number) {
    setSelectedObject({ type: "room", roomIndex });
    setSelectedRoomIndex(roomIndex);
    setSelectedImageId(null);
    setSelectedWallId(null);
    setSelectedDoorId(null);
  }

  useEffect(() => {
    let isMounted = true;

    void loadStoredImages()
      .then((storedImages) => {
        if (isMounted) {
          setImages(storedImages);
        } else {
          storedImages.forEach(revokeImageUrl);
        }
      })
      .catch(() => {
        if (isMounted) {
          setMessage("读取本地画廊失败");
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    saveStoredLayouts(layouts);
  }, [layouts]);

  useEffect(() => {
    saveStoredRoomConfig(roomConfig);
  }, [roomConfig]);

  useEffect(() => {
    saveStoredCustomWalls(customWalls);
  }, [customWalls]);

  useEffect(() => {
    saveStoredDoors(doors);
  }, [doors]);

  useEffect(() => {
    setSelectedRoomIndex((current) => clamp(Math.round(current), 0, roomConfig.roomCount - 1));
  }, [roomConfig.roomCount]);

  useEffect(() => {
    if (selectedObject?.type === "artwork" && !sceneImages.some((image) => image.id === selectedObject.id)) {
      setSelectedObject(null);
      setSelectedImageId(null);
    }
  }, [sceneImages, selectedObject]);

  useEffect(
    () => () => {
      imagesRef.current.forEach(revokeImageUrl);
    },
    [],
  );

  async function handleFiles(files: FileList | null) {
    const fileArray = Array.from(files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );

    if (fileArray.length === 0) {
      setMessage("请选择图片文件");
      return;
    }

    setIsUploading(true);
    setMessage("");

    try {
      const results = await Promise.all(fileArray.map(createGalleryImage));
      const uploadedImages = results.map((result) => result.image);
      setImages((current) => [...uploadedImages, ...current]);
      if (uploadedImages[0]) {
        selectArtwork(uploadedImages[0].id);
      }
      const warning = results.find((result) => result.warning)?.warning;

      if (mode === "edit") {
        setPendingPlacementIds((current) => [...current, ...uploadedImages.map((image) => image.id)]);
        setMessage(warning ?? `已导入 ${results.length} 张图片，请点击墙面指定挂画位置`);
      } else {
        setMessage(warning ?? `已添加 ${results.length} 张图片`);
      }
    } catch (error) {
      const fallback =
        error instanceof Error ? error.message : "图片处理失败，请换一张图片试试";
      setMessage(fallback);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function removeImage(id: string) {
    const image = images.find((item) => item.id === id);
    setImages((current) => current.filter((item) => item.id !== id));
    if (image) {
      revokeImageUrl(image);
    }
    await removeStoredImage(id);
    setLayouts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function resetGallery() {
    const previousImages = images;
    await clearStoredImages();
    clearStoredLayouts();
    clearStoredRoomConfig();
    clearStoredCustomWalls();
    clearStoredDoors();
    previousImages.forEach(revokeImageUrl);
    setImages([]);
    setLayouts({});
    setRoomConfig(defaultRoomConfig);
    setCustomWalls([]);
    setDoors([]);
    setPendingPlacementIds([]);
    setSelectedImageId(null);
    setSelectedWallId(null);
    setSelectedDoorId(null);
    setSelectedRoomIndex(0);
    setSelectedObject(null);
    setMessage("已恢复示例画廊");
  }

  function updateSelectedLayout(patch: Partial<GalleryFrameLayout>) {
    if (!selectedImage || !selectedLayout) {
      return;
    }

    updateImageLayout(selectedImage.id, patch);
  }

  function updateImageLayout(id: string, patch: Partial<GalleryFrameLayout>) {
    const imageIndex = sceneImages.findIndex((image) => image.id === id);
    const image = imageIndex >= 0 ? sceneImages[imageIndex] : undefined;

    if (!image) {
      return;
    }

    const currentLayout =
      layouts[id] ?? getDefaultLayout(image, Math.max(imageIndex, 0), roomConfig);
    const wall = patch.wall ?? currentLayout.wall;
    const limit = getWallOffsetLimit(roomConfig, customWalls, wall);
    const wallHeight = getWallTargetHeight(roomConfig, customWalls, wall);

    setLayouts((current) => ({
      ...current,
      [id]: {
        ...currentLayout,
        ...patch,
        wall,
        offset: clamp(patch.offset ?? currentLayout.offset, -limit, limit),
        height: clamp(patch.height ?? currentLayout.height, 1.1, wallHeight - 1.15),
        width: clamp(patch.width ?? currentLayout.width, 1.2, 5),
      },
    }));
  }

  function updateRoomConfig(patch: Partial<GalleryRoomConfig>) {
    setRoomConfig((current) => {
      const next = {
        width: clamp(patch.width ?? current.width, 12, 36),
        depth: clamp(patch.depth ?? current.depth, 14, 44),
        height: clamp(patch.height ?? current.height, 4.2, 8),
        roomCount: Math.round(clamp(patch.roomCount ?? current.roomCount, 1, 5)),
      };

      setLayouts((currentLayouts) =>
        Object.fromEntries(
          Object.entries(currentLayouts).map(([id, layout]) => {
            const limit = getWallOffsetLimit(next, customWalls, layout.wall);
            const wallHeight = getWallTargetHeight(next, customWalls, layout.wall);

            return [
              id,
              {
                ...layout,
                offset: clamp(layout.offset, -limit, limit),
                height: clamp(layout.height, 1.1, wallHeight - 1.15),
              },
            ];
          }),
        ),
      );

      setCustomWalls((currentWalls) =>
        currentWalls.map((wall) => ({
          ...wall,
          roomIndex: Math.min(wall.roomIndex, next.roomCount - 1),
          x: clamp(wall.x, -next.width / 2 + 1, next.width / 2 - 1),
          z: clamp(wall.z, -next.depth / 2 + 1, next.depth / 2 - 1),
          length: clamp(wall.length, 2, next.width - 1),
          height: clamp(wall.height, 2.2, next.height - 0.35),
        })),
      );
      setDoors((currentDoors) =>
        currentDoors.map((door) => ({
          ...door,
          roomIndex: Math.min(door.roomIndex, next.roomCount - 1),
          offset: clamp(
            door.offset,
            -getWallOffsetLimit(next, customWalls, door.wall),
            getWallOffsetLimit(next, customWalls, door.wall),
          ),
          height: clamp(door.height, 1.9, next.height - 0.5),
        })),
      );

      return next;
    });
  }

  function getWallOptions() {
    const builtin = Array.from({ length: roomConfig.roomCount }, (_, roomIndex) =>
      builtWallOptions.map(([wall, label]) => [
        builtWallTarget(roomIndex, wall),
        roomIndex === 0 ? label : `房间 ${roomIndex + 1} ${label}`,
      ] as [GalleryWallTarget, string]),
    ).flat();

    return [
      ...builtin,
      ...customWalls.map((wall) => [wall.id, `${wall.name}`] as [GalleryWallTarget, string]),
    ];
  }

  function addRoom() {
    updateRoomConfig({ roomCount: roomConfig.roomCount + 1 });
    selectRoom(roomConfig.roomCount);
    setMessage(`已新增房间 ${roomConfig.roomCount + 1}`);
  }

  function deleteRoom(roomIndex: number) {
    if (roomConfig.roomCount <= 1) {
      setMessage("至少需要保留一个房间");
      return;
    }

    const removedWallIds = customWalls
      .filter((wall) => wall.roomIndex === roomIndex)
      .map((wall) => wall.id);
    const removedWallIdSet = new Set(removedWallIds);

    setLayouts((currentLayouts) =>
      Object.fromEntries(
        Object.entries(currentLayouts).flatMap(([id, layout]) => {
          const built = parseBuiltWallTarget(layout.wall);

          if (built) {
            if (built.roomIndex === roomIndex) {
              return [];
            }

            return [
              [
                id,
                {
                  ...layout,
                  wall: builtWallTarget(
                    built.roomIndex > roomIndex ? built.roomIndex - 1 : built.roomIndex,
                    built.wall,
                  ),
                },
              ],
            ];
          }

          if (removedWallIdSet.has(layout.wall)) {
            return [];
          }

          return [[id, layout]];
        }),
      ),
    );
    setCustomWalls((current) =>
      current
        .filter((wall) => wall.roomIndex !== roomIndex)
        .map((wall) => ({
          ...wall,
          roomIndex: wall.roomIndex > roomIndex ? wall.roomIndex - 1 : wall.roomIndex,
        })),
    );
    setDoors((current) =>
      current
        .filter((door) => door.roomIndex !== roomIndex && !removedWallIdSet.has(door.wall))
        .map((door) => ({
          ...door,
          roomIndex: door.roomIndex > roomIndex ? door.roomIndex - 1 : door.roomIndex,
          wall: parseBuiltWallTarget(door.wall)
            ? builtWallTarget(
                Math.max(0, door.roomIndex > roomIndex ? door.roomIndex - 1 : door.roomIndex),
                parseBuiltWallTarget(door.wall)?.wall ?? "north",
              )
            : door.wall,
        })),
    );
    updateRoomConfig({ roomCount: roomConfig.roomCount - 1 });
    selectRoom(Math.max(0, Math.min(roomIndex, roomConfig.roomCount - 2)));
    setMessage(`已删除房间 ${roomIndex + 1}`);
  }

  function addCustomWall() {
    const roomIndex = selectedRoomIndex;
    const wall: GalleryCustomWall = {
      id: `wall-${crypto.randomUUID()}`,
      name: `自定义墙 ${customWalls.length + 1}`,
      roomIndex,
      x: 0,
      z: 0,
      length: Math.min(7, roomConfig.width - 2),
      height: Math.min(roomConfig.height - 0.3, 4.8),
      rotation: 0,
    };

    setCustomWalls((current) => [...current, wall]);
    selectWall(wall.id);
    setMessage(`已新增 ${wall.name}`);
  }

  function updateCustomWall(id: string, patch: Partial<GalleryCustomWall>) {
    setCustomWalls((current) =>
      current.map((wall) =>
        wall.id === id
          ? {
              ...wall,
              ...patch,
              roomIndex: Math.round(clamp(patch.roomIndex ?? wall.roomIndex, 0, roomConfig.roomCount - 1)),
              x: clamp(patch.x ?? wall.x, -roomConfig.width / 2 + 1, roomConfig.width / 2 - 1),
              z: clamp(patch.z ?? wall.z, -roomConfig.depth / 2 + 1, roomConfig.depth / 2 - 1),
              length: clamp(patch.length ?? wall.length, 2, roomConfig.width - 1),
              height: clamp(patch.height ?? wall.height, 2.2, roomConfig.height - 0.35),
              rotation: patch.rotation ?? wall.rotation,
            }
          : wall,
      ),
    );
  }

  function deleteCustomWall(id: string) {
    setCustomWalls((current) => current.filter((wall) => wall.id !== id));
    setDoors((current) => current.filter((door) => door.wall !== id));
    setLayouts((current) =>
      Object.fromEntries(Object.entries(current).filter(([, layout]) => layout.wall !== id)),
    );
    setSelectedObject(null);
    setSelectedWallId(null);
    setMessage("已删除自定义墙壁");
  }

  function getDoorRoomIndex(wall: GalleryWallTarget) {
    const built = parseBuiltWallTarget(wall);

    if (built) {
      return built.roomIndex;
    }

    return customWalls.find((item) => item.id === wall)?.roomIndex ?? selectedRoomIndex;
  }

  function addDoor() {
    const wall = selectedWallId ?? builtWallTarget(selectedRoomIndex, "north");
    const door: GalleryDoor = {
      id: `door-${crypto.randomUUID()}`,
      name: `门 ${doors.length + 1}`,
      roomIndex: getDoorRoomIndex(wall),
      wall,
      offset: 0,
      width: 1.55,
      height: Math.min(2.35, roomConfig.height - 0.6),
    };

    setDoors((current) => [...current, door]);
    selectDoor(door.id);
    setMessage(`已新增 ${door.name}`);
  }

  function updateDoor(id: string, patch: Partial<GalleryDoor>) {
    setDoors((current) =>
      current.map((door) => {
        if (door.id !== id) {
          return door;
        }

        const wall = patch.wall ?? door.wall;
        const roomIndex = getDoorRoomIndex(wall);
        const limit = getWallOffsetLimit(roomConfig, customWalls, wall);

        return {
          ...door,
          ...patch,
          wall,
          roomIndex,
          offset: clamp(patch.offset ?? door.offset, -limit, limit),
          width: clamp(patch.width ?? door.width, 0.8, 3.2),
          height: clamp(patch.height ?? door.height, 1.8, roomConfig.height - 0.4),
        };
      }),
    );
  }

  function deleteDoor(id: string) {
    setDoors((current) => current.filter((door) => door.id !== id));
    setSelectedObject(null);
    setSelectedDoorId(null);
    setMessage("已删除门");
  }

  function deleteSelectedObject() {
    if (!selectedObject) {
      return;
    }

    if (selectedObject.type === "wall") {
      deleteCustomWall(selectedObject.id);
      return;
    }

    if (selectedObject.type === "door") {
      deleteDoor(selectedObject.id);
      return;
    }

    if (selectedObject.type === "room") {
      deleteRoom(selectedObject.roomIndex);
      return;
    }

    if (selectedObject.type === "artwork") {
      void removeImage(selectedObject.id);
      setSelectedObject(null);
      setSelectedImageId(null);
    }
  }

  function nudgeSelectedObject(axis: "x" | "z" | "height", amount: number) {
    if (!selectedObject) {
      return;
    }

    if (selectedObject.type === "artwork" && selectedLayout) {
      updateSelectedLayout(
        axis === "height"
          ? { height: selectedLayout.height + amount }
          : { offset: selectedLayout.offset + amount },
      );
      return;
    }

    if (selectedObject.type === "door" && selectedDoor) {
      updateDoor(
        selectedDoor.id,
        axis === "height"
          ? { height: selectedDoor.height + amount }
          : { offset: selectedDoor.offset + amount },
      );
      return;
    }

    if (selectedObject.type === "wall" && selectedWall) {
      updateCustomWall(selectedWall.id, {
        x: selectedWall.x + (axis === "x" ? amount : 0),
        z: selectedWall.z + (axis === "z" ? amount : 0),
      });
      return;
    }

    if (selectedObject.type === "room") {
      updateRoomConfig(
        axis === "z"
          ? { depth: roomConfig.depth + amount }
          : axis === "height"
            ? { height: roomConfig.height + amount }
            : { width: roomConfig.width + amount },
      );
    }
  }

  function scaleSelectedObject(amount: number) {
    if (!selectedObject) {
      return;
    }

    if (selectedObject.type === "artwork" && selectedLayout) {
      updateSelectedLayout({ width: selectedLayout.width + amount });
      return;
    }

    if (selectedObject.type === "door" && selectedDoor) {
      updateDoor(selectedDoor.id, { width: selectedDoor.width + amount });
      return;
    }

    if (selectedObject.type === "wall" && selectedWall) {
      updateCustomWall(selectedWall.id, { length: selectedWall.length + amount });
      return;
    }

    if (selectedObject.type === "room") {
      updateRoomConfig({
        width: roomConfig.width + amount,
        depth: roomConfig.depth + amount,
      });
    }
  }

  function rotateSelectedObject(amount: number) {
    if (selectedObject?.type === "wall" && selectedWall) {
      updateCustomWall(selectedWall.id, { rotation: selectedWall.rotation + amount });
    }
  }

  function placePendingImage(wall: GalleryWallTarget, offset: number, height: number) {
    const imageId = pendingPlacementIds[0];

    if (!imageId) {
      return;
    }

    const image = images.find((item) => item.id === imageId);
    if (!image) {
      return;
    }

    setLayouts((current) => ({
      ...current,
      [imageId]: {
        wall,
        offset: clamp(offset, -getWallOffsetLimit(roomConfig, customWalls, wall), getWallOffsetLimit(roomConfig, customWalls, wall)),
        height: clamp(height, 1.1, getWallTargetHeight(roomConfig, customWalls, wall) - 1.15),
        width: getDefaultFrameWidth(image),
      },
    }));
    setPendingPlacementIds((current) => current.slice(1));
    selectArtwork(imageId);
    setMessage(pendingPlacementIds.length > 1 ? "已放置图片，请继续点击墙面" : "图片已挂到墙面");
  }

  const wallOptions = getWallOptions();
  const selectedWall = selectedWallId
    ? customWalls.find((wall) => wall.id === selectedWallId)
    : undefined;
  const selectedDoor = selectedDoorId ? doors.find((door) => door.id === selectedDoorId) : undefined;
  const selectedRoomLabel = `房间 ${selectedRoomIndex + 1}`;

  useEffect(() => {
    if (mode !== "edit") {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const isTyping = Boolean(target?.closest("input, textarea, select"));
      const isPointerLocked = document.pointerLockElement !== null;

      if (isTyping && !isPointerLocked) {
        return;
      }

      const handledKeys = new Set([
        "KeyG",
        "KeyR",
        "KeyS",
        "KeyV",
        "KeyQ",
        "KeyE",
        "KeyI",
        "KeyK",
        "KeyJ",
        "KeyL",
        "Equal",
        "NumpadAdd",
        "Minus",
        "NumpadSubtract",
        "Delete",
        "Backspace",
      ]);

      if (!handledKeys.has(event.code)) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      if (event.code === "KeyG") {
        setTransformTool("move");
        return;
      }

      if (event.code === "KeyR") {
        setTransformTool("rotate");
        return;
      }

      if (event.code === "KeyS") {
        setTransformTool("scale");
        return;
      }

      if (event.code === "KeyV") {
        setEditorViewMode((current) => (current === "topdown" ? "firstPerson" : "topdown"));
        return;
      }

      if (event.code === "Delete" || event.code === "Backspace") {
        deleteSelectedObject();
        return;
      }

      if (event.code === "KeyQ") {
        rotateSelectedObject(-0.08);
        return;
      }

      if (event.code === "KeyE") {
        rotateSelectedObject(0.08);
        return;
      }

      if (event.code === "KeyJ") {
        nudgeSelectedObject("x", -0.2);
        return;
      }

      if (event.code === "KeyL") {
        nudgeSelectedObject("x", 0.2);
        return;
      }

      if (event.code === "KeyI") {
        nudgeSelectedObject(selectedObject?.type === "wall" || selectedObject?.type === "room" ? "z" : "height", 0.2);
        return;
      }

      if (event.code === "KeyK") {
        nudgeSelectedObject(selectedObject?.type === "wall" || selectedObject?.type === "room" ? "z" : "height", -0.2);
        return;
      }

      if (event.code === "Equal" || event.code === "NumpadAdd") {
        scaleSelectedObject(0.2);
        return;
      }

      if (event.code === "Minus" || event.code === "NumpadSubtract") {
        scaleSelectedObject(-0.2);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [
    mode,
    selectedObject,
    selectedLayout,
    selectedDoor,
    selectedWall,
    roomConfig,
    selectedRoomIndex,
  ]);

  return (
    <main className={`app-shell ${mode}-shell`}>
      <section className="gallery-stage" aria-label="3D gallery viewport">
        <GalleryScene
          images={placedSceneImages}
          layouts={layouts}
          roomConfig={roomConfig}
          customWalls={customWalls}
          doors={doors}
          mode={mode}
          editorViewMode={editorViewMode}
          transformTool={transformTool}
          pendingPlacementImageId={pendingPlacementIds[0] ?? null}
          selectedImageId={selectedImageId}
          selectedWallId={selectedWallId}
          selectedDoorId={selectedDoorId}
          selectedRoomIndex={selectedRoomIndex}
          onSelectImage={selectArtwork}
          onSelectWall={selectWall}
          onSelectDoor={selectDoor}
          onSelectRoom={selectRoom}
          onUpdateImageLayout={updateImageLayout}
          onUpdateCustomWall={updateCustomWall}
          onUpdateDoor={updateDoor}
          onPlaceImageOnWall={placePendingImage}
        />
        {mode === "edit" ? (
          <div className={`edit-crosshair ${editorViewMode === "firstPerson" ? "active" : ""}`}>
            <span />
          </div>
        ) : null}
        <div className="floating-mode-switch" aria-label="Mode switch">
          <button
            type="button"
            className={`view-mode-button ${mode === "view" ? "active" : ""}`}
            onClick={() => switchMode("view")}
            title="观赏模式"
          >
            <Eye size={17} />
            <span>观赏</span>
          </button>
          <button
            type="button"
            className={mode === "edit" ? "active" : ""}
            onClick={() => switchMode("edit")}
            title="编辑模式"
          >
            <Pencil size={17} />
            <span>编辑</span>
          </button>
        </div>
        {mode === "edit" ? (
          <div className="edit-badge">
            <Move size={16} />
            <span>{editorViewMode === "topdown" ? "俯视编辑" : "第一人称编辑"}</span>
          </div>
        ) : null}
      </section>

      <aside className={`control-panel ${mode}-panel`} aria-label="Gallery controls">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Image Hang</p>
            <h1>私人画廊</h1>
          </div>
          <span className={supabaseReady ? "status online" : "status"}>
            {supabaseReady ? "Supabase" : "Local"}
          </span>
        </div>

        {mode === "view" ? (
          <section className="view-console" aria-label="Viewing console">
            <strong>观赏模式</strong>
            <span>点击左下角或画布进入画廊视角</span>
            <div>
              <b>{placedSceneImages.length}</b>
              <small>已展览</small>
            </div>
            <div>
              <b>{roomConfig.roomCount}</b>
              <small>房间</small>
            </div>
          </section>
        ) : null}

        <div className="mode-switch" aria-label="Mode switch">
          <button
            type="button"
            className={`view-mode-button ${mode === "view" ? "active" : ""}`}
            onClick={() => switchMode("view")}
            title="进入画廊"
          >
            <Eye size={17} />
            <span>观赏</span>
          </button>
          <button
            type="button"
            className={mode === "edit" ? "active" : ""}
            onClick={() => switchMode("edit")}
          >
            <Pencil size={17} />
            <span>编辑</span>
          </button>
        </div>

        <label className="upload-dropzone">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => void handleFiles(event.target.files)}
          />
          <span className="upload-icon" aria-hidden="true">
            {isUploading || isLoading ? <Loader2 size={28} /> : <ImagePlus size={28} />}
          </span>
          <span>{isLoading ? "载入中" : isUploading ? "上传中" : "添加照片"}</span>
        </label>

        <div className="button-row">
          <button
            type="button"
            className="tool-button"
            onClick={() => fileInputRef.current?.click()}
            title="选择图片"
          >
            <UploadCloud size={18} />
            <span>上传</span>
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => void resetGallery()}
            title="恢复示例"
          >
            <RotateCcw size={18} />
          </button>
        </div>

        {message ? <p className="message">{message}</p> : null}

        {mode === "edit" ? (
          <section className="editor-panel editor-hints" aria-label="Editor hints">
            <div className="editor-heading">
              <Pencil size={17} />
              <span>编辑工作台</span>
            </div>
            <div className="view-toggle" aria-label="Editor view mode">
              <button
                type="button"
                className={editorViewMode === "topdown" ? "active" : ""}
                onClick={() => setEditorViewMode("topdown")}
              >
                <Move size={15} />
                <span>俯视</span>
              </button>
              <button
                type="button"
                className={editorViewMode === "firstPerson" ? "active" : ""}
                onClick={() => setEditorViewMode("firstPerson")}
              >
                <Eye size={15} />
                <span>第一人称</span>
              </button>
            </div>
            <div className="hint-grid">
              <span>视角</span>
              <strong>
                {editorViewMode === "topdown"
                  ? "拖动画布平移，滚轮缩放俯视图"
                  : "点击画布锁定视角，WASD 移动，Shift 疾跑"}
              </strong>
              <span>挂画</span>
              <strong>
                {pendingPlacementIds.length > 0
                  ? "点击墙面上的目标位置放置待挂图片"
                  : "先上传图片，再点击墙面定位"}
              </strong>
              <span>对象</span>
              <strong>从组件市场添加房间、墙壁、门，再选择对象调整参数</strong>
            </div>
            <div className="shortcut-grid" aria-label="Editor shortcuts">
              <span><kbd>V</kbd> 切换视角</span>
              <span><kbd>G</kbd> 移动</span>
              <span><kbd>R</kbd> 旋转</span>
              <span><kbd>S</kbd> 缩放</span>
              <span><kbd>J</kbd><kbd>L</kbd> 左右移动</span>
              <span><kbd>I</kbd><kbd>K</kbd> 前后/高度</span>
              <span><kbd>Q</kbd><kbd>E</kbd> 旋转墙壁</span>
              <span><kbd>+</kbd><kbd>-</kbd> 缩放</span>
              <span><kbd>Del</kbd> 删除</span>
            </div>
          </section>
        ) : null}

        {mode === "edit" ? (
          <section className="editor-panel object-inspector" aria-label="Object inspector">
            <div className="editor-heading">
              <Move size={17} />
              <span>对象编辑器</span>
            </div>

            <div className="transform-tools" aria-label="Transform tools">
              <button
                type="button"
                className={transformTool === "move" ? "active" : ""}
                onClick={() => setTransformTool("move")}
              >
                <Move size={15} />
                <span>移动</span>
              </button>
              <button
                type="button"
                className={transformTool === "rotate" ? "active" : ""}
                onClick={() => setTransformTool("rotate")}
              >
                <RotateCcw size={15} />
                <span>旋转</span>
              </button>
              <button
                type="button"
                className={transformTool === "scale" ? "active" : ""}
                onClick={() => setTransformTool("scale")}
              >
                <Maximize2 size={15} />
                <span>缩放</span>
              </button>
            </div>

            {!selectedObject ? (
              <p className="empty-inspector">点击画作、墙壁、门或房间开始编辑。</p>
            ) : null}

            {selectedObject?.type === "artwork" && selectedImage && selectedLayout ? (
              <div className="inspector-fields">
                <div className="object-title">
                  <strong>{selectedImage.name}</strong>
                  <span>画作</span>
                </div>

                {(transformTool === "move" || transformTool === "rotate") ? (
                  <label className="field">
                    <span>{transformTool === "rotate" ? "朝向墙面" : "墙面"}</span>
                    <select
                      value={selectedLayout.wall}
                      onChange={(event) =>
                        updateSelectedLayout({ wall: event.target.value as GalleryWallTarget })
                      }
                    >
                      {wallOptions.map(([wall, label]) => (
                        <option key={wall} value={wall}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {transformTool === "move" ? (
                  <>
                    <label className="field">
                      <span>横向位置 {selectedLayout.offset.toFixed(1)}</span>
                      <input
                        type="range"
                        min={-getWallOffsetLimit(roomConfig, customWalls, selectedLayout.wall)}
                        max={getWallOffsetLimit(roomConfig, customWalls, selectedLayout.wall)}
                        step="0.1"
                        value={selectedLayout.offset}
                        onChange={(event) =>
                          updateSelectedLayout({ offset: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>高度 {selectedLayout.height.toFixed(1)}</span>
                      <input
                        type="range"
                        min="1.1"
                        max={Math.max(
                          1.2,
                          getWallTargetHeight(roomConfig, customWalls, selectedLayout.wall) - 1.15,
                        )}
                        step="0.1"
                        value={selectedLayout.height}
                        onChange={(event) =>
                          updateSelectedLayout({ height: Number(event.target.value) })
                        }
                      />
                    </label>
                  </>
                ) : null}

                {transformTool === "scale" ? (
                  <label className="field">
                    <span>大小 {selectedLayout.width.toFixed(1)}</span>
                    <input
                      type="range"
                      min="1.2"
                      max="5"
                      step="0.1"
                      value={selectedLayout.width}
                      onChange={(event) =>
                        updateSelectedLayout({ width: Number(event.target.value) })
                      }
                    />
                  </label>
                ) : null}

                <button
                  type="button"
                  className="tool-button secondary"
                  onClick={() =>
                    setLayouts((current) => {
                      const next = { ...current };
                      delete next[selectedImage.id];
                      return next;
                    })
                  }
                >
                  <Maximize2 size={17} />
                  <span>重置画作变换</span>
                </button>
              </div>
            ) : null}

            {selectedObject?.type === "room" ? (
              <div className="inspector-fields">
                <div className="object-title">
                  <strong>{selectedRoomLabel}</strong>
                  <span>房间</span>
                </div>

                {transformTool === "scale" ? (
                  <>
                    <label className="field">
                      <span>宽度 {roomConfig.width.toFixed(1)}</span>
                      <input
                        type="range"
                        min="12"
                        max="36"
                        step="0.5"
                        value={roomConfig.width}
                        onChange={(event) => updateRoomConfig({ width: Number(event.target.value) })}
                      />
                    </label>
                    <label className="field">
                      <span>深度 {roomConfig.depth.toFixed(1)}</span>
                      <input
                        type="range"
                        min="14"
                        max="44"
                        step="0.5"
                        value={roomConfig.depth}
                        onChange={(event) => updateRoomConfig({ depth: Number(event.target.value) })}
                      />
                    </label>
                    <label className="field">
                      <span>层高 {roomConfig.height.toFixed(1)}</span>
                      <input
                        type="range"
                        min="4.2"
                        max="8"
                        step="0.1"
                        value={roomConfig.height}
                        onChange={(event) => updateRoomConfig({ height: Number(event.target.value) })}
                      />
                    </label>
                  </>
                ) : (
                  <p className="empty-inspector">房间位置由连续展厅结构自动排列，切到“缩放”调整空间尺寸。</p>
                )}

                <button
                  type="button"
                  className="tool-button secondary danger"
                  onClick={() => deleteRoom(selectedRoomIndex)}
                  disabled={roomConfig.roomCount <= 1}
                >
                  <Trash2 size={17} />
                  <span>删除当前房间</span>
                </button>
              </div>
            ) : null}

            {selectedObject?.type === "wall" && selectedWall ? (
              <div className="inspector-fields">
                <div className="object-title">
                  <strong>{selectedWall.name}</strong>
                  <span>墙壁</span>
                </div>

                {transformTool === "move" ? (
                  <>
                    <label className="field">
                      <span>所属房间 {selectedWall.roomIndex + 1}</span>
                      <input
                        type="range"
                        min="0"
                        max={roomConfig.roomCount - 1}
                        step="1"
                        value={selectedWall.roomIndex}
                        onChange={(event) =>
                          updateCustomWall(selectedWall.id, { roomIndex: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>X {selectedWall.x.toFixed(1)}</span>
                      <input
                        type="range"
                        min={-roomConfig.width / 2 + 1}
                        max={roomConfig.width / 2 - 1}
                        step="0.1"
                        value={selectedWall.x}
                        onChange={(event) =>
                          updateCustomWall(selectedWall.id, { x: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Z {selectedWall.z.toFixed(1)}</span>
                      <input
                        type="range"
                        min={-roomConfig.depth / 2 + 1}
                        max={roomConfig.depth / 2 - 1}
                        step="0.1"
                        value={selectedWall.z}
                        onChange={(event) =>
                          updateCustomWall(selectedWall.id, { z: Number(event.target.value) })
                        }
                      />
                    </label>
                  </>
                ) : null}

                {transformTool === "rotate" ? (
                  <label className="field">
                    <span>旋转 {Math.round((selectedWall.rotation * 180) / Math.PI)}°</span>
                    <input
                      type="range"
                      min="-3.14"
                      max="3.14"
                      step="0.05"
                      value={selectedWall.rotation}
                      onChange={(event) =>
                        updateCustomWall(selectedWall.id, { rotation: Number(event.target.value) })
                      }
                    />
                  </label>
                ) : null}

                {transformTool === "scale" ? (
                  <>
                    <label className="field">
                      <span>长度 {selectedWall.length.toFixed(1)}</span>
                      <input
                        type="range"
                        min="2"
                        max={roomConfig.width - 1}
                        step="0.1"
                        value={selectedWall.length}
                        onChange={(event) =>
                          updateCustomWall(selectedWall.id, { length: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>高度 {selectedWall.height.toFixed(1)}</span>
                      <input
                        type="range"
                        min="2.2"
                        max={roomConfig.height - 0.35}
                        step="0.1"
                        value={selectedWall.height}
                        onChange={(event) =>
                          updateCustomWall(selectedWall.id, { height: Number(event.target.value) })
                        }
                      />
                    </label>
                  </>
                ) : null}

                <button
                  type="button"
                  className="tool-button secondary danger"
                  onClick={() => deleteCustomWall(selectedWall.id)}
                >
                  <Trash2 size={17} />
                  <span>删除选中墙壁</span>
                </button>
              </div>
            ) : null}

            {selectedObject?.type === "door" && selectedDoor ? (
              <div className="inspector-fields">
                <div className="object-title">
                  <strong>{selectedDoor.name}</strong>
                  <span>门</span>
                </div>

                {(transformTool === "move" || transformTool === "rotate") ? (
                  <label className="field">
                    <span>{transformTool === "rotate" ? "朝向墙面" : "所在墙面"}</span>
                    <select
                      value={selectedDoor.wall}
                      onChange={(event) =>
                        updateDoor(selectedDoor.id, { wall: event.target.value as GalleryWallTarget })
                      }
                    >
                      {wallOptions.map(([wall, label]) => (
                        <option key={wall} value={wall}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {transformTool === "move" ? (
                  <label className="field">
                    <span>位置 {selectedDoor.offset.toFixed(1)}</span>
                    <input
                      type="range"
                      min={-getWallOffsetLimit(roomConfig, customWalls, selectedDoor.wall)}
                      max={getWallOffsetLimit(roomConfig, customWalls, selectedDoor.wall)}
                      step="0.1"
                      value={selectedDoor.offset}
                      onChange={(event) =>
                        updateDoor(selectedDoor.id, { offset: Number(event.target.value) })
                      }
                    />
                  </label>
                ) : null}

                {transformTool === "scale" ? (
                  <>
                    <label className="field">
                      <span>宽度 {selectedDoor.width.toFixed(1)}</span>
                      <input
                        type="range"
                        min="0.8"
                        max="3.2"
                        step="0.1"
                        value={selectedDoor.width}
                        onChange={(event) =>
                          updateDoor(selectedDoor.id, { width: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>高度 {selectedDoor.height.toFixed(1)}</span>
                      <input
                        type="range"
                        min="1.8"
                        max={roomConfig.height - 0.4}
                        step="0.1"
                        value={selectedDoor.height}
                        onChange={(event) =>
                          updateDoor(selectedDoor.id, { height: Number(event.target.value) })
                        }
                      />
                    </label>
                  </>
                ) : null}

                <button
                  type="button"
                  className="tool-button secondary danger"
                  onClick={() => deleteDoor(selectedDoor.id)}
                >
                  <Trash2 size={17} />
                  <span>删除选中门</span>
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {mode === "edit" ? (
          <section className="editor-panel space-panel" aria-label="Room editor">
            <div className="editor-heading">
              <Ruler size={17} />
              <span>空间</span>
            </div>

            <div className="capacity-card">
              <strong>{sceneImages.length} / {capacity}</strong>
              <span>估算容量</span>
              <small>剩余 {remainingCapacity} 张</small>
            </div>

            <div className="room-selector" aria-label="Room selector">
              {Array.from({ length: roomConfig.roomCount }, (_, roomIndex) => (
                <button
                  key={roomIndex}
                  type="button"
                  className={selectedRoomIndex === roomIndex ? "active" : ""}
                  onClick={() => selectRoom(roomIndex)}
                >
                  房间 {roomIndex + 1}
                </button>
              ))}
            </div>

            <div className="component-market" aria-label="Component market">
              <div className="market-heading">
                <strong>组件市场</strong>
                <span>添加到房间 {selectedRoomIndex + 1}</span>
              </div>
              <button type="button" className="market-item" onClick={addRoom}>
                <Plus size={18} />
                <strong>房间</strong>
                <span>扩展连续展厅空间</span>
              </button>
              <button type="button" className="market-item" onClick={addCustomWall}>
                <Ruler size={18} />
                <strong>墙壁</strong>
                <span>可拖拽、旋转、调整长度</span>
              </button>
              <button type="button" className="market-item" onClick={addDoor}>
                <DoorOpen size={18} />
                <strong>门</strong>
                <span>挂到墙面形成门位</span>
              </button>
              <button type="button" className="market-item" disabled title="后续可扩展展台对象">
                <Maximize2 size={18} />
                <strong>展台</strong>
                <span>后续扩展陈列物件</span>
              </button>
            </div>

            {pendingPlacementIds.length > 0 ? (
              <p className="placement-note">待放置 {pendingPlacementIds.length} 张：点击任意墙面挂画</p>
            ) : null}

          </section>
        ) : null}

        <div className="collection-header">
          <span>作品</span>
          <span>{images.length || samples.length}</span>
        </div>

        <div className="image-list">
          {images.length === 0 ? (
            samples.slice(0, 4).map((image) => (
              <article
                className={`image-item muted ${selectedImageId === image.id ? "selected" : ""}`}
                key={image.id}
                onClick={() => selectArtwork(image.id)}
              >
                <img src={image.url} alt="" />
                <div>
                  <strong>{image.name}</strong>
                  <span>sample</span>
                </div>
              </article>
            ))
          ) : (
            images.map((image) => (
              <article
                className={`image-item ${selectedImageId === image.id ? "selected" : ""}`}
                key={image.id}
                onClick={() => selectArtwork(image.id)}
              >
                <img src={image.url} alt="" />
                <div>
                  <strong title={image.name}>{image.name}</strong>
                  <span>{image.source}</span>
                </div>
                <button
                  type="button"
                  className="delete-button"
                  onClick={() => void removeImage(image.id)}
                  title="移除"
                >
                  <Trash2 size={16} />
                </button>
              </article>
            ))
          )}
        </div>
      </aside>
    </main>
  );
}

export default App;

import { Canvas, ThreeEvent, useFrame, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type {
  AppMode,
  BuilderPlacementTarget,
  EditorSettings,
  EditorTransformTool,
  EditorViewMode,
  GalleryCustomWall,
  GalleryDoor,
  GalleryFrameLayout,
  GalleryImage,
  GalleryLayouts,
  GalleryRoomConfig,
  GalleryRoomDimensions,
  GalleryWall,
  GalleryWallTarget,
} from "../types";

interface GallerySceneProps {
  images: GalleryImage[];
  layouts: GalleryLayouts;
  roomConfig: GalleryRoomConfig;
  customWalls: GalleryCustomWall[];
  doors: GalleryDoor[];
  mode: AppMode;
  editorViewMode: EditorViewMode;
  transformTool: EditorTransformTool;
  editorSettings: EditorSettings;
  isGrabActive: boolean;
  pendingPlacementImageId: string | null;
  selectedImageId: string | null;
  selectedWallId: string | null;
  selectedDoorId: string | null;
  selectedRoomIndex: number;
  onSelectImage: (id: string) => void;
  onSelectWall: (id: string) => void;
  onSelectDoor: (id: string) => void;
  onSelectRoom: (roomIndex: number) => void;
  onUpdateImageLayout: (id: string, patch: Partial<GalleryFrameLayout>) => void;
  onUpdateCustomWall: (id: string, patch: Partial<GalleryCustomWall>) => void;
  onUpdateDoor: (id: string, patch: Partial<GalleryDoor>) => void;
  onToggleDoor: (id: string) => void;
  onPlaceImageOnWall: (wall: GalleryWallTarget, offset: number, height: number) => void;
  onAimTargetChange: (label: string | null) => void;
  onBuilderPlacementChange: (target: BuilderPlacementTarget | null) => void;
}

type EditableHitTarget =
  | { kind: "artwork"; id: string; label: string }
  | { kind: "customWall"; id: string; label: string }
  | { kind: "door"; id: string; label: string }
  | { kind: "builtWall"; wall: GalleryWallTarget; roomIndex: number; label: string };

type EditableHit = {
  target: EditableHitTarget;
  object: THREE.Object3D;
  point: THREE.Vector3;
};

const fallbackRoom: GalleryRoomConfig = {
  width: 18,
  depth: 22,
  height: 5.2,
  roomCount: 1,
  rooms: [{ width: 18, depth: 22, height: 5.2 }],
};

const eyeHeight = 1.75;
const wallInset = 0.18;
const wallOrder: GalleryWall[] = ["north", "west", "east", "south"];

function getRoomDimensions(room: GalleryRoomConfig, roomIndex: number) {
  return room.rooms?.[roomIndex] ?? {
    width: room.width,
    depth: room.depth,
    height: room.height,
  };
}

function roomOffset(room: GalleryRoomConfig, roomIndex: number) {
  let offset = 0;

  for (let index = 0; index < roomIndex; index += 1) {
    const current = getRoomDimensions(room, index);
    const next = getRoomDimensions(room, index + 1);
    offset += current.width / 2 + next.width / 2 + 2.2;
  }

  return offset;
}

function builtWallTarget(roomIndex: number, wall: GalleryWall): GalleryWallTarget {
  return roomIndex === 0 ? wall : `room-${roomIndex}:${wall}`;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getWallLength(room: GalleryRoomConfig, wall: GalleryWall, roomIndex = 0) {
  const dimensions = getRoomDimensions(room, roomIndex);
  return wall === "north" || wall === "south" ? dimensions.width : dimensions.depth;
}

function getWallMount(room: GalleryRoomConfig, wall: GalleryWall, roomIndex = 0) {
  const xOffset = roomOffset(room, roomIndex);
  const dimensions = getRoomDimensions(room, roomIndex);
  const mounts = {
    north: { position: [xOffset, 0, -dimensions.depth / 2 + wallInset], rotation: [0, 0, 0] },
    south: { position: [xOffset, 0, dimensions.depth / 2 - wallInset], rotation: [0, Math.PI, 0] },
    west: { position: [xOffset - dimensions.width / 2 + wallInset, 0, 0], rotation: [0, Math.PI / 2, 0] },
    east: { position: [xOffset + dimensions.width / 2 - wallInset, 0, 0], rotation: [0, -Math.PI / 2, 0] },
  } satisfies Record<
    GalleryWall,
    {
      position: [number, number, number];
      rotation: [number, number, number];
    }
  >;

  return mounts[wall];
}

function getCustomWallMount(room: GalleryRoomConfig, wall: GalleryCustomWall) {
  return {
    position: [roomOffset(room, wall.roomIndex) + wall.x, 0, wall.z] as [number, number, number],
    rotation: [0, wall.rotation, 0] as [number, number, number],
  };
}

function getWallBasis(room: GalleryRoomConfig, wall: GalleryWallTarget, customWalls: GalleryCustomWall[]) {
  const built = parseBuiltWallTarget(wall);

  if (built) {
    const mount = getWallMount(room, built.wall, built.roomIndex);
    const normal = new THREE.Vector3(0, 0, 1).applyEuler(
      new THREE.Euler(...mount.rotation, "XYZ"),
    );
    const axis = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(...mount.rotation, "XYZ"));

    return {
      target: wall,
      position: new THREE.Vector3(...mount.position),
      normal,
      axis,
      height: getRoomDimensions(room, built.roomIndex).height,
      length: getWallLength(room, built.wall, built.roomIndex),
    };
  }

  const customWall = customWalls.find((item) => item.id === wall);
  if (!customWall) {
    return null;
  }

  const mount = getCustomWallMount(room, customWall);
  const normal = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(...mount.rotation, "XYZ"));
  const axis = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(...mount.rotation, "XYZ"));

  return {
    target: wall,
    position: new THREE.Vector3(...mount.position),
    normal,
    axis,
    height: customWall.height,
    length: customWall.length,
  };
}

function getAllWallTargets(room: GalleryRoomConfig, customWalls: GalleryCustomWall[]) {
  const builtTargets = Array.from({ length: room.roomCount }, (_, roomIndex) =>
    wallOrder.map((wall) => builtWallTarget(roomIndex, wall)),
  ).flat();

  return [...builtTargets, ...customWalls.map((wall) => wall.id)];
}

function getRoomIndexAtWorldX(room: GalleryRoomConfig, worldX: number) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let roomIndex = 0; roomIndex < room.roomCount; roomIndex += 1) {
    const distance = Math.abs(worldX - roomOffset(room, roomIndex));

    if (distance < bestDistance) {
      bestIndex = roomIndex;
      bestDistance = distance;
    }
  }

  return bestIndex;
}

function getPlacementFromWorldPoint(
  room: GalleryRoomConfig,
  point: THREE.Vector3,
  wallHit?: Pick<BuilderPlacementTarget, "wall" | "wallOffset" | "wallHeight" | "label">,
): BuilderPlacementTarget {
  const roomIndex = getRoomIndexAtWorldX(room, point.x);
  const xOffset = roomOffset(room, roomIndex);
  const dimensions = getRoomDimensions(room, roomIndex);

  return {
    roomIndex,
    x: clamp(point.x - xOffset, -dimensions.width / 2 + 1, dimensions.width / 2 - 1),
    z: clamp(point.z, -dimensions.depth / 2 + 1, dimensions.depth / 2 - 1),
    ...wallHit,
  };
}

function defaultWidthFor(image: GalleryImage) {
  const aspect = image.width / image.height || 1.42;
  return Math.min(3.4, Math.max(2.15, aspect * 2.15));
}

export function getDefaultLayout(
  image: GalleryImage,
  index: number,
  room: GalleryRoomConfig = fallbackRoom,
): GalleryFrameLayout {
  const roomIndex = Math.floor(index / 12) % room.roomCount;
  const wall = wallOrder[Math.floor(index / 3) % wallOrder.length];
  const slot = index % 3;
  const dimensions = getRoomDimensions(room, roomIndex);
  const wallLength = getWallLength(room, wall, roomIndex);
  const usableLength = Math.max(5, wallLength - 3.6);
  const spacing = Math.max(2.8, usableLength / 3);
  const limit = usableLength / 2;

  return {
    wall: builtWallTarget(roomIndex, wall),
    offset: clamp((slot - 1) * spacing, -limit, limit),
    height: clamp(dimensions.height * 0.48, 2.2, dimensions.height - 1.15),
    width: defaultWidthFor(image),
  };
}

function PlayerMovement({ room, settings }: { room: GalleryRoomConfig; settings: EditorSettings }) {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const verticalVelocity = useRef(0);
  const isGrounded = useRef(true);
  const velocity = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const forward = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    camera.position.set(0, eyeHeight, 7);

    const shouldIgnoreKeyboard = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const isPointerLocked = document.pointerLockElement === gl.domElement;

      return Boolean(target?.closest(".control-panel")) && !isPointerLocked;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyboard(event)) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
      }
      keys.current.add(event.code);

      if (event.code === "Space" && isGrounded.current) {
        verticalVelocity.current = settings.jumpPower;
        isGrounded.current = false;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.current.delete(event.code);
    };
    const clearMovement = () => {
      keys.current.clear();
      verticalVelocity.current = 0;
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        clearMovement();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearMovement);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearMovement);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [camera, gl, settings.jumpPower]);

  useFrame((_, delta) => {
    direction.set(0, 0, 0);

    if (keys.current.has("KeyW") || keys.current.has("ArrowUp")) {
      direction.z -= 1;
    }
    if (keys.current.has("KeyS") || keys.current.has("ArrowDown")) {
      direction.z += 1;
    }
    if (keys.current.has("KeyA") || keys.current.has("ArrowLeft")) {
      direction.x -= 1;
    }
    if (keys.current.has("KeyD") || keys.current.has("ArrowRight")) {
      direction.x += 1;
    }

    if (direction.lengthSq() > 0) {
      const speed =
        keys.current.has("ShiftLeft") || keys.current.has("ShiftRight")
          ? settings.sprintSpeed
          : settings.walkSpeed;

      direction.normalize();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.crossVectors(forward, camera.up).normalize();

      velocity
        .set(0, 0, 0)
        .addScaledVector(forward, -direction.z)
        .addScaledVector(right, direction.x)
        .normalize()
        .multiplyScalar(speed * delta);

      camera.position.add(velocity);
    }

    verticalVelocity.current -= 13.5 * delta;
    camera.position.y += verticalVelocity.current * delta;

    if (camera.position.y <= eyeHeight) {
      camera.position.y = eyeHeight;
      verticalVelocity.current = 0;
      isGrounded.current = true;
    }

    const firstRoom = getRoomDimensions(room, 0);
    const lastRoom = getRoomDimensions(room, room.roomCount - 1);
    camera.position.x = THREE.MathUtils.clamp(
      camera.position.x,
      -firstRoom.width / 2 + 1.25,
      roomOffset(room, room.roomCount - 1) + lastRoom.width / 2 - 1.25,
    );
    const currentRoom = getRoomDimensions(room, getRoomIndexAtWorldX(room, camera.position.x));
    camera.position.z = THREE.MathUtils.clamp(
      camera.position.z,
      -currentRoom.depth / 2 + 1.25,
      currentRoom.depth / 2 - 1.25,
    );
  });

  return null;
}

function FirstPersonLookControls({
  mode,
  mouseSensitivity,
}: {
  mode: AppMode;
  mouseSensitivity: number;
}) {
  const { camera, gl } = useThree();
  const yaw = useRef(0);
  const pitch = useRef(0);

  useEffect(() => {
    camera.rotation.order = "YXZ";
    yaw.current = camera.rotation.y;
    pitch.current = camera.rotation.x;
  }, [camera]);

  useEffect(() => {
    const canvas = gl.domElement;
    const sensitivity = mouseSensitivity;

    const applyRotation = () => {
      camera.rotation.order = "YXZ";
      camera.rotation.y = yaw.current;
      camera.rotation.x = pitch.current;
      camera.rotation.z = 0;
    };

    const rotateBy = (movementX: number, movementY: number) => {
      yaw.current -= movementX * sensitivity;
      pitch.current = THREE.MathUtils.clamp(
        pitch.current - movementY * sensitivity,
        -Math.PI / 2 + 0.08,
        Math.PI / 2 - 0.08,
      );
      applyRotation();
    };

    if (Math.abs(camera.rotation.x) > Math.PI / 3) {
      yaw.current = 0;
      pitch.current = 0;
      applyRotation();
    } else {
      camera.rotation.order = "YXZ";
      yaw.current = camera.rotation.y;
      pitch.current = camera.rotation.x;
      camera.rotation.z = 0;
    }

    const requestPointerLock = () => {
      if (document.pointerLockElement !== canvas) {
        void canvas.requestPointerLock();
      }
    };

    const onDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const isViewTrigger = Boolean(target?.closest(".enter-button, .view-mode-button"));

      if (isViewTrigger) {
        requestPointerLock();
        return;
      }

      if ((mode === "view" || mode === "edit") && event.target === canvas && event.button === 0) {
        requestPointerLock();
      }
    };

    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement === canvas) {
        rotateBy(event.movementX, event.movementY);
      }
    };

    document.addEventListener("pointerdown", onDocumentPointerDown);
    document.addEventListener("mousemove", onMouseMove);

    return () => {
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      document.removeEventListener("mousemove", onMouseMove);
    };
  }, [camera, gl, mode, mouseSensitivity]);

  return null;
}

function EditorCameraControls({ room }: { room: GalleryRoomConfig }) {
  const { camera, gl } = useThree();
  const target = useRef(new THREE.Vector3());
  const zoomHeight = useRef(26);
  const isPanning = useRef(false);
  const pointerId = useRef<number | null>(null);
  const hasInitialized = useRef(false);

  const applyCamera = () => {
    const center = target.current;
    camera.position.set(center.x, zoomHeight.current, center.z + zoomHeight.current * 0.38);
    camera.lookAt(center.x, 0, center.z);
    camera.updateProjectionMatrix();
  };

  const clampTarget = () => {
    const firstRoom = getRoomDimensions(room, 0);
    const lastRoom = getRoomDimensions(room, room.roomCount - 1);
    const targetRoom = getRoomDimensions(room, getRoomIndexAtWorldX(room, target.current.x));
    const totalMinX = -firstRoom.width / 2 - 2;
    const totalMaxX = roomOffset(room, room.roomCount - 1) + lastRoom.width / 2 + 2;

    target.current.x = THREE.MathUtils.clamp(target.current.x, totalMinX, totalMaxX);
    target.current.z = THREE.MathUtils.clamp(
      target.current.z,
      -targetRoom.depth / 2 - 2,
      targetRoom.depth / 2 + 2,
    );
  };

  useEffect(() => {
    if (document.pointerLockElement === gl.domElement) {
      document.exitPointerLock();
    }

    if (!hasInitialized.current) {
      const centerX = roomOffset(room, room.roomCount - 1) / 2;
      target.current.set(centerX, 0, 0);
      hasInitialized.current = true;
    }

    const selectedRoom = getRoomDimensions(room, getRoomIndexAtWorldX(room, target.current.x));
    zoomHeight.current = THREE.MathUtils.clamp(
      Math.max(selectedRoom.width, selectedRoom.depth) * 1.25,
      18,
      52,
    );
    camera.rotation.order = "YXZ";
    applyCamera();
  }, [camera, gl, room]);

  useEffect(() => {
    clampTarget();
    applyCamera();
  }, [room]);

  useEffect(() => {
    const canvas = gl.domElement;

    const onPointerDown = (event: PointerEvent) => {
      if (event.target !== canvas || event.button !== 0) {
        return;
      }

      isPanning.current = true;
      pointerId.current = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!isPanning.current || pointerId.current !== event.pointerId) {
        return;
      }

      const panScale = zoomHeight.current * 0.0018;
      target.current.x -= event.movementX * panScale;
      target.current.z -= event.movementY * panScale;
      clampTarget();
      applyCamera();
    };

    const stopPanning = (event: PointerEvent) => {
      if (pointerId.current === event.pointerId && canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }

      isPanning.current = false;
      pointerId.current = null;
    };

    const onWheel = (event: WheelEvent) => {
      if (event.target !== canvas) {
        return;
      }

      event.preventDefault();
      zoomHeight.current = THREE.MathUtils.clamp(
        zoomHeight.current + event.deltaY * 0.026,
        10,
        58,
      );
      applyCamera();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", stopPanning);
    canvas.addEventListener("pointercancel", stopPanning);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", stopPanning);
      canvas.removeEventListener("pointercancel", stopPanning);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [camera, gl, room]);

  useFrame(() => {
    applyCamera();
  });

  return null;
}

function TopdownBuilderPlacementTracker({
  isEditMode,
  editorViewMode,
  room,
  onBuilderPlacementChange,
}: {
  isEditMode: boolean;
  editorViewMode: EditorViewMode;
  room: GalleryRoomConfig;
  onBuilderPlacementChange: (target: BuilderPlacementTarget | null) => void;
}) {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hitPoint = useMemo(() => new THREE.Vector3(), []);
  const lastKey = useRef<string | null>(null);

  function emitPlacement(target: BuilderPlacementTarget | null) {
    const key = target
      ? `${target.roomIndex}:${target.x.toFixed(2)}:${target.z.toFixed(2)}`
      : null;

    if (lastKey.current === key) {
      return;
    }

    lastKey.current = key;
    onBuilderPlacementChange(target);
  }

  useEffect(() => {
    if (!isEditMode || editorViewMode !== "topdown") {
      emitPlacement(null);
      return;
    }

    const canvas = gl.domElement;

    function updateFromPointer(event: PointerEvent | MouseEvent) {
      if (event.target !== canvas) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      if (raycaster.ray.intersectPlane(floorPlane, hitPoint)) {
        emitPlacement(getPlacementFromWorldPoint(room, hitPoint));
      }
    }

    canvas.addEventListener("pointermove", updateFromPointer);
    canvas.addEventListener("pointerdown", updateFromPointer);
    canvas.addEventListener("mousemove", updateFromPointer);

    return () => {
      canvas.removeEventListener("pointermove", updateFromPointer);
      canvas.removeEventListener("pointerdown", updateFromPointer);
      canvas.removeEventListener("mousemove", updateFromPointer);
    };
  }, [
    camera,
    editorViewMode,
    floorPlane,
    gl,
    hitPoint,
    isEditMode,
    onBuilderPlacementChange,
    pointer,
    raycaster,
    room,
  ]);

  return null;
}

function FloorLines({ room }: { room: GalleryRoomDimensions }) {
  const lines = useMemo(() => {
    const pieces: Array<{
      key: string;
      position: [number, number, number];
      scale: [number, number, number];
    }> = [];
    const spacing = 3;

    for (let x = -room.width / 2 + spacing; x < room.width / 2; x += spacing) {
      pieces.push({
        key: `x-${x.toFixed(1)}`,
        position: [x, 0.025, 0],
        scale: [0.018, 0.018, room.depth],
      });
    }

    for (let z = -room.depth / 2 + spacing; z < room.depth / 2; z += spacing) {
      pieces.push({
        key: `z-${z.toFixed(1)}`,
        position: [0, 0.028, z],
        scale: [room.width, 0.018, 0.018],
      });
    }

    return pieces;
  }, [room]);

  return (
    <>
      {lines.map((line) => (
        <mesh key={line.key} position={line.position}>
          <boxGeometry args={line.scale} />
          <meshStandardMaterial color="#c6aa6c" roughness={0.48} metalness={0.18} />
        </mesh>
      ))}
    </>
  );
}

function CeilingLights({ room }: { room: GalleryRoomDimensions }) {
  const lightRows = Math.max(1, Math.round(room.depth / 12));

  return (
    <>
      {Array.from({ length: lightRows }, (_, index) => {
        const z = ((index + 1) / (lightRows + 1) - 0.5) * room.depth;

        return (
          <group key={z} position={[0, room.height - 0.05, z]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <planeGeometry args={[Math.min(8, room.width * 0.46), 0.46]} />
              <meshBasicMaterial color="#fff2cf" />
            </mesh>
            <pointLight position={[0, -0.2, 0]} intensity={1.1} distance={room.height + 7} color="#fff0d0" />
          </group>
        );
      })}
    </>
  );
}

function Baseboards({ room }: { room: GalleryRoomDimensions }) {
  return (
    <group>
      <mesh position={[0, 0.18, -room.depth / 2 + 0.06]}>
        <boxGeometry args={[room.width, 0.24, 0.12]} />
        <meshStandardMaterial color="#554435" roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.18, room.depth / 2 - 0.06]}>
        <boxGeometry args={[room.width, 0.24, 0.12]} />
        <meshStandardMaterial color="#554435" roughness={0.55} />
      </mesh>
      <mesh position={[-room.width / 2 + 0.06, 0.18, 0]}>
        <boxGeometry args={[0.12, 0.24, room.depth]} />
        <meshStandardMaterial color="#554435" roughness={0.55} />
      </mesh>
      <mesh position={[room.width / 2 - 0.06, 0.18, 0]}>
        <boxGeometry args={[0.12, 0.24, room.depth]} />
        <meshStandardMaterial color="#554435" roughness={0.55} />
      </mesh>
    </group>
  );
}

function getGalleryBounds(room: GalleryRoomConfig) {
  const firstRoom = getRoomDimensions(room, 0);
  const lastRoom = getRoomDimensions(room, room.roomCount - 1);

  return {
    minX: -firstRoom.width / 2,
    maxX: roomOffset(room, room.roomCount - 1) + lastRoom.width / 2,
    maxDepth: Math.max(
      ...Array.from({ length: room.roomCount }, (_, index) => getRoomDimensions(room, index).depth),
    ),
  };
}

function Room({
  room,
  roomIndex,
  isEditMode,
  isSelected,
  editorViewMode,
  pendingPlacementImageId,
  onSelectRoom,
  onPlaceImageOnWall,
}: {
  room: GalleryRoomConfig;
  roomIndex: number;
  isEditMode: boolean;
  isSelected: boolean;
  editorViewMode: EditorViewMode;
  pendingPlacementImageId: string | null;
  onSelectRoom: (roomIndex: number) => void;
  onPlaceImageOnWall: (wall: GalleryWallTarget, offset: number, height: number) => void;
}) {
  const xOffset = roomOffset(room, roomIndex);
  const dimensions = getRoomDimensions(room, roomIndex);
  const placeOnWall = (wall: GalleryWall, event: ThreeEvent<MouseEvent>) => {
    if (!isEditMode || !pendingPlacementImageId || editorViewMode !== "topdown") {
      return;
    }

    event.stopPropagation();
    const local = event.object.worldToLocal(event.point.clone());
    onPlaceImageOnWall(
      builtWallTarget(roomIndex, wall),
      local.x,
      clamp(local.y + dimensions.height / 2, 1.1, dimensions.height - 1.1),
    );
  };
  const selectRoom = (event: ThreeEvent<MouseEvent>) => {
    if (!isEditMode || editorViewMode !== "topdown") {
      return;
    }

    event.stopPropagation();
    onSelectRoom(roomIndex);
  };

  return (
    <group position={[xOffset, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow onClick={selectRoom}>
        <planeGeometry args={[dimensions.width, dimensions.depth]} />
        <meshStandardMaterial color={isSelected && isEditMode ? "#c5bdab" : "#b9b6aa"} roughness={0.58} metalness={0.04} />
      </mesh>
      {isSelected && isEditMode ? (
        <mesh position={[0, 0.045, 0]}>
          <boxGeometry args={[dimensions.width, 0.035, dimensions.depth]} />
          <meshBasicMaterial color="#f6c453" transparent opacity={0.16} />
        </mesh>
      ) : null}
      <mesh position={[0, dimensions.height, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[dimensions.width, dimensions.depth]} />
        <meshStandardMaterial color="#efe9dc" roughness={0.82} />
      </mesh>
      <Wall
        length={dimensions.width}
        height={dimensions.height}
        position={[0, dimensions.height / 2, -dimensions.depth / 2]}
        onClick={(event) => placeOnWall("north", event)}
        editableTarget={{
          kind: "builtWall",
          wall: builtWallTarget(roomIndex, "north"),
          roomIndex,
          label: `房间 ${roomIndex + 1} 北墙`,
        }}
      />
      <Wall
        length={dimensions.width}
        height={dimensions.height}
        position={[0, dimensions.height / 2, dimensions.depth / 2]}
        rotation={[0, Math.PI, 0]}
        onClick={(event) => placeOnWall("south", event)}
        editableTarget={{
          kind: "builtWall",
          wall: builtWallTarget(roomIndex, "south"),
          roomIndex,
          label: `房间 ${roomIndex + 1} 南墙`,
        }}
      />
      <Wall
        length={dimensions.depth}
        height={dimensions.height}
        position={[-dimensions.width / 2, dimensions.height / 2, 0]}
        rotation={[0, Math.PI / 2, 0]}
        onClick={(event) => placeOnWall("west", event)}
        editableTarget={{
          kind: "builtWall",
          wall: builtWallTarget(roomIndex, "west"),
          roomIndex,
          label: `房间 ${roomIndex + 1} 西墙`,
        }}
      />
      <Wall
        length={dimensions.depth}
        height={dimensions.height}
        position={[dimensions.width / 2, dimensions.height / 2, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        onClick={(event) => placeOnWall("east", event)}
        editableTarget={{
          kind: "builtWall",
          wall: builtWallTarget(roomIndex, "east"),
          roomIndex,
          label: `房间 ${roomIndex + 1} 东墙`,
        }}
      />
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[0.05, 0.04, dimensions.depth]} />
        <meshStandardMaterial color="#b59f77" />
      </mesh>
      <mesh position={[0, 0.022, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[0.05, 0.04, dimensions.width]} />
        <meshStandardMaterial color="#b59f77" />
      </mesh>
      <FloorLines room={dimensions} />
      <Baseboards room={dimensions} />
      <CeilingLights room={dimensions} />
    </group>
  );
}

function SelectedWallDragSurface({
  wall,
  room,
  onUpdateCustomWall,
}: {
  wall: GalleryCustomWall;
  room: GalleryRoomConfig;
  onUpdateCustomWall: (id: string, patch: Partial<GalleryCustomWall>) => void;
}) {
  const isDragging = useRef(false);
  const dragOffset = useRef(new THREE.Vector3());
  const bounds = getGalleryBounds(room);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const totalWidth = bounds.maxX - bounds.minX + 4;

  function moveWall(event: ThreeEvent<PointerEvent>) {
    const roomX = roomOffset(room, wall.roomIndex);

    onUpdateCustomWall(wall.id, {
      x: event.point.x - dragOffset.current.x - roomX,
      z: event.point.z - dragOffset.current.z,
    });
  }

  function startDrag(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    isDragging.current = true;
    const target = event.target as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    dragOffset.current.set(
      event.point.x - (roomOffset(room, wall.roomIndex) + wall.x),
      0,
      event.point.z - wall.z,
    );
    moveWall(event);
  }

  function drag(event: ThreeEvent<PointerEvent>) {
    if (!isDragging.current) {
      return;
    }

    event.stopPropagation();
    moveWall(event);
  }

  function stopDrag(event: ThreeEvent<PointerEvent>) {
    if (!isDragging.current) {
      return;
    }

    const target = event.target as HTMLElement;
    target.releasePointerCapture?.(event.pointerId);
    isDragging.current = false;
  }

  return (
    <mesh
      position={[centerX, 0.14, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={startDrag}
      onPointerMove={drag}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    >
      <planeGeometry args={[totalWidth, bounds.maxDepth + 4]} />
      <meshBasicMaterial transparent opacity={0.01} depthWrite={false} />
    </mesh>
  );
}

function SelectedWallDomDrag({
  wall,
  room,
  onUpdateCustomWall,
}: {
  wall: GalleryCustomWall;
  room: GalleryRoomConfig;
  onUpdateCustomWall: (id: string, patch: Partial<GalleryCustomWall>) => void;
}) {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hitPoint = useMemo(() => new THREE.Vector3(), []);
  const isDragging = useRef(false);
  const wallRef = useRef(wall);
  const dragOffset = useRef(new THREE.Vector3());

  useEffect(() => {
    wallRef.current = wall;
  }, [wall]);

  useEffect(() => {
    const canvas = gl.domElement;

    function getHit(event: PointerEvent) {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      return raycaster.ray.intersectPlane(floorPlane, hitPoint);
    }

    function updateFromEvent(event: PointerEvent) {
      if (!getHit(event)) {
        return;
      }

      const currentWall = wallRef.current;
      const roomX = roomOffset(room, currentWall.roomIndex);

      onUpdateCustomWall(currentWall.id, {
        x: hitPoint.x - dragOffset.current.x - roomX,
        z: hitPoint.z - dragOffset.current.z,
      });
    }

    function startDrag(event: PointerEvent) {
      if (event.button !== 0 || event.target !== canvas) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      isDragging.current = true;
      if (getHit(event)) {
        const currentWall = wallRef.current;
        dragOffset.current.set(
          hitPoint.x - (roomOffset(room, currentWall.roomIndex) + currentWall.x),
          0,
          hitPoint.z - currentWall.z,
        );
      }
      updateFromEvent(event);
    }

    function drag(event: PointerEvent) {
      if (!isDragging.current) {
        return;
      }

      event.preventDefault();
      updateFromEvent(event);
    }

    function stopDrag() {
      isDragging.current = false;
    }

    canvas.addEventListener("pointerdown", startDrag, true);
    window.addEventListener("pointermove", drag);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);

    return () => {
      canvas.removeEventListener("pointerdown", startDrag, true);
      window.removeEventListener("pointermove", drag);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
    };
  }, [camera, floorPlane, gl, hitPoint, onUpdateCustomWall, pointer, raycaster, room]);

  return null;
}

function FirstPersonAimFollower({
  room,
  customWalls,
  layouts,
  doors,
  selectedImageId,
  selectedWallId,
  selectedDoorId,
  transformTool,
  isGrabActive,
  onUpdateImageLayout,
  onUpdateCustomWall,
  onUpdateDoor,
}: {
  room: GalleryRoomConfig;
  customWalls: GalleryCustomWall[];
  layouts: GalleryLayouts;
  doors: GalleryDoor[];
  selectedImageId: string | null;
  selectedWallId: string | null;
  selectedDoorId: string | null;
  transformTool: EditorTransformTool;
  isGrabActive: boolean;
  onUpdateImageLayout: (id: string, patch: Partial<GalleryFrameLayout>) => void;
  onUpdateCustomWall: (id: string, patch: Partial<GalleryCustomWall>) => void;
  onUpdateDoor: (id: string, patch: Partial<GalleryDoor>) => void;
}) {
  const { camera } = useThree();
  const ray = useMemo(() => new THREE.Ray(), []);
  const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hitPoint = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const lastUpdate = useRef(0);

  useFrame((state) => {
    if (
      !isGrabActive ||
      transformTool !== "move" ||
      document.pointerLockElement !== state.gl.domElement
    ) {
      return;
    }

    if (state.clock.elapsedTime - lastUpdate.current < 0.025) {
      return;
    }

    lastUpdate.current = state.clock.elapsedTime;
    camera.getWorldDirection(direction);
    ray.set(camera.position, direction);

    if (selectedWallId) {
      if (!ray.intersectPlane(floorPlane, hitPoint)) {
        return;
      }

      const wall = customWalls.find((item) => item.id === selectedWallId);
      if (!wall) {
        return;
      }

      const nextX = THREE.MathUtils.lerp(
        wall.x,
        hitPoint.x - roomOffset(room, wall.roomIndex),
        0.18,
      );
      const nextZ = THREE.MathUtils.lerp(wall.z, hitPoint.z, 0.18);

      onUpdateCustomWall(selectedWallId, {
        x: nextX,
        z: nextZ,
      });
      return;
    }

    if (!selectedImageId && !selectedDoorId) {
      return;
    }

    let bestHit:
      | {
          distance: number;
          wall: GalleryWallTarget;
          offset: number;
          height: number;
        }
      | null = null;

    for (const target of getAllWallTargets(room, customWalls)) {
      const basis = getWallBasis(room, target, customWalls);
      if (!basis) {
        continue;
      }

      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(basis.normal, basis.position);
      if (!ray.intersectPlane(plane, hitPoint)) {
        continue;
      }

      const local = hitPoint.clone().sub(basis.position);
      const offset = local.dot(basis.axis);
      const height = hitPoint.y;

      if (
        Math.abs(offset) > basis.length / 2 ||
        height < 0.25 ||
        height > basis.height + 0.2
      ) {
        continue;
      }

      const distance = hitPoint.distanceTo(camera.position);
      if (!bestHit || distance < bestHit.distance) {
        bestHit = {
          distance,
          wall: target,
          offset,
          height,
        };
      }
    }

    if (!bestHit) {
      return;
    }

    if (selectedImageId) {
      const current = layouts[selectedImageId];
      onUpdateImageLayout(selectedImageId, {
        wall: bestHit.wall,
        offset: current
          ? THREE.MathUtils.lerp(current.offset, bestHit.offset, 0.22)
          : bestHit.offset,
        height: current
          ? THREE.MathUtils.lerp(current.height, bestHit.height, 0.22)
          : bestHit.height,
      });
      return;
    }

    if (selectedDoorId) {
      const currentDoor = doors.find((door) => door.id === selectedDoorId);
      onUpdateDoor(selectedDoorId, {
        wall: bestHit.wall,
        offset: currentDoor
          ? THREE.MathUtils.lerp(currentDoor.offset, bestHit.offset, 0.22)
          : bestHit.offset,
      });
    }
  });

  return null;
}

function findEditableHit(
  intersections: THREE.Intersection[],
  options: { wallOnly?: boolean } = {},
): EditableHit | null {
  for (const hit of intersections) {
    let current: THREE.Object3D | null = hit.object;

    while (current) {
      const target = current.userData.editableTarget as EditableHitTarget | undefined;

      if (target) {
        const isWallTarget = target.kind === "builtWall" || target.kind === "customWall";

        if (options.wallOnly && !isWallTarget) {
          break;
        }

        return {
          target,
          object: hit.object,
          point: hit.point,
        };
      }

      current = current.parent;
    }
  }

  return null;
}

function FirstPersonEditorPicker({
  isEditMode,
  editorViewMode,
  pendingPlacementImageId,
  room,
  customWalls,
  onSelectImage,
  onSelectWall,
  onSelectDoor,
  onSelectRoom,
  onPlaceImageOnWall,
  onAimTargetChange,
  onBuilderPlacementChange,
}: {
  isEditMode: boolean;
  editorViewMode: EditorViewMode;
  pendingPlacementImageId: string | null;
  room: GalleryRoomConfig;
  customWalls: GalleryCustomWall[];
  onSelectImage: (id: string) => void;
  onSelectWall: (id: string) => void;
  onSelectDoor: (id: string) => void;
  onSelectRoom: (roomIndex: number) => void;
  onPlaceImageOnWall: (wall: GalleryWallTarget, offset: number, height: number) => void;
  onAimTargetChange: (label: string | null) => void;
  onBuilderPlacementChange: (target: BuilderPlacementTarget | null) => void;
}) {
  const { camera, gl, scene } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const center = useMemo(() => new THREE.Vector2(0, 0), []);
  const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const floorHit = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const lastAimKey = useRef<string | null>(null);
  const lastPlacementKey = useRef<string | null>(null);
  const latestHit = useRef<EditableHit | null>(null);

  function getEditableHit(wallOnly = false) {
    raycaster.setFromCamera(center, camera);
    return findEditableHit(raycaster.intersectObjects(scene.children, true), { wallOnly });
  }

  function setAimLabel(hit: EditableHit | null) {
    const key = hit ? `${hit.target.kind}:${hit.target.label}` : null;

    if (lastAimKey.current === key) {
      return;
    }

    lastAimKey.current = key;
    onAimTargetChange(hit?.target.label ?? null);
  }

  function emitBuilderPlacement(target: BuilderPlacementTarget | null) {
    const key = target
      ? [
          target.roomIndex,
          target.x.toFixed(2),
          target.z.toFixed(2),
          target.wall ?? "",
          target.wallOffset?.toFixed(2) ?? "",
        ].join(":")
      : null;

    if (lastPlacementKey.current === key) {
      return;
    }

    lastPlacementKey.current = key;
    onBuilderPlacementChange(target);
  }

  function getBuilderPlacement(hit: EditableHit | null) {
    if (hit) {
      const basePoint = hit.point.clone();
      const target = hit.target;

      if (target.kind === "builtWall") {
        const local = hit.object.worldToLocal(hit.point.clone());
        const dimensions = getRoomDimensions(room, target.roomIndex);
        return getPlacementFromWorldPoint(room, basePoint, {
          wall: target.wall,
          wallOffset: local.x,
          wallHeight: clamp(local.y + dimensions.height / 2, 1.1, dimensions.height - 1.1),
          label: target.label,
        });
      }

      if (target.kind === "customWall") {
        const wall = customWalls.find((item) => item.id === target.id);
        const local = hit.object.worldToLocal(hit.point.clone());

        if (wall) {
          return getPlacementFromWorldPoint(room, basePoint, {
            wall: wall.id,
            wallOffset: local.x,
            wallHeight: clamp(local.y + wall.height / 2, 1.1, wall.height - 0.45),
            label: wall.name,
          });
        }
      }

      return getPlacementFromWorldPoint(room, basePoint);
    }

    camera.getWorldDirection(direction);
    const ray = raycaster.ray;
    ray.set(camera.position, direction);

    if (ray.intersectPlane(floorPlane, floorHit)) {
      return getPlacementFromWorldPoint(room, floorHit);
    }

    const fallbackPoint = camera.position.clone().addScaledVector(direction, 4);
    fallbackPoint.y = 0;
    return getPlacementFromWorldPoint(room, fallbackPoint);
  }

  function placeOnWall(hit: EditableHit) {
    const target = hit.target;

    if (target.kind !== "builtWall" && target.kind !== "customWall") {
      return false;
    }

    const local = hit.object.worldToLocal(hit.point.clone());

    if (target.kind === "builtWall") {
      const dimensions = getRoomDimensions(room, target.roomIndex);
      onPlaceImageOnWall(
        target.wall,
        local.x,
        clamp(local.y + dimensions.height / 2, 1.1, dimensions.height - 1.1),
      );
      return true;
    }

    if (target.kind !== "customWall") {
      return false;
    }

    const wall = customWalls.find((item) => item.id === target.id);
    if (!wall) {
      return false;
    }

    onPlaceImageOnWall(
      wall.id,
      local.x,
      clamp(local.y + wall.height / 2, 1.1, wall.height - 0.45),
    );
    return true;
  }

  function selectHit(hit: EditableHit) {
    if (hit.target.kind === "artwork") {
      onSelectImage(hit.target.id);
      return;
    }

    if (hit.target.kind === "customWall") {
      onSelectWall(hit.target.id);
      return;
    }

    if (hit.target.kind === "door") {
      onSelectDoor(hit.target.id);
      return;
    }

    onSelectRoom(hit.target.roomIndex);
  }

  useFrame(() => {
    if (!isEditMode || editorViewMode !== "firstPerson") {
      latestHit.current = null;
      setAimLabel(null);
      return;
    }

    const hit = getEditableHit(Boolean(pendingPlacementImageId));
    const placementHit =
      hit?.target.kind === "builtWall" || hit?.target.kind === "customWall"
        ? hit
        : getEditableHit(true) ?? hit;
    latestHit.current = hit;
    setAimLabel(hit);
    emitBuilderPlacement(getBuilderPlacement(placementHit));
  });

  useEffect(() => {
    const canvas = gl.domElement;

    function onPointerDown(event: PointerEvent) {
      if (
        !isEditMode ||
        editorViewMode !== "firstPerson" ||
        event.button !== 0 ||
        event.target !== canvas
      ) {
        return;
      }

      const hit = pendingPlacementImageId ? getEditableHit(true) : latestHit.current ?? getEditableHit();
      if (!hit) {
        return;
      }

      if (pendingPlacementImageId && placeOnWall(hit)) {
        event.preventDefault();
        return;
      }

      selectHit(hit);
    }

    canvas.addEventListener("pointerdown", onPointerDown, true);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [
    camera,
    customWalls,
    editorViewMode,
    gl,
    isEditMode,
    onPlaceImageOnWall,
    onSelectDoor,
    onSelectImage,
    onSelectRoom,
    onSelectWall,
    pendingPlacementImageId,
    raycaster,
    room.height,
    scene,
  ]);

  useEffect(() => {
    if (!isEditMode || editorViewMode !== "firstPerson") {
      onAimTargetChange(null);
      onBuilderPlacementChange(null);
      lastAimKey.current = null;
      lastPlacementKey.current = null;
    }
  }, [editorViewMode, isEditMode, onAimTargetChange, onBuilderPlacementChange]);

  return null;
}

function Wall({
  length,
  height,
  position,
  rotation = [0, 0, 0],
  onClick,
  editableTarget,
}: {
  length: number;
  height: number;
  position: [number, number, number];
  rotation?: [number, number, number];
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
  editableTarget?: EditableHitTarget;
}) {
  return (
    <mesh
      position={position}
      rotation={rotation}
      receiveShadow
      onClick={onClick}
      userData={editableTarget ? { editableTarget } : undefined}
    >
      <planeGeometry args={[length, height]} />
      <meshStandardMaterial color="#e7e1d3" roughness={0.88} />
    </mesh>
  );
}

function CustomWall({
  wall,
  room,
  isEditMode,
  isSelected,
  editorViewMode,
  transformTool,
  pendingPlacementImageId,
  onSelectWall,
  onUpdateCustomWall,
  onPlaceImageOnWall,
}: {
  wall: GalleryCustomWall;
  room: GalleryRoomConfig;
  isEditMode: boolean;
  isSelected: boolean;
  editorViewMode: EditorViewMode;
  transformTool: EditorTransformTool;
  pendingPlacementImageId: string | null;
  onSelectWall: (id: string) => void;
  onUpdateCustomWall: (id: string, patch: Partial<GalleryCustomWall>) => void;
  onPlaceImageOnWall: (wall: GalleryWallTarget, offset: number, height: number) => void;
}) {
  const xOffset = roomOffset(room, wall.roomIndex);
  const dragPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const dragPoint = useMemo(() => new THREE.Vector3(), []);
  const isDragging = useRef(false);
  const editableTarget: EditableHitTarget = {
    kind: "customWall",
    id: wall.id,
    label: wall.name,
  };

  function selectWall() {
    if (isEditMode) {
      onSelectWall(wall.id);
    }
  }

  function handleClick(event: ThreeEvent<MouseEvent>) {
    if (!isEditMode) {
      return;
    }

    event.stopPropagation();

    if (editorViewMode === "firstPerson") {
      return;
    }

    if (!pendingPlacementImageId) {
      selectWall();
      return;
    }

    const local = event.object.worldToLocal(event.point.clone());
    onPlaceImageOnWall(wall.id, local.x, clamp(local.y + wall.height / 2, 1.1, wall.height - 0.45));
  }

  function startDrag(event: ThreeEvent<PointerEvent>) {
    if (!isEditMode || pendingPlacementImageId || editorViewMode !== "topdown" || transformTool !== "move") {
      return;
    }

    event.stopPropagation();
    selectWall();
    isDragging.current = true;
    const target = event.target as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
  }

  function drag(event: ThreeEvent<PointerEvent>) {
    if (!isDragging.current || !event.ray.intersectPlane(dragPlane, dragPoint)) {
      return;
    }

    event.stopPropagation();
    onUpdateCustomWall(wall.id, {
      x: dragPoint.x - xOffset,
      z: dragPoint.z,
    });
  }

  function stopDrag(event: ThreeEvent<PointerEvent>) {
    if (!isDragging.current) {
      return;
    }

    const target = event.target as HTMLElement;
    target.releasePointerCapture?.(event.pointerId);
    isDragging.current = false;
  }

  return (
    <group position={[xOffset + wall.x, wall.height / 2, wall.z]} rotation={[0, wall.rotation, 0]}>
      {isSelected ? (
        <mesh position={[0, 0, 0]} onClick={handleClick} userData={{ editableTarget }}>
          <boxGeometry args={[wall.length + 0.28, wall.height + 0.18, 0.24]} />
          <meshBasicMaterial color="#f6c453" transparent opacity={0.28} />
        </mesh>
      ) : null}
      <mesh
        onClick={handleClick}
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        receiveShadow
        castShadow
        userData={{ editableTarget }}
      >
        <boxGeometry args={[wall.length, wall.height, 0.18]} />
        <meshStandardMaterial color={isSelected ? "#e7dbc0" : "#ded7c8"} roughness={0.82} />
      </mesh>
      <mesh position={[0, 0, 0.096]} onClick={handleClick} userData={{ editableTarget }}>
        <planeGeometry args={[wall.length, wall.height]} />
        <meshStandardMaterial color="#eee8da" roughness={0.9} />
      </mesh>
      {isEditMode && editorViewMode === "topdown" && !pendingPlacementImageId ? (
        <mesh
          position={[0, -wall.height / 2 + 0.08, 0]}
          onClick={handleClick}
          onPointerDown={startDrag}
          onPointerMove={drag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          userData={{ editableTarget }}
        >
          <boxGeometry args={[wall.length, 0.08, 0.9]} />
          <meshBasicMaterial
            color={isSelected ? "#f6c453" : "#3b342c"}
            transparent
            opacity={isSelected ? 0.34 : 0.12}
          />
        </mesh>
      ) : null}
    </group>
  );
}

function Door({
  door,
  room,
  customWalls,
  isEditMode,
  isSelected,
  editorViewMode,
  onSelectDoor,
  onToggleDoor,
}: {
  door: GalleryDoor;
  room: GalleryRoomConfig;
  customWalls: GalleryCustomWall[];
  isEditMode: boolean;
  isSelected: boolean;
  editorViewMode: EditorViewMode;
  onSelectDoor: (id: string) => void;
  onToggleDoor: (id: string) => void;
}) {
  const builtWall = parseBuiltWallTarget(door.wall);
  const customWall = builtWall
    ? null
    : customWalls.find((wall) => wall.id === door.wall) ?? null;
  const mount = builtWall
    ? getWallMount(room, builtWall.wall, builtWall.roomIndex)
    : customWall
      ? getCustomWallMount(room, customWall)
      : null;

  if (!mount) {
    return null;
  }

  const editableTarget: EditableHitTarget = {
    kind: "door",
    id: door.id,
    label: door.name,
  };

  function handleClick(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();

    if (!isEditMode) {
      onToggleDoor(door.id);
      return;
    }

    if (editorViewMode === "firstPerson") {
      return;
    }
    onSelectDoor(door.id);
  }

  return (
    <group position={mount.position} rotation={mount.rotation}>
      <group position={[door.offset, door.height / 2, 0.14]}>
        {isSelected ? (
          <mesh position={[0, 0, -0.018]}>
            <boxGeometry args={[door.width + 0.36, door.height + 0.28, 0.12]} />
            <meshBasicMaterial color="#f6c453" transparent opacity={0.44} />
          </mesh>
        ) : null}
        <mesh position={[0, 0, -0.02]} onClick={handleClick} userData={{ editableTarget }}>
          <boxGeometry args={[door.width + 0.24, door.height + 0.18, 0.14]} />
          <meshStandardMaterial color="#2d251e" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0, 0.045]} onClick={handleClick} userData={{ editableTarget }}>
          <boxGeometry args={[door.width, door.height, 0.09]} />
          <meshStandardMaterial color="#0f0d0b" roughness={0.9} />
        </mesh>
        <group
          position={[-door.width / 2, 0, 0.11]}
          rotation={[0, door.isOpen ? -Math.PI / 2.8 : 0, 0]}
        >
          <mesh position={[door.width / 2, 0, 0]} onClick={handleClick} userData={{ editableTarget }}>
            <boxGeometry args={[door.width, door.height, 0.1]} />
            <meshStandardMaterial color="#594638" roughness={0.6} metalness={0.04} />
          </mesh>
          <mesh
            position={[door.width * 0.84, 0.03, 0.07]}
            onClick={handleClick}
            userData={{ editableTarget }}
          >
            <sphereGeometry args={[0.055, 12, 12]} />
            <meshStandardMaterial color="#d2b56d" roughness={0.38} metalness={0.42} />
          </mesh>
        </group>
        <mesh position={[0, door.height / 2 + 0.06, 0.08]}>
          <boxGeometry args={[door.width + 0.42, 0.12, 0.18]} />
          <meshStandardMaterial color="#7a6754" roughness={0.65} />
        </mesh>
      </group>
    </group>
  );
}

function Artwork({
  image,
  layout,
  room,
  customWalls,
  isSelected,
  isEditable,
  editorViewMode,
  onSelect,
}: {
  image: GalleryImage;
  layout: GalleryFrameLayout;
  room: GalleryRoomConfig;
  customWalls: GalleryCustomWall[];
  isSelected: boolean;
  isEditable: boolean;
  editorViewMode: EditorViewMode;
  onSelect: () => void;
}) {
  const builtWall = parseBuiltWallTarget(layout.wall);
  const customWall = builtWall
    ? null
    : customWalls.find((wall) => wall.id === layout.wall) ?? null;
  const mount = builtWall
    ? getWallMount(room, builtWall.wall, builtWall.roomIndex)
    : customWall
      ? getCustomWallMount(room, customWall)
      : null;
  const texture = useLoader(THREE.TextureLoader, image.url);
  const aspect = image.width / image.height || 1.42;
  const width = layout.width;
  const height = width / aspect;

  useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
  }, [texture]);

  if (!mount) {
    return null;
  }

  const editableTarget: EditableHitTarget = {
    kind: "artwork",
    id: image.id,
    label: image.name,
  };

  function handleClick(event: ThreeEvent<MouseEvent>) {
    if (!isEditable) {
      return;
    }

    event.stopPropagation();
    if (editorViewMode === "firstPerson") {
      return;
    }
    onSelect();
  }

  return (
    <group position={mount.position} rotation={mount.rotation}>
      <group position={[layout.offset, layout.height, 0]}>
        {isSelected ? (
          <mesh position={[0, 0, 0.015]}>
            <planeGeometry args={[width + 0.62, height + 0.62]} />
            <meshBasicMaterial color="#f6c453" transparent opacity={0.9} />
          </mesh>
        ) : null}
        <mesh
          position={[0, 0, 0.05]}
          castShadow
          onClick={handleClick}
          userData={{ editableTarget }}
        >
          <boxGeometry args={[width + 0.34, height + 0.34, 0.12]} />
          <meshStandardMaterial color="#2f2a22" roughness={0.45} />
        </mesh>
        <mesh position={[0, 0, 0.13]} onClick={handleClick} userData={{ editableTarget }}>
          <planeGeometry args={[width + 0.1, height + 0.1]} />
          <meshStandardMaterial color="#f7f1e4" roughness={0.72} />
        </mesh>
        <mesh position={[0, 0, 0.2]} onClick={handleClick} userData={{ editableTarget }}>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
        <pointLight position={[0, 1.35, 0.45]} intensity={0.55} distance={4.2} color="#fff6df" />
      </group>
    </group>
  );
}

function EmptyFrames({ count, room }: { count: number; room: GalleryRoomConfig }) {
  const frames = Array.from({ length: count }, (_, index) => {
    const wall = wallOrder[Math.floor(index / 3) % wallOrder.length];
    const slot = index % 3;
    const usableLength = Math.max(5, getWallLength(room, wall) - 3.6);

    return {
      wall,
      offset: clamp((slot - 1) * Math.max(2.8, usableLength / 3), -usableLength / 2, usableLength / 2),
      height: clamp(room.height * 0.48, 2.2, room.height - 1.15),
    };
  });

  return (
    <>
      {frames.map((layout, index) => {
        const mount = getWallMount(room, layout.wall);

        return (
          <group key={index} position={mount.position} rotation={mount.rotation}>
            <group position={[layout.offset, layout.height, 0]}>
              <mesh position={[0, 0, 0.05]}>
                <boxGeometry args={[2.8, 2.0, 0.12]} />
                <meshStandardMaterial color="#4b4034" roughness={0.5} />
              </mesh>
              <mesh position={[0, 0, 0.14]}>
                <planeGeometry args={[2.45, 1.65]} />
                <meshStandardMaterial color="#d8d0c0" roughness={0.9} />
              </mesh>
            </group>
          </group>
        );
      })}
    </>
  );
}

export default function GalleryScene({
  images,
  layouts,
  roomConfig,
  customWalls,
  doors,
  mode,
  editorViewMode,
  transformTool,
  editorSettings,
  isGrabActive,
  pendingPlacementImageId,
  selectedImageId,
  selectedWallId,
  selectedDoorId,
  selectedRoomIndex,
  onSelectImage,
  onSelectWall,
  onSelectDoor,
  onSelectRoom,
  onUpdateImageLayout,
  onUpdateCustomWall,
  onUpdateDoor,
  onToggleDoor,
  onPlaceImageOnWall,
  onAimTargetChange,
  onBuilderPlacementChange,
}: GallerySceneProps) {
  const isEditMode = mode === "edit";
  const useTopdownEditor = isEditMode && editorViewMode === "topdown";
  const selectedWallForDrag =
    useTopdownEditor && transformTool === "move" && selectedWallId
      ? customWalls.find((wall) => wall.id === selectedWallId) ?? null
      : null;

  return (
    <Canvas
      shadows
      camera={{ fov: 72, position: [0, eyeHeight, 7], near: 0.1, far: 80 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#151515"]} />
      <fog attach="fog" args={["#151515", 20, 42]} />
      <ambientLight intensity={0.38} />
      <directionalLight position={[3, roomConfig.height + 3, 5]} intensity={0.8} castShadow />
      <spotLight
        position={[0, roomConfig.height - 0.35, 0]}
        angle={0.95}
        penumbra={0.6}
        intensity={1.2}
      />
      {Array.from({ length: roomConfig.roomCount }, (_, roomIndex) => (
        <Room
          key={roomIndex}
          room={roomConfig}
          roomIndex={roomIndex}
          isEditMode={isEditMode}
          isSelected={selectedRoomIndex === roomIndex}
          editorViewMode={editorViewMode}
          pendingPlacementImageId={pendingPlacementImageId}
          onSelectRoom={onSelectRoom}
          onPlaceImageOnWall={onPlaceImageOnWall}
        />
      ))}
      {customWalls.map((wall) => (
        <CustomWall
          key={wall.id}
          wall={wall}
          room={roomConfig}
          isEditMode={isEditMode}
          isSelected={selectedWallId === wall.id}
          editorViewMode={editorViewMode}
          transformTool={transformTool}
          pendingPlacementImageId={pendingPlacementImageId}
          onSelectWall={onSelectWall}
          onUpdateCustomWall={onUpdateCustomWall}
          onPlaceImageOnWall={onPlaceImageOnWall}
        />
      ))}
      {selectedWallForDrag ? (
        <>
          <SelectedWallDragSurface
            wall={selectedWallForDrag}
            room={roomConfig}
            onUpdateCustomWall={onUpdateCustomWall}
          />
          <SelectedWallDomDrag
            wall={selectedWallForDrag}
            room={roomConfig}
            onUpdateCustomWall={onUpdateCustomWall}
          />
        </>
      ) : null}
      {doors.map((door) => (
        <Door
          key={door.id}
          door={door}
          room={roomConfig}
          customWalls={customWalls}
          isEditMode={isEditMode}
          isSelected={selectedDoorId === door.id}
          editorViewMode={editorViewMode}
          onSelectDoor={onSelectDoor}
          onToggleDoor={onToggleDoor}
        />
      ))}
      {images.length > 0 ? (
        images.map((image, index) => (
          <Artwork
            key={image.id}
            image={image}
            layout={layouts[image.id] ?? getDefaultLayout(image, index, roomConfig)}
            room={roomConfig}
            customWalls={customWalls}
            isSelected={isEditMode && selectedImageId === image.id}
            isEditable={isEditMode}
            editorViewMode={editorViewMode}
            onSelect={() => onSelectImage(image.id)}
          />
        ))
      ) : (
        <EmptyFrames count={6} room={roomConfig} />
      )}
      {useTopdownEditor ? (
        <>
          <EditorCameraControls room={roomConfig} />
          <TopdownBuilderPlacementTracker
            isEditMode={isEditMode}
            editorViewMode={editorViewMode}
            room={roomConfig}
            onBuilderPlacementChange={onBuilderPlacementChange}
          />
        </>
      ) : (
        <>
          <FirstPersonLookControls
            mode={mode}
            mouseSensitivity={editorSettings.mouseSensitivity}
          />
          <PlayerMovement room={roomConfig} settings={editorSettings} />
          {isEditMode ? (
            <>
              <FirstPersonEditorPicker
                isEditMode={isEditMode}
                editorViewMode={editorViewMode}
                pendingPlacementImageId={pendingPlacementImageId}
                room={roomConfig}
                customWalls={customWalls}
                onSelectImage={onSelectImage}
                onSelectWall={onSelectWall}
                onSelectDoor={onSelectDoor}
                onSelectRoom={onSelectRoom}
                onPlaceImageOnWall={onPlaceImageOnWall}
                onAimTargetChange={onAimTargetChange}
                onBuilderPlacementChange={onBuilderPlacementChange}
              />
              <FirstPersonAimFollower
                room={roomConfig}
                customWalls={customWalls}
                layouts={layouts}
                doors={doors}
                selectedImageId={selectedImageId}
                selectedWallId={selectedWallId}
                selectedDoorId={selectedDoorId}
                transformTool={transformTool}
                isGrabActive={isGrabActive}
                onUpdateImageLayout={onUpdateImageLayout}
                onUpdateCustomWall={onUpdateCustomWall}
                onUpdateDoor={onUpdateDoor}
              />
            </>
          ) : null}
        </>
      )}
    </Canvas>
  );
}

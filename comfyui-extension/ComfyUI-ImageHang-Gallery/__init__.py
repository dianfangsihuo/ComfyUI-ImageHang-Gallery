from __future__ import annotations

import json
import os
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

from aiohttp import web
from PIL import Image

import folder_paths
from server import PromptServer


WEB_DIRECTORY = "web"
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}


DATA_DIR = Path(folder_paths.get_user_directory()) / "image_hang_gallery"
IMAGE_DIR = DATA_DIR / "images"
STATE_FILE = DATA_DIR / "gallery.json"

DEFAULT_SETTINGS = {
    "autoStore": False,
    "openOnStart": True,
    "dedupeGenerated": True,
}


def _ensure_dirs() -> None:
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)


def _default_state() -> dict[str, Any]:
    return {
        "version": 1,
        "images": [],
        "settings": DEFAULT_SETTINGS.copy(),
    }


def _load_state() -> dict[str, Any]:
    _ensure_dirs()
    if not STATE_FILE.exists():
        return _default_state()

    try:
        with STATE_FILE.open("r", encoding="utf-8") as file:
            state = json.load(file)
    except Exception:
        return _default_state()

    state.setdefault("version", 1)
    state.setdefault("images", [])
    state["settings"] = {
        **DEFAULT_SETTINGS,
        **state.get("settings", {}),
    }
    return state


def _save_state(state: dict[str, Any]) -> None:
    _ensure_dirs()
    tmp = STATE_FILE.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as file:
        json.dump(state, file, ensure_ascii=False, indent=2)
        file.write("\n")
    tmp.replace(STATE_FILE)


def _json_response(payload: Any) -> web.Response:
    return web.json_response(payload, dumps=lambda data: json.dumps(data, ensure_ascii=False))


def _safe_rel_path(value: str | None) -> str:
    if not value:
        return ""
    cleaned = value.replace("\\", "/").strip("/")
    parts = [part for part in cleaned.split("/") if part and part not in {".", ".."}]
    return "/".join(parts)


def _source_path(image: dict[str, Any]) -> Path | None:
    filename = image.get("filename")
    if not filename:
        return None

    folder_type = image.get("type", "output")
    base = folder_paths.get_directory_by_type(folder_type)
    if base is None:
        return None

    subfolder = _safe_rel_path(image.get("subfolder"))
    base_path = Path(base).resolve()
    source = (base_path / subfolder / os.path.basename(filename)).resolve()

    try:
        source.relative_to(base_path)
    except ValueError:
        return None

    return source if source.is_file() else None


def _image_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as img:
        return img.size


def _gallery_url(filename: str) -> str:
    return f"/image-hang-gallery/image/{filename}"


def _record_for_file(
    source: Path,
    *,
    original_name: str | None = None,
    origin: dict[str, Any] | None = None,
) -> dict[str, Any]:
    _ensure_dirs()
    image_id = str(uuid.uuid4())
    extension = source.suffix.lower() or ".png"
    dest_name = f"{image_id}{extension}"
    dest = IMAGE_DIR / dest_name
    shutil.copy2(source, dest)
    width, height = _image_size(dest)

    return {
        "id": image_id,
        "name": original_name or source.name,
        "filename": dest_name,
        "url": _gallery_url(dest_name),
        "width": width,
        "height": height,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "source": "local",
        "origin": origin or {},
    }


def _fingerprint(image: dict[str, Any]) -> str:
    return json.dumps(
        {
            "filename": image.get("filename", ""),
            "subfolder": image.get("subfolder", ""),
            "type": image.get("type", "output"),
        },
        ensure_ascii=False,
        sort_keys=True,
    )


@PromptServer.instance.routes.get("/image-hang-gallery/state")
async def get_state(request: web.Request) -> web.Response:
    state = _load_state()
    return _json_response(
        {
            "ok": True,
            "state": state,
            "dataDir": str(DATA_DIR),
        }
    )


@PromptServer.instance.routes.post("/image-hang-gallery/settings")
async def update_settings(request: web.Request) -> web.Response:
    body = await request.json()
    state = _load_state()
    state["settings"] = {
        **DEFAULT_SETTINGS,
        **state.get("settings", {}),
        **(body.get("settings", {}) if isinstance(body, dict) else {}),
    }
    _save_state(state)
    return _json_response({"ok": True, "settings": state["settings"]})


@PromptServer.instance.routes.post("/image-hang-gallery/import-generated")
async def import_generated(request: web.Request) -> web.Response:
    body = await request.json()
    images = body.get("images", []) if isinstance(body, dict) else []
    state = _load_state()
    settings = state.get("settings", DEFAULT_SETTINGS)
    existing = {
        item.get("origin", {}).get("fingerprint")
        for item in state.get("images", [])
        if item.get("origin", {}).get("fingerprint")
    }
    imported: list[dict[str, Any]] = []
    skipped = 0

    for image in images:
        if not isinstance(image, dict):
            continue

        fingerprint = _fingerprint(image)
        if settings.get("dedupeGenerated", True) and fingerprint in existing:
            skipped += 1
            continue

        source = _source_path(image)
        if source is None:
            skipped += 1
            continue

        record = _record_for_file(
            source,
            original_name=image.get("filename"),
            origin={
                "kind": "comfyui-generated",
                "fingerprint": fingerprint,
                "filename": image.get("filename"),
                "subfolder": image.get("subfolder", ""),
                "type": image.get("type", "output"),
            },
        )
        state["images"].insert(0, record)
        existing.add(fingerprint)
        imported.append(record)

    if imported:
        _save_state(state)

    return _json_response({"ok": True, "imported": imported, "skipped": skipped})


@PromptServer.instance.routes.delete("/image-hang-gallery/image/{image_id}")
async def delete_image(request: web.Request) -> web.Response:
    image_id = request.match_info["image_id"]
    state = _load_state()
    kept = []
    removed = None

    for image in state.get("images", []):
        if image.get("id") == image_id:
            removed = image
            continue
        kept.append(image)

    state["images"] = kept
    if removed:
        filename = os.path.basename(removed.get("filename", ""))
        if filename:
            try:
                (IMAGE_DIR / filename).unlink(missing_ok=True)
            except Exception:
                pass
        _save_state(state)

    return _json_response({"ok": True, "removed": bool(removed)})


@PromptServer.instance.routes.get("/image-hang-gallery/image/{filename}")
async def get_image(request: web.Request) -> web.StreamResponse:
    filename = os.path.basename(request.match_info["filename"])
    path = IMAGE_DIR / filename
    if not path.is_file():
        return web.Response(status=404)
    return web.FileResponse(path)

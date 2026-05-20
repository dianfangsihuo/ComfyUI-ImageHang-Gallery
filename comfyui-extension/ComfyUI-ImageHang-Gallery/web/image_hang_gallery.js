import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const stateUrl = "/image-hang-gallery/state";
const settingsUrl = "/image-hang-gallery/settings";
const importUrl = "/image-hang-gallery/import-generated";

let panel;
let grid;
let statusLine;
let autoStoreToggle;
let openOnStartToggle;
let settings = {
  autoStore: false,
  openOnStart: true,
  dedupeGenerated: true,
};
let knownFingerprints = new Set();

function imageFingerprint(image) {
  return JSON.stringify({
    filename: image.filename || "",
    subfolder: image.subfolder || "",
    type: image.type || "output",
  });
}

function setStatus(text) {
  if (statusLine) {
    statusLine.textContent = text;
  }
}

async function fetchJson(url, options) {
  const response = await api.fetchApi(url, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return await response.json();
}

function injectStyle() {
  if (document.getElementById("image-hang-gallery-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "image-hang-gallery-style";
  style.textContent = `
    .image-hang-toggle {
      position: fixed;
      right: 18px;
      bottom: 84px;
      z-index: 9999;
      border: 1px solid rgba(255,255,255,.16);
      border-radius: 8px;
      padding: 9px 12px;
      color: #f7f0e3;
      background: #2f281f;
      box-shadow: 0 10px 30px rgba(0,0,0,.34);
      font: 800 13px/1.1 system-ui, sans-serif;
      cursor: pointer;
    }

    .image-hang-panel {
      position: fixed;
      top: 64px;
      right: 18px;
      width: min(380px, calc(100vw - 32px));
      max-height: calc(100vh - 96px);
      z-index: 9998;
      display: none;
      flex-direction: column;
      gap: 12px;
      padding: 14px;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 8px;
      color: #f7f0e3;
      background: rgba(30, 26, 22, .96);
      box-shadow: 0 18px 48px rgba(0,0,0,.42);
      font-family: system-ui, sans-serif;
    }

    .image-hang-panel.open {
      display: flex;
    }

    .image-hang-head,
    .image-hang-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .image-hang-head strong {
      font-size: 15px;
    }

    .image-hang-head button,
    .image-hang-actions button {
      border: 0;
      border-radius: 6px;
      padding: 7px 10px;
      color: #2f281f;
      background: #eadcc9;
      font-weight: 800;
      cursor: pointer;
    }

    .image-hang-row {
      padding: 9px 10px;
      border-radius: 6px;
      background: rgba(255,255,255,.07);
      font-size: 13px;
    }

    .image-hang-row label {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }

    .image-hang-status {
      color: #d5c7b5;
      font-size: 12px;
      min-height: 16px;
    }

    .image-hang-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      overflow: auto;
      padding-right: 2px;
    }

    .image-hang-card {
      border: 1px solid rgba(255,255,255,.11);
      border-radius: 8px;
      overflow: hidden;
      background: rgba(255,255,255,.06);
    }

    .image-hang-card img {
      display: block;
      width: 100%;
      aspect-ratio: 1 / .72;
      object-fit: cover;
      background: #16130f;
    }

    .image-hang-card footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 7px 8px;
      font-size: 12px;
    }

    .image-hang-card span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .image-hang-card button {
      border: 0;
      border-radius: 5px;
      padding: 4px 6px;
      color: #f5d6d0;
      background: rgba(143,48,38,.42);
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

function makeToggleButton() {
  const button = document.createElement("button");
  button.className = "image-hang-toggle";
  button.textContent = "画廊";
  button.addEventListener("click", () => {
    panel.classList.toggle("open");
  });
  document.body.appendChild(button);
}

function makePanel() {
  panel = document.createElement("section");
  panel.className = "image-hang-panel";
  panel.innerHTML = `
    <div class="image-hang-head">
      <strong>Image Hang 画廊</strong>
      <button type="button" data-action="refresh">刷新</button>
    </div>
    <div class="image-hang-row">
      <label><input type="checkbox" data-setting="autoStore"> 自动收集生成图</label>
    </div>
    <div class="image-hang-row">
      <label><input type="checkbox" data-setting="openOnStart"> 启动后自动弹出</label>
    </div>
    <div class="image-hang-status"></div>
    <div class="image-hang-grid"></div>
  `;
  document.body.appendChild(panel);

  grid = panel.querySelector(".image-hang-grid");
  statusLine = panel.querySelector(".image-hang-status");
  autoStoreToggle = panel.querySelector('[data-setting="autoStore"]');
  openOnStartToggle = panel.querySelector('[data-setting="openOnStart"]');

  panel.querySelector('[data-action="refresh"]').addEventListener("click", () => {
    void loadGallery();
  });

  autoStoreToggle.addEventListener("change", () => {
    settings.autoStore = autoStoreToggle.checked;
    void saveSettings();
  });

  openOnStartToggle.addEventListener("change", () => {
    settings.openOnStart = openOnStartToggle.checked;
    void saveSettings();
  });
}

function renderImages(images) {
  grid.innerHTML = "";
  knownFingerprints = new Set(
    images
      .map((image) => image.origin?.fingerprint)
      .filter(Boolean),
  );

  if (!images.length) {
    const empty = document.createElement("div");
    empty.className = "image-hang-status";
    empty.textContent = "画廊里还没有图片。开启自动收集后，生成完成的图片会进入这里。";
    grid.appendChild(empty);
    return;
  }

  for (const image of images) {
    const card = document.createElement("article");
    card.className = "image-hang-card";
    card.innerHTML = `
      <img src="${image.url}" loading="lazy" alt="">
      <footer>
        <span title="${image.name || ""}">${image.name || "Untitled"}</span>
        <button type="button">删除</button>
      </footer>
    `;
    card.querySelector("button").addEventListener("click", async () => {
      await fetchJson(`/image-hang-gallery/image/${encodeURIComponent(image.id)}`, {
        method: "DELETE",
      });
      await loadGallery();
    });
    grid.appendChild(card);
  }
}

async function loadGallery() {
  try {
    const data = await fetchJson(stateUrl);
    settings = {
      ...settings,
      ...(data.state?.settings || {}),
    };
    autoStoreToggle.checked = Boolean(settings.autoStore);
    openOnStartToggle.checked = Boolean(settings.openOnStart);
    renderImages(data.state?.images || []);
    setStatus(`保存目录：${data.dataDir || "ComfyUI/user/image_hang_gallery"}`);
  } catch (error) {
    setStatus(`读取画廊失败：${error.message || error}`);
  }
}

async function saveSettings() {
  try {
    await fetchJson(settingsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }),
    });
    setStatus(settings.autoStore ? "自动收集已开启" : "自动收集已关闭");
  } catch (error) {
    setStatus(`保存设置失败：${error.message || error}`);
  }
}

async function importGeneratedImages(images) {
  if (!settings.autoStore || !images?.length) {
    return;
  }

  const fresh = settings.dedupeGenerated
    ? images.filter((image) => !knownFingerprints.has(imageFingerprint(image)))
    : images;

  if (!fresh.length) {
    return;
  }

  try {
    const result = await fetchJson(importUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: fresh }),
    });
    if (result.imported?.length) {
      panel.classList.add("open");
      await loadGallery();
      setStatus(`已自动保存 ${result.imported.length} 张生成图`);
    }
  } catch (error) {
    setStatus(`自动保存失败：${error.message || error}`);
  }
}

function listenForGeneratedImages() {
  api.addEventListener("executed", ({ detail }) => {
    if (detail?.output?.images?.length) {
      void importGeneratedImages(detail.output.images);
    }
  });
}

app.registerExtension({
  name: "ImageHang.GalleryPanel",
  async setup() {
    injectStyle();
    makePanel();
    makeToggleButton();
    await loadGallery();
    listenForGeneratedImages();

    if (settings.openOnStart) {
      window.setTimeout(() => panel.classList.add("open"), 600);
    }
  },
});

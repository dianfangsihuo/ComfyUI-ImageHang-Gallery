import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const dataDir = path.resolve(process.cwd(), ".gallery-data");
const imageDir = path.join(dataDir, "images");
const galleryFile = path.join(dataDir, "gallery.json");

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function safeImageExtension(mimeType: string) {
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  if (mimeType === "image/gif") {
    return "gif";
  }
  return "jpg";
}

function localGalleryPersistencePlugin(): Plugin {
  return {
    name: "local-gallery-persistence",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (
        request: IncomingMessage,
        response: ServerResponse,
        next: () => void,
      ) => {
        if (!request.url) {
          next();
          return;
        }

        const url = new URL(request.url, "http://localhost");

        if (url.pathname.startsWith("/gallery-data/images/")) {
          const fileName = path.basename(url.pathname);
          const filePath = path.join(imageDir, fileName);

          try {
            const file = await fs.readFile(filePath);
            response.statusCode = 200;
            response.setHeader("Cache-Control", "no-store");
            response.end(file);
          } catch {
            response.statusCode = 404;
            response.end("Not found");
          }
          return;
        }

        if (url.pathname === "/api/local-gallery" && request.method === "GET") {
          try {
            const raw = await fs.readFile(galleryFile, "utf8");
            sendJson(response, 200, { exists: true, state: JSON.parse(raw) });
          } catch {
            sendJson(response, 200, { exists: false, state: null });
          }
          return;
        }

        if (url.pathname === "/api/local-gallery" && request.method === "POST") {
          try {
            await fs.mkdir(dataDir, { recursive: true });
            const body = await readBody(request);
            const state = JSON.parse(body);
            await fs.writeFile(galleryFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
            sendJson(response, 200, { ok: true });
          } catch (error) {
            sendJson(response, 500, {
              ok: false,
              error: error instanceof Error ? error.message : "Failed to save gallery",
            });
          }
          return;
        }

        if (url.pathname === "/api/local-gallery/images" && request.method === "POST") {
          try {
            await fs.mkdir(imageDir, { recursive: true });
            const body = await readBody(request);
            const payload = JSON.parse(body) as {
              id: string;
              mimeType: string;
              data: string;
            };
            const extension = safeImageExtension(payload.mimeType);
            const fileName = `${payload.id}.${extension}`;
            const filePath = path.join(imageDir, fileName);
            await fs.writeFile(filePath, Buffer.from(payload.data, "base64"));
            sendJson(response, 200, { url: `/gallery-data/images/${fileName}` });
          } catch (error) {
            sendJson(response, 500, {
              error: error instanceof Error ? error.message : "Failed to save image",
            });
          }
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localGalleryPersistencePlugin()],
});

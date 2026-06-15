import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import cors from "cors";
import dotenv from "dotenv";
import { createProxyMiddleware } from "http-proxy-middleware";
import { startDjango } from "./run_backend.ts";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  console.log(`[${new Date().toISOString()}] Starting server on port ${PORT}...`);

  // Start Django backend
  try {
    startDjango();
  } catch (err) {
    console.error("Failed to trigger startDjango:", err);
  }

  app.use(cors());
  app.use(express.json());

  // Health check - handle before proxy
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), env: process.env.NODE_ENV });
  });

  // Proxy API and Admin requests to Django
  app.use(
    ["/api", "/django-admin", "/static", "/media"],
    createProxyMiddleware({
      target: "http://127.0.0.1:8001",
      changeOrigin: true,
      pathFilter: (reqPath) => reqPath !== "/api/health",
      on: {
        error: (err, req, res) => {
          console.error(`Proxy Error for ${req.url}:`, err.message);
          if (!res.headersSent) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: "Backend not ready.", details: err.message }));
          }
        }
      }
    })
  );

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      console.warn("Warning: 'dist' folder not found. Static files will not be served.");
      app.get('*', (req, res) => {
        res.status(404).send("Production build not found. Please run 'npm run build'.");
      });
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[${new Date().toISOString()}] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Critical server startup error:", err);
  process.exit(1);
});

import http from "node:http";
import { runPublish } from "./publish.mjs";

const host = process.env.PUBLISH_HOST || "127.0.0.1";
const port = Number(process.env.PUBLISH_PORT || 8787);
let state = { status: "idle", message: "等待发布", updatedAt: new Date().toISOString() };

function reply(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function publishInBackground() {
  try {
    const result = await runPublish({
      onProgress(message) {
        state = { status: "running", message, updatedAt: new Date().toISOString() };
      }
    });
    state = { status: "success", message: "发布成功", result, updatedAt: new Date().toISOString() };
  } catch (error) {
    state = { status: "failed", message: error.message, updatedAt: new Date().toISOString() };
  }
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/status")) {
    return reply(response, 200, state);
  }
  if (request.method === "POST" && url.pathname === "/publish") {
    if (state.status === "running") return reply(response, 409, { error: "已有发布任务正在运行", state });
    state = { status: "running", message: "准备发布", updatedAt: new Date().toISOString() };
    setImmediate(publishInBackground);
    return reply(response, 202, state);
  }
  return reply(response, 404, { error: "Not found" });
});

server.listen(port, host, () => {
  console.log(`[publisher] listening on http://${host}:${port}`);
});

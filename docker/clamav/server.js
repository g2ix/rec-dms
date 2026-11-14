const http = require("node:http");
const net = require("node:net");

const port = Number(process.env.PORT || 8080);
const token = process.env.CLAMAV_TOKEN || "";
const clamdHost = process.env.CLAMD_HOST || "127.0.0.1";
const clamdPort = Number(process.env.CLAMD_PORT || 3310);

function authorized(req) {
  const header = req.headers.authorization || "";
  return token.length > 0 && header === `Bearer ${token}`;
}

function scan(req) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(clamdPort, clamdHost);
    let response = "";
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.on("error", reject);
    socket.on("end", () => {
      const line = response.trim();
      if (line.endsWith("OK")) resolve({ clean: true });
      else {
        const signature = line.replace(/^stream:\s*/i, "").replace(/\s+FOUND$/i, "");
        resolve({ clean: false, signature });
      }
    });
    socket.write("zINSTREAM\0");
    req.on("data", (chunk) => {
      const size = Buffer.alloc(4);
      size.writeUInt32BE(chunk.length);
      socket.write(size);
      socket.write(chunk);
    });
    req.on("end", () => {
      socket.write(Buffer.alloc(4));
      socket.end();
    });
    req.on("error", reject);
  });
}

function ping() {
  return new Promise((resolve, reject) => {
    const socket = net.connect(clamdPort, clamdHost);
    let response = "";
    socket.setTimeout(2000, () => {
      socket.destroy();
      reject(new Error("clamd timeout"));
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.on("error", reject);
    socket.on("end", () => resolve(response.includes("PONG")));
    socket.end("zPING\0");
  });
}

const server = http.createServer(async (req, res) => {
  if (!authorized(req)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  try {
    if (req.method === "GET" && req.url === "/health") {
      const ok = await ping();
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok }));
      return;
    }
    if (req.method === "POST" && req.url === "/scan") {
      const result = await scan(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (error) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "scan failed" }));
  }
});

async function waitForClamd() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if (await ping()) return;
    } catch {
      // clamd is still loading the signature databases.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("clamd did not answer PING");
}

waitForClamd()
  .then(() => server.listen(port, "0.0.0.0"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

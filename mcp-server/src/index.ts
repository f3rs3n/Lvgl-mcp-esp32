import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SimulatorManager } from "./simulator/manager.js";
import { registerRenderTools } from "./tools/render.js";
import { registerInspectTools } from "./tools/inspect.js";
import { registerConfigTools } from "./tools/config.js";
import { registerResources } from "./resources/api-reference.js";
import * as http from "node:http";
import * as path from "node:path";
import { existsSync } from "node:fs";

interface CliOptions {
  transport: "stdio" | "http";
  host: string;
  port: number;
  path: string;
  authToken?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    transport: (process.env["LVGL_MCP_TRANSPORT"] as "stdio" | "http" | undefined) ?? "stdio",
    host: process.env["LVGL_MCP_HOST"] ?? "127.0.0.1",
    port: Number.parseInt(process.env["LVGL_MCP_PORT"] ?? "3333", 10),
    path: process.env["LVGL_MCP_PATH"] ?? "/mcp",
    authToken: process.env["LVGL_MCP_AUTH_TOKEN"],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--transport") {
      if (next !== "stdio" && next !== "http") {
        throw new Error("--transport must be either 'stdio' or 'http'");
      }
      options.transport = next;
      i += 1;
    } else if (arg === "--host") {
      if (!next) throw new Error("--host requires a value");
      options.host = next;
      i += 1;
    } else if (arg === "--port") {
      if (!next) throw new Error("--port requires a value");
      options.port = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === "--path") {
      if (!next) throw new Error("--path requires a value");
      options.path = next.startsWith("/") ? next : `/${next}`;
      i += 1;
    } else if (arg === "--auth-token") {
      if (!next) throw new Error("--auth-token requires a value");
      options.authToken = next;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.error(`Usage: lvgl-mcp-server [--transport stdio|http] [--host 127.0.0.1] [--port 3333] [--path /mcp] [--auth-token token]\n\nEnvironment overrides: LVGL_MCP_TRANSPORT, LVGL_MCP_HOST, LVGL_MCP_PORT, LVGL_MCP_PATH, LVGL_MCP_AUTH_TOKEN, LVGL_PROJECT_ROOT`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error("port must be a number between 1 and 65535");
  }
  return options;
}

function resolveProjectRoot(): string {
  // Determine project root — supports two modes:
  //
  // 1. Dev mode (git clone): LVGL_PROJECT_ROOT env var, or auto-detect as grandparent
  //    of dist/index.js → mcp-server/ → Lvgl-mcp-esp32/
  //
  // 2. npm mode (npx lvgl-mcp-server): simulator/ is downloaded by postinstall
  //    next to dist/ inside the npm package directory.
  const dirname =
    import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);
  const packageDir = path.resolve(dirname, "..");

  if (process.env["LVGL_PROJECT_ROOT"]) {
    // Explicit override — always wins
    return process.env["LVGL_PROJECT_ROOT"];
  }
  if (existsSync(path.join(packageDir, "simulator"))) {
    // npm mode: simulator/ was downloaded by postinstall into the package dir
    return packageDir;
  }
  // Dev mode: dist/ is inside mcp-server/ which is inside the project root
  return path.resolve(dirname, "..", "..");
}

function createMcpServer(manager: SimulatorManager): McpServer {
  const server = new McpServer({
    name: "lvgl-simulator",
    version: "1.2.0",
  });

  registerRenderTools(server, manager);
  registerInspectTools(server, manager);
  registerConfigTools(server, manager);
  registerResources(server, manager);

  return server;
}

function isAuthorized(req: http.IncomingMessage, authToken?: string): boolean {
  if (!authToken) return true;
  const header = req.headers["authorization"];
  const values = Array.isArray(header) ? header : header ? [header] : [];
  return values.some((value) => value === `Bearer ${authToken}`);
}

async function startHttpServer(manager: SimulatorManager, options: CliOptions): Promise<void> {
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${options.host}:${options.port}`}`);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "lvgl-mcp-server", transport: "http" }));
      return;
    }

    if (url.pathname !== options.path) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    if (!isAuthorized(req, options.authToken)) {
      res.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    if (!["GET", "POST", "DELETE"].includes(req.method ?? "")) {
      res.writeHead(405, { "allow": "GET, POST, DELETE", "content-type": "application/json" });
      res.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    const requestServer = createMcpServer(manager);
    const requestTransport = new StreamableHTTPServerTransport({
      // Stateless HTTP transports must be one-shot per SDK contract.
      // The shared simulator manager keeps useful cross-request state such as
      // the most recent render for lvgl_inspect.
      sessionIdGenerator: undefined,
    });
    requestTransport.onerror = (error) => {
      console.error("[lvgl-mcp] Streamable HTTP transport error:", error);
    };

    try {
      await requestServer.connect(requestTransport);
      let parsedBody: unknown = undefined;
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const rawBody = Buffer.concat(chunks).toString("utf8");
        parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
      }
      await requestTransport.handleRequest(req, res, parsedBody);
    } catch (error) {
      console.error("[lvgl-mcp] HTTP request failed:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal_server_error" }));
      } else {
        res.end();
      }
    }
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(options.port, options.host, resolve);
  });

  console.error(`[lvgl-mcp] HTTP server listening on http://${options.host}:${options.port}${options.path}`);
  console.error(`[lvgl-mcp] Health endpoint: http://${options.host}:${options.port}/health`);

  const shutdown = async () => {
    console.error("[lvgl-mcp] Shutting down HTTP server...");
    httpServer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function startStdioServer(manager: SimulatorManager): Promise<void> {
  const server = createMcpServer(manager);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[lvgl-mcp] Server connected and ready.");
}

const options = parseArgs(process.argv.slice(2));
const projectRoot = resolveProjectRoot();

// CRITICAL: Never use console.log in stdio MCP servers — it corrupts JSON-RPC.
// Use console.error for all debug/diagnostic output.
console.error(`[lvgl-mcp] Starting LVGL MCP server...`);
console.error(`[lvgl-mcp] Project root: ${projectRoot}`);
console.error(`[lvgl-mcp] Transport: ${options.transport}`);

const manager = new SimulatorManager(projectRoot);

if (options.transport === "http") {
  await startHttpServer(manager, options);
} else {
  await startStdioServer(manager);
}

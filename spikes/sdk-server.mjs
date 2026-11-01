// Spike: servidor MCP mínimo sobre @modelcontextprotocol/sdk 1.x (stdio).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "spike", version: "0.0.1" });
server.registerTool("ping", { description: "Responde pong", annotations: { readOnlyHint: true } },
  async () => ({ content: [{ type: "text", text: "pong" }] }));
server.registerTool("ping_interactive", {
  description: "Responde pong, exige aprobación humana",
  annotations: { destructiveHint: true },
  _meta: { "anthropic/requiresUserInteraction": true },
}, async () => ({ content: [{ type: "text", text: "pong-interactive" }] }));
server.registerTool("elicit_demo", { description: "Pide confirmación vía elicitation", inputSchema: { what: z.string() } },
  async ({ what }) => {
    const caps = server.server.getClientCapabilities();
    try {
      const r = await server.server.elicitInput({ message: `Confirmar ${what}?`,
        requestedSchema: { type: "object", properties: { ok: { type: "boolean", title: "Confirmo" } }, required: ["ok"] } });
      return { content: [{ type: "text", text: JSON.stringify({ caps, result: r }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ caps, error: String(e) }) }], isError: true };
    }
  });
await server.connect(new StdioServerTransport());
console.error("spike listo");

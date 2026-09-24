import "dotenv/config";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const SHOPIFY_MCP_URL =
  "https://trywav.myshopify.com/api/ucp/mcp";

const AGENT_PROFILE =
  "https://shopify.dev/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json";

const CHECKOUT_ID =
  "gid://shopify/Checkout/hWNH7Yxwyfd0osQ7wOm7qfy8?key=4f57c99f39e90d994dbeb497776b1dff";

const client = new Client({
  name: "shopify-checkout-test",
  version: "1.0.0",
});

const transport = new StreamableHTTPClientTransport(
  new URL(SHOPIFY_MCP_URL)
);

try {
  console.log("🔌 Connecting to Shopify MCP...");
  await client.connect(transport);

  console.log("✅ Connected!");
  console.log("\n🔍 Getting latest checkout...");

  const result = await client.callTool({
    name: "get_checkout",
    arguments: {
      id: CHECKOUT_ID,

      meta: {
        "ucp-agent": {
          profile: AGENT_PROFILE,
        },
      },
    },
  });

  console.log("\n📦 LATEST CHECKOUT:");
  console.log(
    JSON.stringify(result.structuredContent || result, null, 2)
  );
} catch (error) {
  console.error("\n❌ ERROR:");
  console.error(error);
}
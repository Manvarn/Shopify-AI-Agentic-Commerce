import "dotenv/config";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const SHOPIFY_MCP_URL =
  "https://trywav.myshopify.com/api/ucp/mcp";

const AGENT_PROFILE =
  "https://shopify.dev/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json";

const CHECKOUT_ID =
  "gid://shopify/Checkout/hWNH7Yxwyfd0osQ7wOm7qfy8?key=4f57c99f39e90d994dbeb497776b1dff";

const LINE_ITEM_ID =
  "gid://shopify/CartLine/2fa5d3d9-e5c0-4440-8037-29d7e651e0ea?cart=hWNH7Yxwyfd0osQ7wOm7qfy8";

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

  console.log("\n⚙️ Updating checkout...");

  const result = await client.callTool({
  name: "update_checkout",

  arguments: {
    id: CHECKOUT_ID,

    meta: {
      "ucp-agent": {
        profile: AGENT_PROFILE,
      },
    },

    checkout: {
  line_items: [
    {
      id: LINE_ITEM_ID,
      item: {
        id: "gid://shopify/ProductVariant/47936975372530",
      },
      quantity: 1,
    },
  ],

  buyer: {
    email: "test@example.com",
    phone_number: "+919876543210",
  },

      fulfillment: {
        methods: [
          {
            line_item_ids: [LINE_ITEM_ID],

            destinations: [
              {
                id: "destination-1",
                first_name: "Test",
                last_name: "Customer",
                street_address: "123 Test Street",
                address_locality: "Surat",
                address_region: "Gujarat",
                postal_code: "395007",
                address_country: "IN",
                phone_number: "+919876543210",
              },
            ],

            selected_destination_id: "destination-1",
          },
        ],
      },
    },
  },
});

  console.log("\n✅ CHECKOUT UPDATED!");
  console.log(
    JSON.stringify(result.structuredContent || result, null, 2)
  );
} catch (error) {
  console.error("\n❌ ERROR:");
  console.error(error);
}
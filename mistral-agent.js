import "dotenv/config";

import { Mistral } from "@mistralai/mistralai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const SHOPIFY_MCP_URL =
  "https://trywav.myshopify.com/api/ucp/mcp";

const AGENT_PROFILE =
  "https://shopify.dev/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json";

const mistral = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY,
});

const client = new Client({
  name: "shopify-mistral-agent",
  version: "1.0.0",
});

const transport = new StreamableHTTPClientTransport(
  new URL(SHOPIFY_MCP_URL)
);

try {
  console.log("🔌 Connecting Mistral Agent to Shopify MCP...");

  await client.connect(transport);

  console.log("✅ Shopify MCP Connected!");

  // Get Shopify MCP tools
  const mcpToolsResult = await client.listTools();

  // For this test, only expose product discovery tools
  const allowedTools = [
    "search_catalog",
    "lookup_catalog",
    "get_product",
  ];

  const shopifyTools = mcpToolsResult.tools.filter((tool) =>
    allowedTools.includes(tool.name)
  );

  console.log("\n🧰 Tools exposed to Mistral:");

  console.log(
    shopifyTools.map((tool) => `- ${tool.name}`).join("\n")
  );

  // Convert Shopify MCP tools into Mistral tool format
  const mistralTools = shopifyTools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description:
        tool.description || `Shopify MCP tool: ${tool.name}`,
      parameters: tool.inputSchema,
    },
  }));

  const userPrompt =
    "Find me a men's t-shirt under ₹500.";

  console.log("\n👤 CUSTOMER:");
  console.log(userPrompt);

  console.log("\n🤖 Mistral is deciding which Shopify tool to use...");

  const response = await mistral.chat.complete({
    model: "ministral-3b-2512",

    messages: [
      {
        role: "system",
        content: `
You are an AI shopping agent connected to a Shopify store.

Use the available Shopify tools whenever product information
is required.

For product discovery use search_catalog.

Important:
Shopify prices use minor currency units.

For INR:
₹500 = 50000 minor units.

Do not invent product information.
`,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],

    tools: mistralTools,
    toolChoice: "auto",
  });

  const message = response.choices?.[0]?.message;

  const toolCall = message?.toolCalls?.[0];

  if (!toolCall) {
    console.log("\n🤖 MISTRAL RESPONSE:");
    console.log(message?.content);
  } else {
    const toolName = toolCall.function.name;

    let toolArguments = toolCall.function.arguments;

    if (typeof toolArguments === "string") {
      toolArguments = JSON.parse(toolArguments);
    }

    console.log("\n🧠 AI SELECTED TOOL:");
    console.log(toolName);

    console.log("\n📦 AI GENERATED ARGUMENTS:");
    console.log(
      JSON.stringify(toolArguments, null, 2)
    );

    // Always inject the valid Shopify UCP agent profile
    toolArguments.meta = {
      ...(toolArguments.meta || {}),

      "ucp-agent": {
        ...(toolArguments.meta?.["ucp-agent"] || {}),
        profile: AGENT_PROFILE,
      },
    };

    console.log("\n⚙️ Calling Shopify MCP...");

    const shopifyResult = await client.callTool({
      name: toolName,
      arguments: toolArguments,
    });

    console.log("\n✅ Shopify MCP response received!");

    const structuredResult =
      shopifyResult.structuredContent || shopifyResult;

    console.log("\n📦 SHOPIFY RESULT:");

    console.log(
      JSON.stringify(structuredResult, null, 2)
    );
  }
} catch (error) {
  console.error("\n❌ ERROR:");
  console.error(error);
}
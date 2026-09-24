import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const SHOPIFY_MCP_URL =
  "https://trywav.myshopify.com/api/ucp/mcp";

const AGENT_PROFILE =
  "https://shopify.dev/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json";

// Gemini AI
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Shopify MCP
const client = new Client({
  name: "shopify-ai-agent",
  version: "1.0.0",
});

const transport = new StreamableHTTPClientTransport(
  new URL(SHOPIFY_MCP_URL)
);

try {
  console.log("Connecting to Shopify MCP...");

  await client.connect(transport);

  console.log("✅ Connected to Shopify MCP!");

  // Customer natural-language request
  const userPrompt = "Find me a men's t-shirt under ₹500";

  console.log("\n👤 Customer:");
  console.log(userPrompt);

  // Gemini understands customer intent
  console.log("\n🤖 Gemini understanding request...");

  const response = await ai.models.generateContent({
    model: "gemini-3.6-flash",
    contents: `
You are a Shopify shopping assistant.

Convert the customer's request into a short product search query
that can be sent to Shopify's catalog search.

Return ONLY the search query.
Do not include explanations.

Customer request:
${userPrompt}
`,
  });

  const searchQuery = response.text.trim();

  console.log("\n🤖 AI Search Query:");
  console.log(searchQuery);

  // Search real Shopify catalog through MCP
  console.log("\n🔎 Searching Shopify store...");

  const result = await client.callTool({
    name: "search_catalog",
    arguments: {
      meta: {
        "ucp-agent": {
          profile: AGENT_PROFILE,
        },
      },
      catalog: {
        query: searchQuery,
      },
    },
  });

  console.log("\n🛍️ Shopify Products:");
  console.log(JSON.stringify(result, null, 2));

} catch (error) {
  console.error("\n❌ Error:");
  console.error(error);
}
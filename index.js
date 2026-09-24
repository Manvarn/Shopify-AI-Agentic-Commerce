import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const SHOPIFY_MCP_URL =
  "https://trywav.myshopify.com/api/ucp/mcp";

const AGENT_PROFILE =
  "https://shopify.dev/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json";

// ==================================================
// GEMINI
// ==================================================

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// ==================================================
// SHOPIFY MCP CLIENT
// ==================================================

const client = new Client({
  name: "shopify-ai-agent",
  version: "1.0.0",
});

const transport = new StreamableHTTPClientTransport(
  new URL(SHOPIFY_MCP_URL)
);

try {
  // ==================================================
  // 1. CONNECT TO SHOPIFY MCP
  // ==================================================

  console.log("🔌 Connecting to Shopify MCP...");

  await client.connect(transport);

  console.log("✅ Shopify MCP Connected!");

  // ==================================================
  // 2. GET SHOPIFY MCP TOOLS
  // ==================================================

  const mcpToolsResult = await client.listTools();

  console.log("\n🧰 Shopify MCP tools found:");

  console.log(
    mcpToolsResult.tools
      .map((tool) => `- ${tool.name}`)
      .join("\n")
  );

  // ==================================================
  // 3. ALLOWED TOOLS
  // ==================================================

 const allowedTools = [
  "search_catalog",
  "get_product",
  "lookup_catalog",
  "create_cart",
  "create_checkout",
  "update_checkout",
  "get_checkout",
];

  const shopifyTools = mcpToolsResult.tools.filter((tool) =>
    allowedTools.includes(tool.name)
  );

  if (shopifyTools.length === 0) {
    throw new Error(
      "No required Shopify MCP tools were found."
    );
  }

  console.log("\n🤖 Tools exposed to Gemini:");

  console.log(
    shopifyTools
      .map((tool) => `- ${tool.name}`)
      .join("\n")
  );

  // ==================================================
  // 4. CONVERT MCP TO GEMINI FUNCTION DECLARATIONS
  // ==================================================

  const functionDeclarations = shopifyTools.map((tool) => ({
    name: tool.name,
    description:
      tool.description ||
      `Shopify MCP tool: ${tool.name}`,
    parameters: tool.inputSchema,
  }));

  // ==================================================
  // 5. CUSTOMER REQUEST
  // ==================================================

  const userPrompt =
  "Find the first available men's t-shirt under ₹500, add it to cart, and prepare the checkout for me.";

  console.log("\n👤 CUSTOMER:");
  console.log(userPrompt);

  // ==================================================
  // 6. INITIAL CONVERSATION
  // ==================================================

  const contents = [
    {
      role: "user",
      parts: [
        {
          text: `
You are an AI shopping agent connected to a Shopify store.

Your job is to understand the customer's request and use
the available Shopify tools to complete the request.

Rules:

1. For product discovery, use search_catalog.
2. If you need more information about one product, use get_product.
3. If the customer asks to add a product to the cart,
   first find the correct product/variant and then use create_cart.
4. Never invent a product or variant ID.
5. Only add an available variant.
6. Shopify prices are represented in minor currency units.
   For INR:
   ₹500 = 50000 minor units.
7. After creating the cart, create a checkout from that cart.
8. Add the buyer contact and shipping details to the checkout.
9. Use these test buyer details:
   Email: test@example.com
   Phone: +919876543210
   Name: Test Customer
   Address: 123 Test Street
   City: Surat
   State: Gujarat
   Postal code: 395007
   Country: IN
10. Select an available shipping method.
11. Use get_checkout to verify the final checkout state.
12. Stop when checkout status becomes "ready_for_complete".
13. Never submit payment.
14. Never call complete_checkout.

Customer request:

${userPrompt}
`,
        },
      ],
    },
  ];

  // ==================================================
  // 7. AGENT LOOP
  // ==================================================

  const MAX_STEPS = 10;

  for (let step = 1; step <= MAX_STEPS; step++) {
    console.log(
      `\n━━━━━━━━ STEP ${step} ━━━━━━━━`
    );

    console.log(
      "🤖 Gemini is deciding the next action..."
    );

    // ==================================================
    // 8. ASK GEMINI
    // ==================================================

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",

      contents,

      config: {
        tools: [
          {
            functionDeclarations,
          },
        ],
      },
    });

    // ==================================================
    // 9. GET FUNCTION CALL
    // ==================================================

    const functionCall =
      response.functionCalls?.[0];

    // ==================================================
    // 10. NO FUNCTION CALL = FINAL RESPONSE
    // ==================================================

    if (!functionCall) {
      console.log("\n🤖 GEMINI RESPONSE:");
      console.log(response.text);

      break;
    }

    console.log("\n🧠 AI SELECTED TOOL:");
    console.log(functionCall.name);

    console.log("\n📦 AI GENERATED ARGUMENTS:");

    console.log(
      JSON.stringify(
        functionCall.args,
        null,
        2
      )
    );

    // ==================================================
    // 11. IMPORTANT GEMINI 3 FIX
    //
    // Preserve the ORIGINAL model response.
    // This keeps thoughtSignature.
    // ==================================================

    const modelContent =
      response.candidates?.[0]?.content;

    if (!modelContent) {
      throw new Error(
        "Gemini model response content was not found."
      );
    }

    contents.push(modelContent);

    // ==================================================
    // 12. ADD SHOPIFY UCP AGENT PROFILE
    // ==================================================

    const toolArguments = {
      ...(functionCall.args || {}),
    };

    toolArguments.meta = {
      ...(toolArguments.meta || {}),

      "ucp-agent": {
        ...(toolArguments.meta?.["ucp-agent"] || {}),
        profile: AGENT_PROFILE,
      },
    };

    // ==================================================
    // 13. CALL SHOPIFY MCP
    // ==================================================

    console.log(
      "\n⚙️ Calling Shopify MCP..."
    );

    const shopifyResult = await client.callTool({
      name: functionCall.name,
      arguments: toolArguments,
    });

    console.log(
      "\n✅ Shopify MCP response received."
    );

    // ==================================================
    // 14. GET STRUCTURED RESULT
    // ==================================================

    const structuredResult =
      shopifyResult.structuredContent ||
      shopifyResult;

    console.log("\n📦 SHOPIFY RESULT:");

    console.log(
      JSON.stringify(
        structuredResult,
        null,
        2
      )
    );

    // ==================================================
    // 15. SEND TOOL RESULT BACK TO GEMINI
    // ==================================================

    contents.push({
      role: "user",
      parts: [
        {
          functionResponse: {
            name: functionCall.name,
            response: structuredResult,
          },
        },
      ],
    });

    // ==================================================
    // 16. CART CREATED
    // ==================================================

    if (
      functionCall.name ===
      "create_cart"
    ) {
      console.log(
        "\n🛒 CART CREATED SUCCESSFULLY!"
      );

      const cart =
        structuredResult?.cart ||
        structuredResult;

      if (cart?.id) {
        console.log("\nCart ID:");
        console.log(cart.id);
      }

      if (cart?.continue_url) {
        console.log("\nCart URL:");
        console.log(cart.continue_url);
      }

    }
  }

} catch (error) {
  console.error("\n❌ ERROR:");
  console.error(error);
}
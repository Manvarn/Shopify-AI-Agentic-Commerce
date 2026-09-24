import { Mistral } from "@mistralai/mistralai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

const SHOPIFY_MCP_URL =
  "https://trywav.myshopify.com/api/ucp/mcp";

const AGENT_PROFILE =
  "https://shopify.dev/ucp/agent-profiles/2026-08-25/valid-with-capabilities.json";

const mistral = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY,
});

const ALLOWED_TOOLS = [
  "search_catalog",
  "get_product",
  "lookup_catalog",
  "create_cart",
];

export const action = async ({ request }) => {
  await authenticate.admin(request);

  let client = null;

  try {
    const formData = await request.formData();

    const userPrompt = String(
      formData.get("message") || ""
    ).trim();

    const historyRaw = String(
      formData.get("history") || "[]"
    );

    if (!userPrompt) {
      return Response.json(
        {
          success: false,
          error: "Please enter a shopping request.",
        },
        { status: 400 }
      );
    }

    // ============================================
    // PARSE CONVERSATION HISTORY
    // ============================================

    let history = [];

    try {
      const parsedHistory = JSON.parse(historyRaw);

      if (Array.isArray(parsedHistory)) {
        history = parsedHistory;
      }
    } catch {
      history = [];
    }

    // ============================================
    // CONNECT TO SHOPIFY MCP
    // ============================================

    client = new Client({
      name: "shopify-ai-agent",
      version: "1.0.0",
    });

    const transport =
      new StreamableHTTPClientTransport(
        new URL(SHOPIFY_MCP_URL)
      );

    await client.connect(transport);

    // ============================================
    // GET SHOPIFY MCP TOOLS
    // ============================================

    const mcpToolsResult = await client.listTools();

    const shopifyTools = mcpToolsResult.tools.filter(
      (tool) => ALLOWED_TOOLS.includes(tool.name)
    );

    if (!shopifyTools.length) {
      throw new Error(
        "No required Shopify MCP tools are available."
      );
    }

    // ============================================
    // CONVERT SHOPIFY MCP TO MISTRAL TOOLS
    // ============================================

    const mistralTools = shopifyTools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description:
          tool.description ||
          `Shopify shopping tool: ${tool.name}`,
        parameters: tool.inputSchema,
      },
    }));

    // ============================================
    // BUILD CONVERSATION HISTORY
    // ============================================

    const conversationText = history
      .filter(
        (item) =>
          item &&
          typeof item.text === "string"
      )
      .map((item) => {
        const speaker =
          item.role === "assistant"
            ? "ASSISTANT"
            : "CUSTOMER";

        return `${speaker}: ${item.text}`;
      })
      .join("\n");

    // ============================================
    // SYSTEM INSTRUCTIONS
    // ============================================

    const systemPrompt = `
You are a conversational AI shopping assistant for a Shopify store.

Your first job is to understand what the customer actually wants.
Do NOT immediately search for products when important information is missing.

CONVERSATION RULES:

1. Read the complete conversation history before deciding what to do.

2. Remember information the customer already provided.

3. NEVER ask for the same information twice.

4. Ask only ONE clarification question at a time.

5. Do NOT ask unnecessary questions.

6. Questions must depend on the product type.

For fashion products such as shirts, t-shirts, dresses,
pants, shoes and jackets, useful information may include:

- Who it is for: Men, Women, Children, etc.
- Budget / price range
- Size
- Color

Do NOT blindly ask all of these if they are not useful.

For other products, ask relevant questions instead.

Examples:

Key holder:
budget, style, material or type.

Mobile phone:
budget, brand preference, storage.

Laptop:
budget, intended use, RAM or storage preference.

IMPORTANT SEARCH BEHAVIOUR:

If important information is missing,
DO NOT call search_catalog.

Ask ONE short clarification question instead.

Example conversation:

CUSTOMER: I want a shirt
ASSISTANT: Who is the shirt for — Men, Women, or Children?

CUSTOMER: Men
ASSISTANT: What budget are you looking for?

CUSTOMER: Under ₹500
ASSISTANT: What size do you need?

CUSTOMER: L
ASSISTANT: Do you have a preferred color?

CUSTOMER: Black

At this point enough useful information is available.
Search the LIVE Shopify catalog.

DIRECT SEARCH RULE:

If the customer already provides enough information
in the first message, search directly.

Example:

"Find a men's black t-shirt, size L, under ₹500."

Do not ask redundant questions.

SHOPIFY RULES:

- NEVER invent products.
- NEVER invent titles, prices, images, variants,
  availability, product IDs or variant IDs.
- Product information must come from Shopify MCP.
- Use search_catalog for product discovery.
- Use get_product when detailed product or variant
  information is required.
- Use lookup_catalog for exact catalog lookup.
- Only use create_cart after the customer clearly
  asks to add a product to cart.
- Never add a displayed product automatically.
- Only add an AVAILABLE variant.
- Never complete payment.
- Never place an order.
- Shopify prices use minor currency units.
- ₹500 = 50000 minor units.
- ₹1000 = 100000 minor units.

RESPONSE STYLE:

- Keep responses short and conversational.
- Ask only ONE question per response.
- Do not output markdown product tables.
- Do not expose internal tool names.
- If Shopify was searched, only describe products
  actually returned by Shopify.

CONVERSATION HISTORY:

${conversationText}

LATEST CUSTOMER MESSAGE:

${userPrompt}
`;

    // ============================================
    // MISTRAL MESSAGES
    // ============================================

    const messages = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ];

    // ============================================
    // AGENT LOOP
    // ============================================

    const MAX_STEPS = 6;

    let finalResponse = null;
    let createdCart = null;
    let lastShopifyResult = null;

    for (let step = 1; step <= MAX_STEPS; step++) {
      const response = await mistral.chat.complete({
        model: "ministral-3b-2512",
        messages,
        tools: mistralTools,
        toolChoice: "auto",
      });

      const assistantMessage =
        response.choices?.[0]?.message;

      if (!assistantMessage) {
        throw new Error(
          "Mistral returned an empty response."
        );
      }

      const toolCalls =
        assistantMessage.toolCalls || [];

      // ==========================================
      // NORMAL AI RESPONSE / QUESTION
      // ==========================================

      if (!toolCalls.length) {
        finalResponse =
          typeof assistantMessage.content === "string"
            ? assistantMessage.content
            : "Could you tell me a little more about what you are looking for?";

        break;
      }

      // Preserve Mistral assistant tool-call message
      messages.push(assistantMessage);

      // ==========================================
      // PROCESS TOOL CALLS
      // ==========================================

      for (const toolCall of toolCalls) {
        const functionName =
          toolCall.function?.name;

        if (
          !functionName ||
          !ALLOWED_TOOLS.includes(functionName)
        ) {
          throw new Error(
            "Mistral requested an unsupported Shopify tool."
          );
        }

        let toolArguments = {};

        try {
          const rawArguments =
            toolCall.function?.arguments;

          if (typeof rawArguments === "string") {
            toolArguments =
              JSON.parse(rawArguments || "{}");
          } else if (
            rawArguments &&
            typeof rawArguments === "object"
          ) {
            toolArguments = {
              ...rawArguments,
            };
          }
        } catch {
          throw new Error(
            "Mistral returned invalid tool arguments."
          );
        }

        // ========================================
        // ADD OFFICIAL UCP AGENT PROFILE
        // ========================================

        toolArguments.meta = {
          ...(toolArguments.meta || {}),

          "ucp-agent": {
            ...(
              toolArguments.meta?.["ucp-agent"] ||
              {}
            ),
            profile: AGENT_PROFILE,
          },
        };

        // ========================================
        // CALL SHOPIFY MCP
        // ========================================

        const shopifyResult =
          await client.callTool({
            name: functionName,
            arguments: toolArguments,
          });

        const structuredResult =
          shopifyResult.structuredContent ||
          shopifyResult;

        lastShopifyResult = structuredResult;

        // ========================================
        // SAVE CART
        // ========================================

        if (functionName === "create_cart") {
          createdCart =
            structuredResult?.cart ||
            structuredResult;
        }

        // ========================================
        // RETURN SHOPIFY RESULT TO MISTRAL
        // ========================================

        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          name: functionName,
          content: JSON.stringify(
            structuredResult
          ),
        });
      }
    }

    // ============================================
    // RETURN TO FRONTEND
    // ============================================

    return Response.json({
      success: true,
      message:
        finalResponse ||
        "I found matching products in the Shopify catalog.",
      cart: createdCart,
      shopifyResult: lastShopifyResult,
    });
  } catch (error) {
    console.error(
      "AI SHOPPING AGENT ERROR:",
      error
    );

    const errorMessage =
      error?.message ||
      "Something went wrong with the shopping agent.";

    // Cleaner rate-limit message
    if (
      error?.statusCode === 429 ||
      error?.status === 429 ||
      errorMessage.includes("429")
    ) {
      return Response.json(
        {
          success: false,
          error:
            "The AI service has reached its temporary request limit. Please try again shortly.",
        },
        { status: 429 }
      );
    }

    return Response.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  } finally {
    // ============================================
    // ALWAYS CLOSE MCP CONNECTION
    // ============================================

    if (client) {
      try {
        await client.close();
      } catch {
        // Ignore MCP close errors
      }
    }
  }
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
import { Mistral } from "@mistralai/mistralai";

const mistral = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY,
});

export async function action({ request }) {
  try {
    if (request.method !== "POST") {
      return Response.json(
        { error: "Method not allowed" },
        { status: 405 }
      );
    }

    const body = await request.json();

    const message =
      typeof body?.message === "string"
        ? body.message.trim()
        : "";

    const history =
      Array.isArray(body?.history)
        ? body.history.slice(-10)
        : [];

    if (!message) {
      return Response.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const messages = [
      {
        role: "system",
        content: `
You are an AI shopping assistant for a Shopify store.

Your job is to understand what the customer wants.

Rules:
- Understand English, Gujarati, Hindi and other languages.
- Understand spelling mistakes and incomplete product words.
- Never invent products, prices, inventory, variants or discounts.
- Product facts must come from Shopify data supplied by the storefront.
- Keep answers short and useful.
- If the customer is trying to find a product, identify the best normalized Shopify search query.
- If the customer asks for similar products, preserve the relevant previous product/search context.
- If the customer asks for cheaper products, detect that intent.
- Detect price limits such as "under 1000", "below ₹500", "500 thi niche".
- Detect cart-related commands.
- For general product questions, respond conversationally.

Return ONLY valid JSON in this exact structure:

{
  "intent": "search|similar|cheaper|product_question|cart_add|cart_remove|cart_view|checkout|general",
  "searchQuery": "",
  "maxPrice": null,
  "reply": ""
}

For search requests, searchQuery should contain a short corrected product search phrase.

Examples:

User: "brclte"
searchQuery: "bracelet"

User: "show snowboard"
searchQuery: "snowboard"

User: "1000 ni andar watch batavo"
searchQuery: "watch"
maxPrice: 1000

User: "mane sasta similar product batavo"
intent: "cheaper"

Do not include markdown around the JSON.
        `.trim(),
      },

      ...history
        .filter(
          (item) =>
            item &&
            ["user", "assistant"].includes(item.role) &&
            typeof item.content === "string"
        )
        .map((item) => ({
          role: item.role,
          content: item.content.slice(0, 2000),
        })),

      {
        role: "user",
        content: message,
      },
    ];

    const response = await mistral.chat.complete({
      model: "mistral-small-latest",
      messages,
      temperature: 0.1,
    });

    const raw =
      response?.choices?.[0]?.message?.content || "";

    let parsed;

    try {
      const cleaned = String(raw)
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim();

      parsed = JSON.parse(cleaned);
    } catch {
      parsed = {
        intent: "general",
        searchQuery: "",
        maxPrice: null,
        reply: String(raw || "How can I help you shop today?"),
      };
    }

    return Response.json({
      ok: true,
      intent: parsed.intent || "general",
      searchQuery: parsed.searchQuery || "",
      maxPrice:
        typeof parsed.maxPrice === "number"
          ? parsed.maxPrice
          : null,
      reply: parsed.reply || "",
    });
  } catch (error) {
    console.error("Storefront AI error:", error);

    return Response.json(
      {
        ok: false,
        error: "AI request failed",
      },
      { status: 500 }
    );
  }
}

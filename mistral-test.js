import "dotenv/config";
import { Mistral } from "@mistralai/mistralai";

const mistral = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY,
});

try {
  console.log("🤖 Testing Mistral AI...");

  const response = await mistral.chat.complete({
    model: "ministral-3b-2512",
    messages: [
      {
        role: "user",
        content: "Say: Mistral AI is working!",
      },
    ],
  });

  console.log("\n✅ MISTRAL RESPONSE:");
  console.log(response.choices[0].message.content);
} catch (error) {
  console.error("\n❌ ERROR:");
  console.error(error);
}
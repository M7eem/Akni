import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

async function test() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY;
  console.log("API Key length:", apiKey?.length, "starts with:", apiKey?.substring(0, 4));
  
  if (!apiKey) {
    console.log("No API key found");
    return;
  }
  
  const ai = new GoogleGenAI({ apiKey });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: 'Hello',
    });
    console.log("Success:", response.text);
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

test();

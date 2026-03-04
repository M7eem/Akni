import { GoogleGenAI, Type } from '@google/genai';

export async function generateFlashcards(
  text: string,
  images: Record<string, Buffer>,
  deckName: string,
  cardTypes: string[] = ['basic']
) {
  let apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY)?.trim();
  if (apiKey === 'undefined') apiKey = undefined;
  console.log("GeminiService API Key length:", apiKey?.length, "starts with:", apiKey?.substring(0, 4));
  if (!apiKey) throw new Error("API key not set in environment variables");
  const ai = new GoogleGenAI({ apiKey });
  return generateWithClient(ai, text, deckName, cardTypes);
}

async function generateWithClient(
  ai: GoogleGenAI,
  text: string,
  deckName: string,
  cardTypes: string[]
) {
  const model = 'gemini-3.1-pro-preview';

  const systemPrompt = `
You are an expert medical educator creating Anki flashcards.
FIRST — analyze the source material.

Extract every clinically significant, testable concept. Let the SOURCE decide the exact card count — never pad with unnecessary cards, and never miss an important concept or mechanism.

You must generate a mix of the following card types based on the user's selection: ${cardTypes.join(', ')}.

CARD TYPE FORMATS:
${cardTypes.includes('basic') ? `
BASIC CARDS (Standard Q&A)
Front: A question that requires deep understanding, clinical reasoning, or mechanism analysis.
Back: A complete answer that includes the pathophysiology, rationale, and clinical relevance.
Use these question styles:
- "What is the mechanism of X?"
- "Why does X cause Y?"
- "A patient presents with X — what is happening and why?"
- "Trace X step by step"
JSON type: "basic"
` : ''}
${cardTypes.includes('cloze') ? `
CLOZE CARDS (Fill-in-the-blank)
Use standard Anki cloze syntax: {{c1::hidden text}}
CRITICAL: Only use c1. Do not use c2, c3, etc. 
Only hide the most high-yield word or phrase. The surrounding sentence must provide enough clinical context to answer without guessing.
JSON type: "cloze"
Front: The full sentence with cloze deletions.
Back: Additional explanation, mechanism, or clinical relevance.
` : ''}

CARD PHILOSOPHY:
Each card must be DENSE and COMPLETE.
Do not split one concept into multiple thin cards.
Make one card that covers the full picture of that concept. A student should finish this deck and deeply understand the topic's core concept, underlying mechanism, clinical presentation, and exam traps.
Only generate these if the source actually covers them — do not invent content.

FORMATTING RULES:
Bold all key terms using <b>tags</b>.
Use <br> for line breaks — never raw newlines.
Spell out abbreviations on first use.
No emoji, no labels, no formatting gimmicks.
Answers must be complete — never vague or one word.

STRICTLY FORBIDDEN:
- Do not generate cards for content not in the source.
- Do not split one concept into multiple thin cards.
- Do not pad the deck to reach an arbitrary number.

OUTPUT FORMAT:
Return a JSON array of objects. Each object must strictly follow this schema:
[
  {
    "type": "basic" | "cloze",
    "front": "string",
    "back": "string",
    "image": null
  }
]
`;

  // Text only — images are handled separately by the occlusion pipeline
  const parts = [
    { text: `Deck name: ${deckName}\n\nLecture content:\n\n${text}` }
  ];

  try {
    const response = await ai.models.generateContent({
      model,
      contents: { role: 'user', parts },
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING },
              front: { type: Type.STRING },
              back: { type: Type.STRING },
              image: { type: Type.STRING }
            },
            required: ['type', 'front', 'back']
          }
        }
      }
    });

    const jsonText = response.text;
    if (!jsonText) throw new Error("Empty response from AI");

    const clean = jsonText.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);

  } catch (error) {
    console.error("AI Generation Error:", error);
    throw error;
  }
}
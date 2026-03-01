import { GoogleGenAI, Type } from '@google/genai';

export async function generateFlashcards(text: string, images: Record<string, Buffer>, deckName: string, cardTypes: string[] = ['basic']) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set in environment variables");
  const ai = new GoogleGenAI({ apiKey });
  return generateWithClient(ai, text, images, deckName, cardTypes);
}

async function generateWithClient(ai: GoogleGenAI, text: string, images: Record<string, Buffer>, deckName: string, cardTypes: string[]) {
  const model = 'gemini-3.1-pro-preview';

  const systemPrompt = `
You are a medical flashcard generator. Your job is to create high-quality Anki flashcards from the lecture content provided.

You must generate a mix of the following card types based on the user's selection: ${cardTypes.join(', ')}.

CARD TYPES & FORMATS:

${cardTypes.includes('basic') ? `
1. BASIC CARDS (Standard Q&A)
   - Front: A focused question.
   - Back: The answer + reasoning.
   - JSON Type: "basic"
` : ''}

${cardTypes.includes('cloze') ? `
2. CLOZE DELETION CARDS (Fill-in-the-blank)
   - Use Anki syntax: {{c1::hidden text}}.
   - Can have multiple clozes (c1, c2) if distinct concepts.
   - JSON Type: "cloze"
   - Front: The full sentence with clozes.
` : ''}

${cardTypes.includes('image_occlusion') ? `
3. IMAGE FOCUS CARDS (Visual ID)
   - Ask to identify structures in the provided images.
   - JSON Type: "image_occlusion"
   - Front: Question + Image.
   - Back: Answer + Explanation.
` : ''}

GENERAL QUALITY RULES:
- Every card tests ONE concept only.
- Bold key terms using <b>tags</b>.
- Use <br> for line breaks.
- Spell out abbreviations on first use.

OUTPUT FORMAT:
Return a JSON array only.
Each card object must have a "type" field matching one of the requested types.

Example:
[
  {
    "type": "basic",
    "front": "What is the function of X?",
    "back": "It does Y.",
    "image": null
  },
  {
    "type": "cloze",
    "front": "The {{c1::mitochondria}} is the powerhouse of the cell.",
    "back": "Extra info here",
    "image": null
  },
  {
    "type": "image_occlusion",
    "front": "Identify the structure shown.",
    "back": "This is the <b>Thalamus</b>.",
    "image": "fig1.png"
  }
]
`;

  const parts: any[] = [];

  let imageCount = 0;
  for (const name of Object.keys(images)) {
    if (imageCount >= 15) break;
    parts.push({
      inlineData: {
        mimeType: 'image/png',
        data: images[name].toString('base64')
      }
    });
    parts.push({ text: `[Image filename: ${name}]` });
    imageCount++;
  }

  parts.push({ text: `Deck name: ${deckName}\n\nLecture content:\n\n${text}` });

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
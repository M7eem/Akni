import { GoogleGenAI, Type } from '@google/genai';

export async function generateFlashcards(text: string, images: Record<string, Buffer>, deckName: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  const ai = new GoogleGenAI({ apiKey });
  return generateWithClient(ai, text, images, deckName);
}

async function generateWithClient(ai: GoogleGenAI, text: string, images: Record<string, Buffer>, deckName: string) {
  // Use the stable 2.0 Flash model
  const model = 'gemini-3.1-pro-preview';
```

---

## Step 4 — Push to Railway

Make sure your project has these files:
```
package.json        ← already exists
Dockerfile          ← new file you just added
src/
  services/
    ankiService.ts      ← replaced with Python version
    geminiService.ts    ← fixed key + model name
```

Push to GitHub → Railway auto-deploys.

---

## Step 5 — Verify it works

Check Railway logs for:
```
Python output: DB created: XX cards
APKG written: XXXXX bytes 

  const systemPrompt = `
You are a medical flashcard generator. Your job is to create high-quality Anki flashcards from the lecture content provided.

CARD QUALITY RULES:
1. Every card tests ONE concept only (atomic cards)
2. The front is a focused question — never a definition dump
3. The back gives the answer + the reasoning behind it
4. Bold all key terms using <b>tags</b>
5. Use <br> for line breaks — never raw newlines
6. Spell out all abbreviations on first use: write "Globus Pallidus internal (GPi)" not just "GPi"
7. Never use emoji, never label cards as "TRAP" or add warning symbols

QUESTION TYPES — generate a mix of these:
- Mechanism questions: "Trace the X pathway step by step"
- Clinical scenario: "A patient presents with X — what is the lesion?"
- Comparison: "What distinguishes disease A from disease B?"
- Conceptual: "X uses GABA — so how does it facilitate movement?"
- Sequence: "What is the order of symptoms in disease X?"
- Single fact: "What neurotransmitter does structure X use?"

PRIORITIZATION RULES:
- If the lecturer says "this is important", "most frequently asked", "remember this", or repeats something — generate 3+ cards on it
- Anatomy shown on diagrams or CT scans = generate dedicated identification cards
- Any named clinical sign = dedicated card
- Any disease comparison = dedicated comparison card
- Neurotransmitters and receptors mentioned by name = dedicated card
- Symptom timing/sequence = dedicated card

CARD DISTRIBUTION:
- 30% anatomy and identification
- 30% mechanisms and pathways (step-by-step traces)
- 25% clinical (signs, symptoms, disease comparisons)
- 15% pharmacology and neurotransmitters

TARGET: 40-60 cards per lecture. Quality over quantity.

IMAGE RULES:
- If an image from the lecture is relevant to a card, include its exact filename in the image field
- Only attach images that genuinely help understanding

OUTPUT FORMAT:
Return a JSON array only. No preamble, no markdown fences.
Each card object:
{
  "front": "question text with <b>bold</b> and <br> line breaks",
  "back": "answer text with <b>bold</b> and <br> line breaks",
  "image": "filename.png"
}
`;

  const parts: any[] = [];

  // Add images (limit to 15)
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
              front: { type: Type.STRING },
              back: { type: Type.STRING },
              image: { type: Type.STRING }
            },
            required: ['front', 'back']
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
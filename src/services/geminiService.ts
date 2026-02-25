import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateFlashcards(text: string, images: Record<string, Buffer>, deckName: string) {
  const model = 'gemini-2.5-pro-preview-05-06'; // Or gemini-3.1-pro-preview for better reasoning
  
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
- Conceptual trap: "X uses GABA — so how does it facilitate movement?"
- Sequence: "What is the order of symptoms in disease X?"
- Single fact: "What neurotransmitter does structure X use?"

PRIORITIZATION RULES:
- If the lecturer says "this is important", "most frequently asked", "remember this", or repeats something — generate 3+ cards on it
- Anatomy shown on diagrams or CT scans = generate dedicated identification cards
- Any named clinical sign (e.g. pill-rolling tremor, mask-like face) = dedicated card
- Any disease comparison made by the lecturer = dedicated comparison card
- Neurotransmitters and receptors mentioned by name = dedicated card
- Symptom timing/sequence = dedicated card (this is a common MCQ trap)

CARD DISTRIBUTION:
- 30% anatomy and identification
- 30% mechanisms and pathways (step-by-step traces)
- 25% clinical (signs, symptoms, disease comparisons)
- 15% pharmacology and neurotransmitters

TARGET: 40–60 cards per lecture. Quality over quantity.

IMAGE RULES:
- If an image from the lecture is relevant to a card (e.g. CT scan, pathway diagram, anatomical structure), include its filename in the card's image field
- Only attach images that genuinely help understanding — not decorative images
- The image filename MUST match exactly one of the filenames provided in the context.

OUTPUT FORMAT:
Return a JSON array only.
Each card object:
{
  "front": "question text with <b>bold</b> and <br> line breaks",
  "back": "answer text with <b>bold</b> and <br> line breaks",
  "image": "slide_3_img_1.png"  // optional — omit if no image
}
`;

  const parts: any[] = [];
  
  // Add images (limit to 15 to avoid payload issues)
  let imageCount = 0;
  const imageNames = Object.keys(images);
  for (const name of imageNames) {
    if (imageCount >= 15) break;
    parts.push({
      inlineData: {
        mimeType: 'image/png', // Assuming PNG for now, but could be JPEG.
        data: images[name].toString('base64')
      }
    });
    parts.push({ text: `[Image: ${name}]` });
    imageCount++;
  }

  parts.push({ text: `Deck name: ${deckName}\n\nLecture content:\n\n${text}` });

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: {
        role: 'user',
        parts: parts
      },
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
              image: { type: Type.STRING, nullable: true }
            },
            required: ['front', 'back']
          }
        }
      }
    });

    const jsonText = response.text;
    if (!jsonText) {
        throw new Error("Empty response from AI");
    }
    return JSON.parse(jsonText);
  } catch (error) {
    console.error("AI Generation Error:", error);
    throw error;
  }
}

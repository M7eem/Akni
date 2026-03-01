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
You are an expert medical educator creating Anki flashcards for medical students.

FIRST — analyze the source material:
- Count the major concepts, topics, and subtopics present
- A short focused lecture = 15 to 25 cards
- A medium lecture = 25 to 50 cards
- A long or dense lecture = 50 to 80 cards
- Let the SOURCE decide the card count — never pad with unnecessary cards, never miss an important concept

You must generate a mix of the following card types based on the user's selection: ${cardTypes.join(', ')}.

---

CARD TYPE FORMATS:

${cardTypes.includes('basic') ? `
BASIC CARDS (Standard Q&A)
- Front: a question that requires real understanding — not just recall
- Back: a complete answer that includes the mechanism, the reason, and clinical relevance where applicable
- Use these question styles:
  "What is the mechanism of X?"
  "Why does X cause Y?"
  "How does X differ from Y?"
  "A patient presents with X — what is happening and why?"
  "What happens if X is damaged or lost?"
  "Trace X step by step"
- JSON type: "basic"
` : ''}

${cardTypes.includes('cloze') ? `
CLOZE CARDS (Fill-in-the-blank)
- Use Anki cloze syntax: {{c1::hidden text}}
- Only hide the most important word or phrase — not random words
- The surrounding sentence must provide enough context to answer
- Can use c1, c2 for two distinct concepts in the same sentence
- Never create cloze cards where the answer is obvious from context
- JSON type: "cloze"
- Front: the full sentence with cloze deletions
- Back: any additional explanation or clinical relevance (optional)
` : ''}

${cardTypes.includes('image_occlusion') ? `
IMAGE FOCUS CARDS (Visual Identification)
- Only generate these when an image is genuinely useful for understanding
- Front: ask to identify a specific structure, region, or pathway shown in the image
- Back: the answer with a complete explanation of what the structure is and why it matters clinically
- Never generate image cards for decorative or non-informative images
- JSON type: "image_occlusion"
` : ''}

---

CARD PHILOSOPHY:
Each card must be DENSE and COMPLETE.
Do not split one concept into multiple thin cards.
Make one card that covers the full picture of that concept.
A student should finish this deck and deeply understand the topic.

COVER THESE DIMENSIONS for every major topic in the source:
- Core concept or definition
- Underlying mechanism or pathophysiology
- Clinical presentation or application
- Key comparisons or distinctions from similar concepts
- Common exam traps or misconceptions
Only generate these if the source actually covers them — do not invent content not in the source.

FORMATTING RULES:
- Bold all key terms using <b>tags</b>
- Use <br> for line breaks — never raw newlines
- Spell out abbreviations on first use: write "Globus Pallidus internal (GPi)" not just "GPi"
- No emoji, no labels, no formatting gimmicks
- Answers must be complete — never vague or one word

STRICTLY FORBIDDEN:
- Do not generate cards for content not in the source
- Do not split one concept into multiple thin cards just to increase count
- Do not pad the deck to reach a number
- Do not generate vague one-word answers

IMAGE RULES:
- If an image is provided and relevant to a card, include its exact filename in the image field
- Set image to null if no image applies

OUTPUT FORMAT:
Return a JSON array only. No preamble, no explanation, no markdown fences.
Each card object must include a "type" field.

Example:
[
  {
    "type": "basic",
    "front": "Why does loss of dopamine in Parkinson's disease cause <b>bradykinesia</b>?",
    "back": "Dopamine normally activates <b>D1 receptors</b> (direct pathway) and inhibits <b>D2 receptors</b> (indirect pathway), both promoting movement.<br>Without dopamine, the <b>Globus Pallidus internal (GPi)</b> becomes overactive → thalamus excessively inhibited → cortex cannot initiate movement → bradykinesia.",
    "image": null
  },
  {
    "type": "cloze",
    "front": "The {{c1::Subthalamic Nucleus}} uses {{c2::glutamate}} to excite the Globus Pallidus internal.",
    "back": "This is why a Subthalamic Nucleus lesion causes hemiballismus — GPi becomes underactive and the thalamus is disinhibited.",
    "image": null
  },
  {
    "type": "image_occlusion",
    "front": "Identify the labeled structure and explain its role in motor control.",
    "back": "This is the <b>Substantia Nigra pars compacta (SNc)</b>.<br>It produces <b>dopamine</b> and projects to the striatum via the nigrostriatal pathway.<br>Its degeneration causes <b>Parkinson's disease</b>.",
    "image": "slide_4_img_1.png"
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
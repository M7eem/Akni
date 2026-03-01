import { GoogleGenAI, Type } from '@google/genai';
import sharp from 'sharp';

export interface OcclusionCard {
  front: string;        // HTML: <img src="front_filename.png">
  back: string;         // HTML: <img src="back_filename.png"> <br><br> <b>Label text</b>
  frontImageName: string;   // e.g. "occlusion_slide1_label0_front.png"
  frontImageBuffer: Buffer; // the image with ONE label covered
  backImageName: string;    // e.g. "occlusion_slide1_back.png"
  backImageBuffer: Buffer;  // the original image unchanged
}

interface Label {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function generateOcclusionCards(
  images: Record<string, Buffer>,
  apiKey: string
): Promise<OcclusionCard[]> {
  const ai = new GoogleGenAI({ apiKey });
  const model = 'gemini-3.1-pro-preview'; // Or gemini-2.0-flash-exp if preferred for vision
  const occlusionCards: OcclusionCard[] = [];

  console.log(`Starting occlusion generation for ${Object.keys(images).length} images...`);

  for (const [filename, buffer] of Object.entries(images)) {
    try {
      // Step 1: Detect labels using Gemini Vision
      const labels = await detectLabels(ai, model, buffer);
      
      if (labels.length === 0) {
        console.log(`No labels detected in ${filename}, skipping.`);
        continue;
      }

      console.log(`Detected ${labels.length} labels in ${filename}`);

      // Step 2: Process image with sharp
      const metadata = await sharp(buffer).metadata();
      const width = metadata.width!;
      const height = metadata.height!;

      // Create the "back" image (original)
      // We rename it to avoid conflicts with other files
      const backImageName = `occl_${filename.replace(/\.[^/.]+$/, '')}_back.png`;
      
      // We need to convert the original buffer to PNG to ensure consistency
      const backImageBuffer = await sharp(buffer).png().toBuffer();

      // Step 3: Generate a card for each label
      for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        
        // Draw box over the label
        const frontImageBuffer = await coverLabel(buffer, label, width, height);
        const frontImageName = `occl_${filename.replace(/\.[^/.]+$/, '')}_label_${i}_front.png`;

        occlusionCards.push({
          front: `<img src="${frontImageName}">`,
          back: `<img src="${backImageName}"><br><br><b>${label.label}</b>`,
          frontImageName,
          frontImageBuffer,
          backImageName,
          backImageBuffer
        });
      }

    } catch (error) {
      console.error(`Error processing occlusion for ${filename}:`, error);
      // Continue to next image, don't crash
    }
  }

  return occlusionCards;
}

async function detectLabels(ai: GoogleGenAI, model: string, imageBuffer: Buffer): Promise<Label[]> {
  const prompt = `
You are analyzing an anatomy or medical diagram.
Find every text label in this image.
Return ONLY a JSON array. No explanation, no markdown fences.
Each object in the array:
{
  "label": "exact text of the label",
  "x": 0.25,   // left edge of label as fraction of image width (0.0 to 1.0)
  "y": 0.40,   // top edge of label as fraction of image height (0.0 to 1.0)
  "w": 0.20,   // width of label as fraction of image width
  "h": 0.04    // height of label as fraction of image height
}
If this image has no text labels (e.g. it is a photo, chart, or non-anatomy image), return an empty array [].
`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: 'image/png',
              data: imageBuffer.toString('base64')
            }
          }
        ]
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              w: { type: Type.NUMBER },
              h: { type: Type.NUMBER }
            },
            required: ['label', 'x', 'y', 'w', 'h']
          }
        }
      }
    });

    const jsonText = response.text;
    if (!jsonText) return [];
    
    return JSON.parse(jsonText) as Label[];
  } catch (error) {
    console.warn("Gemini Vision label detection failed:", error);
    return [];
  }
}

async function coverLabel(
  imageBuffer: Buffer,
  label: { x: number; y: number; w: number; h: number },
  imageWidth: number,
  imageHeight: number
): Promise<Buffer> {
  const px = Math.floor(label.x * imageWidth);
  const py = Math.floor(label.y * imageHeight);
  const pw = Math.floor(label.w * imageWidth);
  const ph = Math.floor(label.h * imageHeight);

  // Create a red rectangle as SVG overlay
  const overlay = Buffer.from(
    `<svg width="${imageWidth}" height="${imageHeight}">
      <rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#e74c3c"/>
    </svg>`
  );

  return sharp(imageBuffer)
    .composite([{ input: overlay, blend: 'over' }])
    .png()
    .toBuffer();
}

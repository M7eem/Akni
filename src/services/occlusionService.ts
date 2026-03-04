import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';

export interface DetectedLabel {
  id?: string;
  label: string;
  x: number; // fraction 0-1
  y: number;
  w: number;
  h: number;
}

export interface OcclusionCard {
  front: string;
  back: string;
  frontImageName: string;
  frontImageBuffer: Buffer;
  backImageName: string;
  backImageBuffer: Buffer;
}

/** Detect mime type from buffer magic bytes */
function detectMimeType(buffer: Buffer): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'image/webp';
  return 'image/jpeg'; // PDF images are almost always JPEG
}

export async function detectLabelsForImage(
  imageBase64: string,
  apiKey: string
): Promise<DetectedLabel[]> {
  const ai = new GoogleGenAI({ apiKey });

  // Decode base64 to detect actual mime type from magic bytes
  const buf = Buffer.from(imageBase64, 'base64');
  const mimeType = detectMimeType(buf);

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: {
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType,
            data: imageBase64
          }
        },
        {
          text: `You are analyzing a medical or anatomy diagram to find text labels for image occlusion flashcards.

WHAT TO INCLUDE:
- Every visible text label that names an anatomical structure
- Labels connected to a structure by a line, arrow, or pointer
- Both short labels (e.g. "Vermis") and multi-line labels (e.g. "Spinocerebellum")

WHAT TO EXCLUDE:
- Slide numbers, page numbers, single digits or letters
- Copyright text, watermarks, scale bars, logos
- Titles, headings, or captions that describe the whole image
- Any text that is decorative or not labeling a specific structure

BOUNDING BOX RULES — this is critical:
- x, y, w, h must be as TIGHT as possible around the text characters only
- x = left edge of the FIRST character, NOT the start of a pointing line
- y = top edge of the FIRST character, NOT above it
- w = width from first to last character of the longest line only
- h = total height of all lines of text for multi-line labels
- Do NOT include whitespace, arrows, lines, or surrounding space in the box
- For multi-line labels, cover all lines in a single box
- Coordinates are fractions of the full image dimensions (0.0 to 1.0)
- Be precise to 3 decimal places

Return ONLY a valid JSON array. No markdown fences, no explanation, no preamble.

Format:
[
  { "label": "Spinocerebellum", "x": 0.423, "y": 0.041, "w": 0.198, "h": 0.048 },
  { "label": "Vermis", "x": 0.751, "y": 0.098, "w": 0.072, "h": 0.042 }
]

If no anatomical labels are present, return [].`
        }
      ]
    }
  });

  const raw = response.text?.replace(/```json|```/g, '').trim() || '[]';
  const labels: DetectedLabel[] = JSON.parse(raw);

  return labels.map((l, i) => ({ ...l, id: Date.now().toString() + i }));
}

export async function generateOcclusionCardsFromLabels(
  imageName: string,
  imageBuffer: Buffer,
  labels: DetectedLabel[]
): Promise<OcclusionCard[]> {
  const allCards: OcclusionCard[] = [];
  if (!labels || labels.length === 0) return allCards;

  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width!;
  const height = metadata.height!;

  const baseName = imageName.replace(/\.[^.]+$/, ''); // strip any extension
  const backImageName = `occl_${baseName}_back.png`;

  for (let i = 0; i < labels.length; i++) {
    const labelData = labels[i];

    try {
      const pad = 0.008; // 0.8% of image dimensions as padding
      const px = Math.max(0, Math.floor((labelData.x - pad) * width));
      const py = Math.max(0, Math.floor((labelData.y - pad) * height));
      const pw = Math.min(width - px, Math.floor((labelData.w + pad * 2) * width));
      const ph = Math.min(height - py, Math.floor((labelData.h + pad * 2) * height));

      const overlay = Buffer.from(
        `<svg width="${width}" height="${height}">
          <rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#e74c3c" rx="4"/>
        </svg>`
      );

      const frontBuffer = await sharp(imageBuffer)
        .composite([{ input: overlay, blend: 'over' }])
        .png()
        .toBuffer();

      const frontImageName = `occl_${baseName}_label_${i}_front.png`;

      allCards.push({
        front: `<img src="${frontImageName}"><br><br>What structure is hidden by the <b>red box</b>?`,
        back: `<img src="${backImageName}"><br><br><b>${labelData.label}</b>`,
        frontImageName,
        frontImageBuffer: frontBuffer,
        backImageName,
        backImageBuffer: imageBuffer
      });

    } catch (labelErr) {
      console.warn(`Failed to process label ${i} for ${imageName}:`, labelErr);
      continue;
    }
  }

  return allCards;
}

export async function generateOcclusionCards(
  images: Record<string, Buffer>,
  apiKey: string
): Promise<OcclusionCard[]> {
  const ai = new GoogleGenAI({ apiKey });
  const allCards: OcclusionCard[] = [];

  for (const [imageName, imageBuffer] of Object.entries(images)) {
    try {
      const mimeType = detectMimeType(imageBuffer);

      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: imageBuffer.toString('base64')
              }
            },
            {
              text: `You are analyzing a medical or anatomy diagram to find text labels for image occlusion flashcards.

WHAT TO INCLUDE:
- Every visible text label that names an anatomical structure
- Labels connected to a structure by a line, arrow, or pointer
- Both short labels (e.g. "Vermis") and multi-line labels (e.g. "Spinocerebellum")

WHAT TO EXCLUDE:
- Slide numbers, page numbers, single digits or letters
- Copyright text, watermarks, scale bars, logos
- Titles, headings, or captions that describe the whole image
- Any text that is decorative or not labeling a specific structure

BOUNDING BOX RULES — this is critical:
- x, y, w, h must be as TIGHT as possible around the text characters only
- x = left edge of the FIRST character, NOT the start of a pointing line
- y = top edge of the FIRST character, NOT above it
- w = width from first to last character of the longest line only
- h = total height of all lines of text for multi-line labels
- Do NOT include whitespace, arrows, lines, or surrounding space in the box
- For multi-line labels, cover all lines in a single box
- Coordinates are fractions of the full image dimensions (0.0 to 1.0)
- Be precise to 3 decimal places

Return ONLY a valid JSON array. No markdown fences, no explanation, no preamble.

Format:
[
  { "label": "Spinocerebellum", "x": 0.423, "y": 0.041, "w": 0.198, "h": 0.048 },
  { "label": "Vermis", "x": 0.751, "y": 0.098, "w": 0.072, "h": 0.042 }
]

If no anatomical labels are present, return [].`
            }
          ]
        }
      });

      const raw = response.text?.replace(/```json|```/g, '').trim() || '[]';
      const labels: DetectedLabel[] = JSON.parse(raw);

      if (labels.length === 0) continue;

      const metadata = await sharp(imageBuffer).metadata();
      const width = metadata.width!;
      const height = metadata.height!;

      const baseName = imageName.replace(/\.[^.]+$/, '');
      const backImageName = `occl_${baseName}_back.png`;

      for (let i = 0; i < labels.length; i++) {
        const labelData = labels[i];

        try {
          const pad = 0.008; // 0.8% of image dimensions as padding
          const px = Math.max(0, Math.floor((labelData.x - pad) * width));
          const py = Math.max(0, Math.floor((labelData.y - pad) * height));
          const pw = Math.min(width - px, Math.floor((labelData.w + pad * 2) * width));
          const ph = Math.min(height - py, Math.floor((labelData.h + pad * 2) * height));

          const overlay = Buffer.from(
            `<svg width="${width}" height="${height}">
              <rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#e74c3c" rx="3"/>
            </svg>`
          );

          const frontBuffer = await sharp(imageBuffer)
            .composite([{ input: overlay, blend: 'over' }])
            .png()
            .toBuffer();

          const frontImageName = `occl_${baseName}_label_${i}_front.png`;

          allCards.push({
            front: `<img src="${frontImageName}"><br><br>What structure is hidden by the <b>red box</b>?`,
            back: `<img src="${backImageName}"><br><br><b>${labelData.label}</b>`,
            frontImageName,
            frontImageBuffer: frontBuffer,
            backImageName,
            backImageBuffer: imageBuffer
          });

        } catch (labelErr) {
          console.warn(`Failed to process label ${i} for ${imageName}:`, labelErr);
          continue;
        }
      }

    } catch (imageErr) {
      console.warn(`Failed to process image ${imageName} for occlusion:`, imageErr);
      continue;
    }
  }

  console.log(`Generated ${allCards.length} occlusion cards from ${Object.keys(images).length} images`);
  return allCards;
}
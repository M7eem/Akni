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
          text: `You are analyzing a medical or anatomy diagram image.
Detect every text label visible in this image.
Return ONLY a valid JSON array. No explanation, no markdown, no preamble.

Each object in the array:
{
  "label": "exact text as written in the image",
  "x": 0.12,
  "y": 0.35,
  "w": 0.18,
  "h": 0.045
}

x = left edge of label text as fraction of total image width (0.0 to 1.0)
y = top edge of label text as fraction of total image height (0.0 to 1.0)  
w = width of label text area as fraction of image width
h = height of label text area as fraction of image height

Be precise. Include EVERY label you can see.
If there are no text labels in this image, return an empty array [].`
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
      const px = Math.max(0, Math.floor(labelData.x * width));
      const py = Math.max(0, Math.floor(labelData.y * height));
      const pw = Math.min(width - px, Math.floor(labelData.w * width));
      const ph = Math.min(height - py, Math.floor(labelData.h * height));

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
              text: `You are analyzing a medical or anatomy diagram.
Find every text label visible in this image.
Return ONLY a JSON array. No explanation, no markdown fences, no preamble.
Each object:
{
  "label": "exact text of the label as written in the image",
  "x": 0.25,
  "y": 0.40,
  "w": 0.20,
  "h": 0.04
}
x, y = top-left corner of the label as a fraction of image width/height (0.0 to 1.0)
w, h = width and height of the label as a fraction of image width/height
If this image has no text labels (photo, chart, decorative image), return [].`
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
          const px = Math.max(0, Math.floor(labelData.x * width));
          const py = Math.max(0, Math.floor(labelData.y * height));
          const pw = Math.min(width - px, Math.floor(labelData.w * width));
          const ph = Math.min(height - py, Math.floor(labelData.h * height));

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
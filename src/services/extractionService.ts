import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import path from 'path';

interface ExtractionResult {
  text: string;
  images: Record<string, Buffer>;
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'];

export async function extractContent(files: Express.Multer.File[]): Promise<ExtractionResult> {
  let allText = '';
  const allImages: Record<string, Buffer> = {};

  for (const file of files) {
    const buffer = fs.readFileSync(file.path);
    const ext = file.originalname.split('.').pop()?.toLowerCase();

    if (ext === 'pptx') {
      const { text, images } = await extractPptx(buffer, file.originalname);
      allText += `\n\n=== FILE: ${file.originalname} ===\n\n${text}`;
      Object.assign(allImages, images);
    } else if (ext === 'pdf') {
      const { text, images } = await extractPdf(buffer, file.originalname);
      allText += `\n\n=== FILE: ${file.originalname} ===\n\n${text}`;
      Object.assign(allImages, images);
    }
  }

  console.log(`Extraction complete: ${Object.keys(allImages).length} images found`);
  return { text: allText, images: allImages };
}

async function extractPptx(buffer: Buffer, filename: string): Promise<{ text: string; images: Record<string, Buffer> }> {
  const zip = await JSZip.loadAsync(buffer);
  const parser = new XMLParser({ ignoreAttributes: false });
  const slidesText: string[] = [];
  const images: Record<string, Buffer> = {};
  const baseFilename = filename.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');

  // --- Extract ALL images from ppt/media/ ---
  // FIX: iterate zip.files directly and filter by path prefix
  for (const [filePath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;

    const isInMedia = filePath.startsWith('ppt/media/');
    if (!isInMedia) continue;

    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    if (!IMAGE_EXTENSIONS.includes(ext)) continue;

    const imageName = path.basename(filePath); // e.g. image1.png
    const uniqueName = `${baseFilename}_${imageName}`;

    try {
      const content = await zipEntry.async('nodebuffer');
      if (content && content.length > 0) {
        images[uniqueName] = content;
        console.log(`Extracted image: ${uniqueName} (${content.length} bytes)`);
      }
    } catch (err) {
      console.warn(`Failed to extract image ${filePath}:`, err);
    }
  }

  // --- Extract text from slides ---
  const slideFiles = Object.keys(zip.files).filter(f =>
    f.match(/^ppt\/slides\/slide\d+\.xml$/)
  );

  slideFiles.sort((a, b) => {
    const numA = parseInt(a.match(/slide(\d+)\.xml/)?.[1] || '0');
    const numB = parseInt(b.match(/slide(\d+)\.xml/)?.[1] || '0');
    return numA - numB;
  });

  for (const slideFile of slideFiles) {
    const slideXml = await zip.file(slideFile)?.async('string');
    if (!slideXml) continue;

    const slideNum = slideFile.match(/slide(\d+)\.xml/)?.[1];
    let slideContent = `[SLIDE ${slideNum}]\n`;

    // Extract text using regex — more reliable than XML parsing for nested runs
    const textMatches = slideXml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [];
    const slideText = textMatches
      .map(m => m.replace(/<[^>]+>/g, '').trim())
      .filter(t => t.length > 0)
      .join('\n');
    slideContent += slideText;

    // Parse rels to find which images are on this slide
    const relsFile = `ppt/slides/_rels/${slideFile.split('/').pop()}.rels`;
    const relsXml = await zip.file(relsFile)?.async('string');
    if (relsXml) {
      const relsObj = parser.parse(relsXml);
      const rels = relsObj?.Relationships?.Relationship;
      if (rels) {
        const relArray = Array.isArray(rels) ? rels : [rels];
        for (const rel of relArray) {
          const type = rel['@_Type'] || '';
          const target = rel['@_Target'] || '';
          if (type.includes('image')) {
            const imageName = path.basename(target);
            const uniqueName = `${baseFilename}_${imageName}`;
            if (images[uniqueName]) {
              slideContent += `\n[IMAGE: ${uniqueName}]`;
            }
          }
        }
      }
    }

    slidesText.push(slideContent);
  }

  console.log(`PPTX extraction: ${slideFiles.length} slides, ${Object.keys(images).length} images`);
  return { text: slidesText.join('\n\n---\n\n'), images };
}

async function extractPdf(buffer: Buffer, filename: string): Promise<{ text: string; images: Record<string, Buffer> }> {
  const baseFilename = filename.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');
  const images: Record<string, Buffer> = {};

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);

    // Extract text
    const content = await page.getTextContent();
    const pageText = content.items.map((item: any) => item.str).join(' ');
    fullText += `\n[PAGE ${i}]\n${pageText}`;

    // Extract images from PDF page using operatorList
    try {
      const ops = await page.getOperatorList();
      const imgNames = new Set<string>();

      for (let j = 0; j < ops.fnArray.length; j++) {
        // OPS.paintImageXObject = 85
        if (ops.fnArray[j] === 85) {
          const imgName = ops.argsArray[j][0];
          imgNames.add(imgName);
        }
      }

      for (const imgName of imgNames) {
        try {
          const img = await (page as any).objs.get(imgName);
          if (img && img.data && img.width && img.height) {
            // Convert raw RGBA to PNG using a simple approach
            const rgba = img.data;
            const w = img.width;
            const h = img.height;

            // Create a minimal PNG buffer from raw RGBA
            // We'll store as raw data and let sharp handle it on the backend
            const uniqueName = `${baseFilename}_page${i}_${imgName}.png`;
            images[uniqueName] = Buffer.from(rgba);
            fullText += `\n[IMAGE: ${uniqueName}]`;
          }
        } catch {}
      }
    } catch {}
  }

  console.log(`PDF extraction: ${pdf.numPages} pages, ${Object.keys(images).length} images`);
  return { text: fullText, images };
}
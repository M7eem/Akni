import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
// @ts-ignore
import pdfParse from 'pdf-parse';
import fs from 'fs';

interface ExtractionResult {
  text: string;
  images: Record<string, Buffer>;
}

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
      const { text } = await extractPdf(buffer);
      allText += `\n\n=== FILE: ${file.originalname} ===\n\n${text}`;
      // PDF image extraction is complex in pure Node.js without native dependencies.
      // We will focus on text for PDF for now.
    }
  }

  return { text: allText, images: allImages };
}

async function extractPptx(buffer: Buffer, filename: string): Promise<{ text: string; images: Record<string, Buffer> }> {
  const zip = await JSZip.loadAsync(buffer);
  const parser = new XMLParser({ ignoreAttributes: false });
  const slidesText: string[] = [];
  const images: Record<string, Buffer> = {};
  
  // 1. Extract Images
  const mediaFolder = zip.folder('ppt/media');
  if (mediaFolder) {
    const files = Object.keys(mediaFolder.files);
    for (const file of files) {
      const content = await mediaFolder.file(file)?.async('nodebuffer');
      if (content) {
        // Use a unique name: filename_imageName
        const uniqueName = `${filename.replace(/\s+/g, '_')}_${file}`;
        images[uniqueName] = content;
      }
    }
  }

  // 2. Extract Text from Slides
  // Find all slide XML files
  const slideFiles = Object.keys(zip.files).filter(f => f.match(/ppt\/slides\/slide\d+\.xml$/));
  
  // Sort slides by number (slide1, slide2, ...)
  slideFiles.sort((a, b) => {
    const numA = parseInt(a.match(/slide(\d+)\.xml/)?.[1] || '0');
    const numB = parseInt(b.match(/slide(\d+)\.xml/)?.[1] || '0');
    return numA - numB;
  });

  for (const slideFile of slideFiles) {
    const slideXml = await zip.file(slideFile)?.async('string');
    if (!slideXml) continue;

    const slideObj = parser.parse(slideXml);
    const slideNum = slideFile.match(/slide(\d+)\.xml/)?.[1];
    let slideContent = `[SLIDE ${slideNum}]\n`;

    // Helper to recursively find text in <a:t> tags
    const findText = (obj: any) => {
      if (typeof obj === 'object' && obj !== null) {
        if (obj['a:t']) {
          slideContent += (typeof obj['a:t'] === 'string' ? obj['a:t'] : obj['a:t']['#text']) + '\n';
        }
        for (const key in obj) {
          findText(obj[key]);
        }
      } else if (Array.isArray(obj)) {
        obj.forEach(findText);
      }
    };

    findText(slideObj);
    
    // Attempt to link images (simplified)
    // In a real implementation, we would parse _rels to find which image maps to which slide.
    // For now, we'll just list available images at the end or let the AI decide based on context if we had image descriptions.
    // Since we are sending all images to the AI, it might be able to pick relevant ones if we give it the filenames.
    // But without rels, we don't know which image is on which slide.
    // Let's try to parse rels.
    
    const relsFile = `ppt/slides/_rels/${slideFile.split('/').pop()}.rels`;
    const relsXml = await zip.file(relsFile)?.async('string');
    if (relsXml) {
        const relsObj = parser.parse(relsXml);
        const rels = relsObj.Relationships?.Relationship;
        if (rels) {
            const relArray = Array.isArray(rels) ? rels : [rels];
            for (const rel of relArray) {
                if (rel['@_Type'] && rel['@_Type'].includes('image')) {
                    const target = rel['@_Target']; // e.g., "../media/image1.png"
                    const imageName = target.split('/').pop();
                    const uniqueName = `${filename.replace(/\s+/g, '_')}_${imageName}`;
                    if (images[uniqueName]) {
                        slideContent += `[IMAGE: ${uniqueName}]\n`;
                    }
                }
            }
        }
    }

    slidesText.push(slideContent);
  }

  return { text: slidesText.join('\n\n---\n\n'), images };
}

async function extractPdf(buffer: Buffer): Promise<{ text: string }> {
  const data = await pdfParse(buffer);
  // pdf-parse gives full text. It doesn't easily give per-page text with page numbers unless we use the paginator.
  // data.text is all text. data.numpages is count.
  // We can try to split by form feed if present, but pdf-parse output is just a string.
  // For better structure, we might need a more advanced parser, but this is a good start.
  return { text: data.text };
}

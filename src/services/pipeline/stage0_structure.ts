export interface DocumentStructure {
  sections: {
    title: string;
    text: string;
  }[];
}

export function detectTOC(text: string): boolean {
  // A real TOC has:
  // - Lines with page numbers at the end (Chapter 1 ........... 12)
  // - Multiple consecutive lines following this pattern
  // - Usually in the first 10% of the document
  const firstTenth = text.substring(0, Math.max(1000, text.length * 0.1));
  const tocPattern = /^.{5,60}[\.\s]{3,}\d{1,4}$/m;
  const matches = firstTenth.match(new RegExp(tocPattern.source, 'gm')) || [];
  return matches.length >= 5; // at least 5 TOC entries
}

export function detectChapterHeadings(text: string): boolean {
  // Chapter headings are:
  // - Lines that are short (under 80 chars)
  // - Followed by a blank line
  // - Possibly preceded by "Chapter", "Section", or a number
  // - Appear multiple times throughout the document
  const headingPattern = /^(Chapter|Section|CHAPTER|SECTION|\d+\.)\s+.{3,60}$/m;
  const matches = text.match(new RegExp(headingPattern.source, 'gm')) || [];
  return matches.length >= 3;
}

export function extractFromTOC(text: string): DocumentStructure {
  const firstTenth = text.substring(0, Math.max(1000, text.length * 0.1));
  const tocPattern = /^(.{5,60}?)[\.\s]{3,}\d{1,4}$/gm; // capture the actual title

  const titles: string[] = [];
  let match;
  while ((match = tocPattern.exec(firstTenth)) !== null) {
    const title = match[1].trim();
    // Only capture titles that look like actual titles (not just punctuation)
    if (title.length > 3 && /[a-zA-Z]/.test(title)) {
      titles.push(title);
    }
  }

  // Use TOC titles as regex anchors to split the document
  const sections: { title: string; text: string }[] = [];
  
  // If we couldn't parse titles reliably, fallback
  if (titles.length < 2) {
      return extractFromSemanticBreaks(text);
  }

  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    const nextTitle = i + 1 < titles.length ? titles[i + 1] : null;

    // Create a safe regex for the title
    const safeTitlePattern = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Find where THIS section title actually appears in the body (after the TOC)
    // We skip the length of the TOC area to avoid matching the TOC itself
    const bodyStartIndex = firstTenth.length;
    let textToSearch = text.substring(bodyStartIndex);
    
    const startRegex = new RegExp(`^\\s*${safeTitlePattern}\\s*$`, 'm');
    const startMatch = startRegex.exec(textToSearch);
    
    if (startMatch) {
      const actualStartIndex = bodyStartIndex + startMatch.index + startMatch[0].length;
      let textContent = text.substring(actualStartIndex);
      
      // If there's a next title, try to find where it begins
      if (nextTitle) {
          const safeNextTitle = nextTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const endRegex = new RegExp(`^\\s*${safeNextTitle}\\s*$`, 'm');
          const endMatch = endRegex.exec(textContent);
          
          if (endMatch) {
             textContent = textContent.substring(0, endMatch.index).trim();
          } else {
             // If we can't find the next title, maybe it got mangled. Just take the rest of the text,
             // or try to find a fallback limit (like double double newlines or end of file)
             // For now we just take the entire rest of the text and let subsequent loops overlap.
             // (Ideally we would have a better boundary heuristic here).
          }
      }
      
      sections.push({ title: title, text: textContent.trim() });
    }
  }

  // If extraction failed completely, fallback
  if (sections.length === 0) {
      return extractFromSemanticBreaks(text);
  }

  // Only keep sections with actual content
  return { sections: sections.filter(s => s.text.length > 200) };
}

export function extractFromHeadings(text: string): DocumentStructure {
  const headingPattern = /^(Chapter|Section|CHAPTER|SECTION|\d+\.)\s+(.{3,60})$/gm;
  
  const sections: { title: string; text: string }[] = [];
  let match;
  let lastIndex = 0;
  let currentTitle = "Introduction";

  while ((match = headingPattern.exec(text)) !== null) {
      // The text from lastIndex up to this match belongs to the previous heading
      const sectionText = text.substring(lastIndex, match.index).trim();
      
      if (sectionText.length > 200) {
          sections.push({ title: currentTitle, text: sectionText });
      }
      
      currentTitle = match[0].trim();
      lastIndex = match.index + match[0].length;
  }
  
  // Don't forget the final section
  const finalSectionText = text.substring(lastIndex).trim();
  if (finalSectionText.length > 200) {
      sections.push({ title: currentTitle, text: finalSectionText });
  }

  if (sections.length === 0) {
      return extractFromSemanticBreaks(text);
  }

  return { sections };
}

export function extractFromSemanticBreaks(text: string): DocumentStructure {
  // Last resort - split by large empty gaps or just arbitrarily into 8000 char chunks 
  // keeping paragraph integrity.
  const MAX_CHUNK = 8000;
  
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const sections: { title: string; text: string }[] = [];
  
  let currentChunk = "";
  let chunkIndex = 1;
  
  for (const p of paragraphs) {
      if ((currentChunk.length + p.length) > MAX_CHUNK && currentChunk.length > 0) {
          sections.push({ title: `Part ${chunkIndex}`, text: currentChunk.trim() });
          chunkIndex++;
          currentChunk = p;
      } else {
          currentChunk += (currentChunk ? "\n\n" : "") + p;
      }
  }
  
  if (currentChunk.length > 0) {
      sections.push({ title: `Part ${chunkIndex}`, text: currentChunk.trim() });
  }

  return { sections };
}

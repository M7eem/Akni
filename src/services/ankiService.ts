import JSZip from 'jszip';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

interface Card {
  front: string;
  back: string;
  image?: string;
}

import { OcclusionCard } from './occlusionService';

export async function createAnkiPackage(
  cards: Card[],
  outputPath: string,
  deckName: string,
  images: Record<string, Buffer>,
  cardTypes: string[] = ['basic'],
  occlusionCards: OcclusionCard[] = []
) {
  const tmpDir = os.tmpdir();
  const ts = Date.now();
  const dbPath = path.join(tmpDir, `anki_${ts}.anki2`);
  const dataPath = path.join(tmpDir, `anki_data_${ts}.json`);
  const scriptPath = path.join(tmpDir, `anki_script_${ts}.py`);

  // Add occlusion images to the images record
  for (const oc of occlusionCards) {
    images[oc.frontImageName] = oc.frontImageBuffer;
    images[oc.backImageName] = oc.backImageBuffer;
  }

  // Convert occlusion cards to regular Card format and append
  const occlusionAsCards: Card[] = occlusionCards.map(oc => ({
    front: oc.front,
    back: oc.back,
    type: 'basic'
  } as any));

  const allCards = [...cards, ...occlusionAsCards];

  // Write cards to temp JSON file
  const cardsData = allCards.map(card => ({
    type: (card as any).type || 'basic',
    front: card.front,
    back: card.back,
    image: (card.image && images && images[card.image]) ? card.image : null
  }));

  fs.writeFileSync(dataPath, JSON.stringify({
    cards: cardsData,
    deckName,
    dbPath,
    cardTypes
  }));

  // Python script that builds the SQLite database
  const pythonScript = `
import sqlite3, json, time, os, random

with open("""${dataPath}""") as f:
    data = json.load(f)

cards = data['cards']
deck_name = data['deckName']
db_path = data['dbPath']

if os.path.exists(db_path):
    os.remove(db_path)

conn = sqlite3.connect(db_path)
c = conn.cursor()

c.executescript("""
CREATE TABLE col (
    id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL,
    scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL,
    usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL,
    models text NOT NULL, decks text NOT NULL, dconf text NOT NULL,
    tags text NOT NULL
);
CREATE TABLE notes (
    id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL,
    mod integer NOT NULL, usn integer NOT NULL, tags text NOT NULL,
    flds text NOT NULL, sfld text NOT NULL, csum integer NOT NULL,
    flags integer NOT NULL, data text NOT NULL
);
CREATE TABLE cards (
    id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL,
    ord integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL,
    type integer NOT NULL, queue integer NOT NULL, due integer NOT NULL,
    ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL,
    lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL,
    odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL
);
CREATE TABLE revlog (
    id integer PRIMARY KEY, cid integer NOT NULL, usn integer NOT NULL,
    ease integer NOT NULL, ivl integer NOT NULL, lastIvl integer NOT NULL,
    factor integer NOT NULL, time integer NOT NULL, type integer NOT NULL
);
CREATE TABLE graves (usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL);
""")

now = int(time.time())
deck_id = random.randint(1000000000, 9999999999)
model_id_basic = random.randint(1000000000, 9999999999)
model_id_cloze = random.randint(1000000000, 9999999999)

css = """.card{font-family:Arial,sans-serif;font-size:20px;text-align:center;color:#e8e8e8;background-color:#2b2b2b;padding:0 60px 20px 60px;line-height:1.8}b{color:#7dd8f8;font-weight:bold}hr#answer{border:none;border-top:1px solid #555;margin:16px 0}.cloze{font-weight:bold;color:#7dd8f8}"""

basic_model = {
    "id": model_id_basic, "name": "Basic", "type": 0, "mod": now, "usn": -1,
    "sortf": 0, "did": deck_id,
    "tmpls": [{"name": "Card 1", "ord": 0,
               "qfmt": "{{Front}}",
               "afmt": "{{Front}}<hr id=answer>{{Back}}",
               "bqfmt": "", "bafmt": "", "did": None, "bfont": "", "bsize": 0}],
    "flds": [
        {"name": "Front", "ord": 0, "sticky": False, "rtl": False, "font": "Arial", "size": 20},
        {"name": "Back",  "ord": 1, "sticky": False, "rtl": False, "font": "Arial", "size": 20}
    ],
    "css": css, "latexPre": "", "latexPost": "", "tags": [], "vers": []
}

cloze_model = {
    "id": model_id_cloze, "name": "Cloze", "type": 1, "mod": now, "usn": -1,
    "sortf": 0, "did": deck_id,
    "tmpls": [{"name": "Cloze", "ord": 0,
               "qfmt": "{{cloze:Text}}",
               "afmt": "{{cloze:Text}}<br><br>{{Back Extra}}",
               "bqfmt": "", "bafmt": "", "did": None, "bfont": "", "bsize": 0}],
    "flds": [
        {"name": "Text", "ord": 0, "sticky": False, "rtl": False, "font": "Arial", "size": 20},
        {"name": "Back Extra", "ord": 1, "sticky": False, "rtl": False, "font": "Arial", "size": 20}
    ],
    "css": css, "latexPre": "", "latexPost": "", "tags": [], "vers": []
}

models_dict = {
    str(model_id_basic): basic_model,
    str(model_id_cloze): cloze_model
}

models = json.dumps(models_dict)
target_model_id = model_id_basic

decks = json.dumps({
    "1": {"id": 1, "name": "Default", "conf": 1, "desc": "", "dyn": 0,
          "collapsed": False, "mod": now, "usn": -1,
          "lrnToday": [0,0], "revToday": [0,0], "newToday": [0,0], "timeToday": [0,0]},
    str(deck_id): {
        "id": deck_id, "name": deck_name, "desc": "", "mod": now, "usn": -1,
        "lrnToday": [0,0], "revToday": [0,0], "newToday": [0,0], "timeToday": [0,0],
        "collapsed": False, "browserCollapsed": False,
        "extendNew": 10, "extendRev": 50, "conf": 1, "dyn": 0
    }
})

dconf = json.dumps({"1": {
    "id": 1, "name": "Default", "replayq": True,
    "lapse": {"delays": [10], "mult": 0, "minInt": 1, "leechFails": 8, "leechAction": 0},
    "rev": {"perDay": 200, "ease4": 1.3, "fuzz": 0.05, "minSpace": 1,
            "ivlFct": 1, "maxIvl": 36500, "bury": True, "hardFactor": 1.2},
    "new": {"perDay": 20, "delays": [1, 10], "separate": True, "ints": [1, 4, 7],
            "initialFactor": 2500, "bury": True, "order": 1},
    "maxTaken": 60, "timer": 0, "autoplay": True, "mod": 0, "usn": 0, "dyn": False
}})

conf = json.dumps({
    "nextPos": 1, "estTimes": True, "activeDecks": [deck_id],
    "sortType": "noteFld", "timeLim": 0, "sortBackwards": False,
    "addToCur": True, "curDeck": deck_id, "newBury": True,
    "newSpread": 0, "dueCounts": True, "curModel": str(target_model_id), "collapseTime": 1200
})

c.execute("INSERT INTO col VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    (1, now, now, now*1000, 11, 0, -1, 0, conf, models, decks, dconf, "{}"))

for i, card in enumerate(cards):
    note_id = (now + i) * 1000
    guid = str(random.randint(10**9, 10**10))
    ctype = card.get('type', 'basic')

    if ctype == 'cloze':
        mid = model_id_cloze
    else:
        mid = model_id_basic

    front = card['front']
    back = card['back']
    if card.get('image'):
        front += '<br><br><img src="' + card['image'] + '">'

    flds = front + "\\x1f" + back
    sfld = card['front']
    csum = int.from_bytes(sfld[:9].encode('utf-8')[:4].ljust(4, b'\\x00'), 'big')

    c.execute("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (note_id, guid, mid, now, -1, "", flds, sfld, csum, 0, ""))

    num_cards = 1
    if ctype == 'cloze':
        import re
        matches = re.findall(r'{{c(\d+)::', front)
        if matches:
            indices = [int(m) for m in matches]
            num_cards = max(indices) if indices else 1

    for ord_idx in range(num_cards):
        c.execute("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (note_id+1+ord_idx, note_id, deck_id, ord_idx, now, -1, 0, 0, i, 0, 0, 0, 0, 0, 0, 0, 0, ""))

conn.commit()
conn.close()
print(f"DB created: {len(cards)} cards")
`;

  fs.writeFileSync(scriptPath, pythonScript);

  try {
    const result = execSync(`python3 ${scriptPath}`, { timeout: 60000 });
    console.log('Python output:', result.toString());
  } catch (err: any) {
    console.error('Python script failed:', err.stdout?.toString(), err.stderr?.toString());
    throw new Error(`Failed to build SQLite database: ${err.stderr?.toString() || err.message}`);
  }

  if (!fs.existsSync(dbPath)) {
    throw new Error('Python script ran but database file was not created');
  }

  const dbBuffer = fs.readFileSync(dbPath);
  console.log(`Database size: ${dbBuffer.length} bytes`);

  // ── Collect only images actually referenced in card content ──────
  const referencedImages = new Set<string>();
  const imgPattern = /src="([^"]+\.(png|jpg|jpeg|gif|webp))"/gi;

  for (const card of allCards) {
    const fields = [card.front, card.back];
    for (const field of fields) {
      if (!field) continue;
      let match;
      const re = new RegExp(imgPattern.source, 'gi');
      while ((match = re.exec(field)) !== null) {
        referencedImages.add(match[1]);
      }
    }
  }
  // Always include occlusion card images (they're referenced via front/back already,
  // but this ensures they're never accidentally skipped)
  for (const oc of occlusionCards) {
    referencedImages.add(oc.frontImageName);
    referencedImages.add(oc.backImageName);
  }

  const skipped = Object.keys(images).filter(f => !referencedImages.has(f)).length;
  const included = Object.keys(images).filter(f => referencedImages.has(f)).length;
  console.log(`Media: ${included} images included, ${skipped} skipped (not referenced by any card)`);
  // ─────────────────────────────────────────────────────────────────

  // Build ZIP (.apkg = renamed ZIP)
  const zip = new JSZip();
  zip.file('collection.anki2', dbBuffer);

  const mediaIndex: Record<string, string> = {};
  let mediaIdx = 0;
  if (images) {
    for (const filename of Object.keys(images)) {
      // Only bundle images that are actually used in cards
      if (!referencedImages.has(filename)) continue;
      mediaIndex[mediaIdx.toString()] = filename;
      zip.file(mediaIdx.toString(), images[filename]);
      mediaIdx++;
    }
  }
  zip.file('media', JSON.stringify(mediaIndex));

  const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(outputPath, content);
  console.log(`APKG written: ${content.length} bytes`);

  // Cleanup temp files
  [dbPath, dataPath, scriptPath].forEach(f => {
    try { fs.unlinkSync(f); } catch {}
  });
}
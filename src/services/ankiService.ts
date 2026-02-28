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

export async function createAnkiPackage(
  cards: Card[],
  outputPath: string,
  deckName: string,
  images: Record<string, Buffer>
) {
  const tmpDir = os.tmpdir();
  const ts = Date.now();
  const dbPath = path.join(tmpDir, `anki_${ts}.anki2`);
  const dataPath = path.join(tmpDir, `anki_data_${ts}.json`);
  const scriptPath = path.join(tmpDir, `anki_script_${ts}.py`);

  // Write cards to temp JSON file
  const cardsData = cards.map(card => ({
    front: card.front,
    back: card.back,
    image: (card.image && images && images[card.image]) ? card.image : null
  }));

  fs.writeFileSync(dataPath, JSON.stringify({
    cards: cardsData,
    deckName,
    dbPath
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
model_id = random.randint(1000000000, 9999999999)

css = """.card{font-family:Arial,sans-serif;font-size:20px;text-align:center;color:#e8e8e8;background-color:#2b2b2b;padding:20px 60px;line-height:1.8}b{color:#7dd8f8;font-weight:bold}hr#answer{border:none;border-top:1px solid #555;margin:16px 0}"""

models = json.dumps({str(model_id): {
    "id": model_id, "name": "Basic", "type": 0, "mod": now, "usn": -1,
    "sortf": 0, "did": deck_id,
    "tmpls": [{"name": "Card 1", "ord": 0,
               "qfmt": "{{Front}}",
               "afmt": "{{FrontSide}}<hr id=answer>{{Back}}",
               "bqfmt": "", "bafmt": "", "did": None, "bfont": "", "bsize": 0}],
    "flds": [
        {"name": "Front", "ord": 0, "sticky": False, "rtl": False, "font": "Arial", "size": 20},
        {"name": "Back",  "ord": 1, "sticky": False, "rtl": False, "font": "Arial", "size": 20}
    ],
    "css": css, "latexPre": "", "latexPost": "", "tags": [], "vers": []
}})

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
    "newSpread": 0, "dueCounts": True, "curModel": str(model_id), "collapseTime": 1200
})

c.execute("INSERT INTO col VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    (1, now, now, now*1000, 11, 0, -1, 0, conf, models, decks, dconf, "{}"))

for i, card in enumerate(cards):
    note_id = now * 1000 + i
    guid = str(random.randint(10**9, 10**10))
    front = card['front']
    back = card['back']
    if card.get('image'):
        front += '<br><br><img src="' + card['image'] + '">'
    flds = front + "\\x1f" + back
    sfld = card['front']
    csum = int.from_bytes(sfld[:9].encode('utf-8')[:4].ljust(4, b'\\x00'), 'big')
    c.execute("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (note_id, guid, model_id, now, -1, "", flds, sfld, csum, 0, ""))
    c.execute("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (note_id+1, note_id, deck_id, 0, now, -1, 0, 0, i, 0, 0, 0, 0, 0, 0, 0, 0, ""))

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

  // Build ZIP (.apkg = renamed ZIP)
  const zip = new JSZip();
  zip.file('collection.anki2', dbBuffer);

  const mediaIndex: Record<string, string> = {};
  if (images) {
    Object.keys(images).forEach((filename, idx) => {
      mediaIndex[idx.toString()] = filename;
      zip.file(idx.toString(), images[filename]);
    });
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
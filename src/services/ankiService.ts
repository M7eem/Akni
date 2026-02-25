import Database from 'better-sqlite3';
import JSZip from 'jszip';
import fs from 'fs';

interface Card {
  front: string;
  back: string;
  image?: string;
}

export async function createAnkiPackage(cards: Card[], outputPath: string, deckName: string, images: Record<string, Buffer>) {
  const dbPath = outputPath.replace('.apkg', '.anki2');
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  const db = new Database(dbPath);

  // Create tables
  db.exec(`
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
    CREATE TABLE graves (
        usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL
    );
  `);

  const now = Math.floor(Date.now() / 1000); // Seconds
  const deckId = Math.floor(Math.random() * 1000000000) + 1000000000;
  const modelId = Math.floor(Math.random() * 1000000000) + 1000000000;

  const css = `
.card {
  font-family: Arial, sans-serif;
  font-size: 20px;
  text-align: center;
  color: #e8e8e8;
  background-color: #2b2b2b;
  padding: 20px 60px;
  line-height: 1.8;
}
b { color: #7dd8f8; font-weight: bold; }
hr#answer {
  border: none;
  border-top: 1px solid #555;
  margin: 16px 0;
}
`;

  const models = {
    [modelId.toString()]: {
      id: modelId, name: "Basic", type: 0, mod: now, usn: -1,
      sortf: 0, did: deckId,
      tmpls: [{
        name: "Card 1", ord: 0,
        qfmt: "{{Front}}",
        afmt: "{{FrontSide}}<hr id=answer>{{Back}}",
        bqfmt: "", bafmt: "", did: null, bfont: "", bsize: 0
      }],
      flds: [
        { name: "Front", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20 },
        { name: "Back", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20 }
      ],
      css: css, latexPre: "", latexPost: "", tags: [], vers: []
    }
  };

  const decks = {
    "1": {
      id: 1, name: "Default", conf: 1, desc: "", dyn: 0,
      collapsed: false, mod: now, usn: -1,
      lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0]
    },
    [deckId.toString()]: {
      id: deckId, name: deckName, desc: "", mod: now, usn: -1,
      lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0],
      collapsed: false, browserCollapsed: false,
      extendNew: 10, extendRev: 50, conf: 1, dyn: 0
    }
  };

  const dconf = {
    "1": {
      id: 1, name: "Default", replayq: true,
      lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 0 },
      rev: {
        perDay: 200, ease4: 1.3, fuzz: 0.05, minSpace: 1,
        ivlFct: 1, maxIvl: 36500, bury: true, hardFactor: 1.2
      },
      new: {
        perDay: 20, delays: [1, 10], separate: true, ints: [1, 4, 7],
        initialFactor: 2500, bury: true, order: 1
      },
      maxTaken: 60, timer: 0, autoplay: true, mod: 0, usn: 0, dyn: false
    }
  };

  const conf = {
    nextPos: 1, estTimes: true, activeDecks: [deckId],
    sortType: "noteFld", timeLim: 0, sortBackwards: false,
    addToCur: true, curDeck: deckId, newBury: true,
    newSpread: 0, dueCounts: true, curModel: modelId.toString(), collapseTime: 1200
  };

  const insertCol = db.prepare("INSERT INTO col VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  insertCol.run(
    1, now, now, now * 1000, 11, 0, -1, 0,
    JSON.stringify(conf), JSON.stringify(models), JSON.stringify(decks), JSON.stringify(dconf), "{}"
  );

  const insertNote = db.prepare("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  const insertCard = db.prepare("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");

  cards.forEach((card, i) => {
    const noteId = now * 1000 + i;
    const guid = Math.floor(Math.random() * 10000000000).toString(); // Simple random string
    
    let front = card.front;
    const back = card.back;
    
    if (card.image) {
      front += `<br><br><img src="${card.image}">`;
    }

    const flds = front + "\x1f" + back;
    const sfld = card.front;
    const csum = 0; 

    insertNote.run(
      noteId, guid, modelId, now, -1, "", flds, sfld, csum, 0, ""
    );

    insertCard.run(
      noteId + 1, noteId, deckId, 0, now, -1, 0, 0, i, 0, 0, 0, 0, 0, 0, 0, 0, ""
    );
  });

  db.close();

  // Create ZIP
  const zip = new JSZip();
  zip.file('collection.anki2', fs.readFileSync(dbPath));

  const mediaIndex: Record<string, string> = {};
  if (images) {
    const imageNames = Object.keys(images);
    imageNames.forEach((filename, idx) => {
      mediaIndex[idx.toString()] = filename;
      zip.file(idx.toString(), images[filename]);
    });
  }
  
  zip.file('media', JSON.stringify(mediaIndex));

  const content = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(outputPath, content);
  
  // Clean up
  fs.unlinkSync(dbPath);
}

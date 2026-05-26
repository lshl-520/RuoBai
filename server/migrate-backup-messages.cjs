/**
 * Import missing 小白 messages from server backup into local database.
 * Maps: character_id 1→15, user_id 1→3
 * Skips messages that already exist (matched by created_at + content).
 *
 * Usage: node server/migrate-backup-messages.js
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const BACKUP_PATH = path.join(__dirname, '..', '..', 'server_backups', 'ruobai_backup_20260518_141335', 'ailshl_20260518_141335.sql');
const LOCAL_CHAR_ID = 15;
const LOCAL_USER_ID = 3;
const SERVER_CHAR_ID = 1;
const SERVER_USER_ID = 1;

async function main() {
  const sql = fs.readFileSync(BACKUP_PATH, 'utf8');

  // Extract the INSERT INTO messages VALUES block
  const match = sql.match(/INSERT INTO `messages` VALUES (.+?);/s);
  if (!match) {
    console.error('Could not find messages INSERT block in backup SQL');
    process.exit(1);
  }

  // Parse individual row tuples
  const valuesStr = match[1];
  const rows = [];
  let depth = 0;
  let current = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < valuesStr.length; i++) {
    const ch = valuesStr[i];
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === '\\') {
      current += ch;
      escape = true;
      continue;
    }
    if (ch === "'" && !escape) {
      inString = !inString;
      current += ch;
      continue;
    }
    if (inString) {
      current += ch;
      continue;
    }
    if (ch === '(') {
      if (depth === 0) current = '';
      else current += ch;
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        rows.push(current);
      } else {
        current += ch;
      }
    } else {
      if (depth > 0) current += ch;
    }
  }

  console.log(`Parsed ${rows.length} total message rows from backup`);

  // Parse each row: (id, role, content, created_at, is_active, character_id, message_type, media_url, media_kind, media_meta, user_id)
  const serverMessages = [];
  for (const row of rows) {
    const fields = parseCSVRow(row);
    if (!fields || fields.length < 11) continue;

    const charId = parseInt(fields[5]);
    const userId = parseInt(fields[10]);
    if (charId !== SERVER_CHAR_ID || userId !== SERVER_USER_ID) continue;

    serverMessages.push({
      id: parseInt(fields[0]),
      role: fields[1],
      content: fields[2],
      created_at: fields[3],
      is_active: parseInt(fields[4]),
      character_id: charId,
      message_type: fields[6],
      media_url: fields[7] === 'NULL' ? null : fields[7],
      media_kind: fields[8] === 'NULL' ? null : fields[8],
      media_meta: fields[9] === 'NULL' ? null : fields[9],
      user_id: userId
    });
  }

  console.log(`Found ${serverMessages.length} messages for 小白 (character_id=${SERVER_CHAR_ID}) in backup`);

  // Connect to local database
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    database: 'ruobai',
    charset: 'utf8mb4'
  });

  // Get existing messages for dedup
  const [existing] = await conn.execute(
    'SELECT created_at, content FROM messages WHERE character_id = ? AND user_id = ?',
    [LOCAL_CHAR_ID, LOCAL_USER_ID]
  );

  function toLocalDateStr(d) {
    if (d instanceof Date) {
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
    return String(d).slice(0, 19);
  }

  // Dedup by timestamp+content
  const existingByTime = new Set(
    existing.map(r => {
      const dt = toLocalDateStr(r.created_at);
      return `${dt}|||${(r.content || '').slice(0, 40)}`;
    })
  );

  // Also dedup by content alone (for bulk-imported messages with wrong timestamps)
  const existingByContent = new Set(
    existing.map(r => (r.content || '').trim().slice(0, 80))
  );

  console.log(`Local database has ${existing.length} existing messages for 小白 (character_id=${LOCAL_CHAR_ID})`);

  // Filter to only new messages (not matching by time OR by content)
  const toInsert = serverMessages.filter(m => {
    const dtShort = m.created_at.slice(0, 19);
    const keyTime = `${dtShort}|||${(m.content || '').slice(0, 40)}`;
    if (existingByTime.has(keyTime)) return false;
    const keyContent = (m.content || '').trim().slice(0, 80);
    if (existingByContent.has(keyContent)) return false;
    return true;
  });

  console.log(`${toInsert.length} new messages to import`);

  if (toInsert.length === 0) {
    console.log('Nothing to import. All messages already exist locally.');
    await conn.end();
    return;
  }

  // Insert in batches
  let inserted = 0;
  const BATCH = 50;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(',');
    const values = batch.flatMap(m => [
      m.role === 'user' ? 'user' : 'assistant',
      m.content,
      m.created_at,
      m.is_active,
      LOCAL_CHAR_ID,
      m.message_type,
      m.media_url,
      LOCAL_USER_ID
    ]);

    await conn.execute(
      `INSERT INTO messages (role, content, created_at, is_active, character_id, message_type, media_url, user_id) VALUES ${placeholders}`,
      values
    );
    inserted += batch.length;
    process.stdout.write(`\rInserted ${inserted}/${toInsert.length}`);
  }

  console.log(`\nDone! Imported ${inserted} messages.`);

  // Verify
  const [countResult] = await conn.execute(
    'SELECT COUNT(*) as cnt FROM messages WHERE character_id = ? AND user_id = ?',
    [LOCAL_CHAR_ID, LOCAL_USER_ID]
  );
  console.log(`Total 小白 messages now: ${countResult[0].cnt}`);

  await conn.end();
}

function parseCSVRow(row) {
  const fields = [];
  let i = 0;
  while (i < row.length) {
    if (row[i] === "'") {
      // String field
      i++;
      let val = '';
      while (i < row.length) {
        if (row[i] === '\\') {
          i++;
          if (row[i] === "'") val += "'";
          else if (row[i] === 'n') val += '\n';
          else if (row[i] === 'r') val += '\r';
          else if (row[i] === 't') val += '\t';
          else if (row[i] === '\\') val += '\\';
          else val += row[i];
          i++;
        } else if (row[i] === "'") {
          i++;
          break;
        } else {
          val += row[i];
          i++;
        }
      }
      fields.push(val);
    } else if (row.slice(i, i + 4) === 'NULL') {
      fields.push('NULL');
      i += 4;
    } else {
      // Numeric or other
      let val = '';
      while (i < row.length && row[i] !== ',') {
        val += row[i];
        i++;
      }
      fields.push(val);
    }
    // Skip comma
    if (row[i] === ',') i++;
  }
  return fields;
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

import fs from 'node:fs/promises';
import path from 'node:path';

import mysql from 'mysql2/promise';

import {
  mergeCanonicalMessages,
  renderSummaryReport,
  summarizeMessages
} from './xiaobai-history.js';

const DEFAULT_OUTPUT_DIR = path.resolve('E:/Ai/nvyou/服务器数据备份/我自己-lshl');
const DEFAULT_BASELINE_PATH = path.join(DEFAULT_OUTPUT_DIR, 'merged-messages.json');
const DEFAULT_CANONICAL_PATH = path.join(DEFAULT_OUTPUT_DIR, 'xiaobai-canonical-messages.json');
const DEFAULT_REPORT_PATH = path.join(DEFAULT_OUTPUT_DIR, 'xiaobai-canonical-summary.md');
const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

async function loadBaselineMessages(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text);
}

async function loadLocalMessages() {
  const connection = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: 'ruobai',
    charset: 'utf8mb4'
  });

  try {
    const [rows] = await connection.query(`
      SELECT role, content, message_type, media_url, created_at
      FROM messages
      WHERE character_id = 48
      ORDER BY created_at ASC, id ASC
    `);
    return rows;
  } finally {
    await connection.end();
  }
}

async function main() {
  const baselineMessages = await loadBaselineMessages(DEFAULT_BASELINE_PATH);
  const localMessages = await loadLocalMessages();
  const merged = mergeCanonicalMessages({
    localMessages,
    baselineMessages
  });
  const summary = summarizeMessages(merged.messages, { timeZone: DEFAULT_TIME_ZONE });
  const report = renderSummaryReport({
    summary,
    localCount: merged.localCount,
    baselineCount: merged.baselineCount,
    addedFromBaseline: merged.addedFromBaseline,
    skippedBaselineDuplicates: merged.skippedBaselineDuplicates
  });

  await fs.writeFile(DEFAULT_CANONICAL_PATH, `${JSON.stringify(merged.messages, null, 2)}\n`, 'utf8');
  await fs.writeFile(DEFAULT_REPORT_PATH, report, 'utf8');

  console.log(JSON.stringify({
    canonicalPath: DEFAULT_CANONICAL_PATH,
    reportPath: DEFAULT_REPORT_PATH,
    totalMessages: summary.total,
    firstCreatedAt: summary.first_created_at,
    lastCreatedAt: summary.last_created_at,
    addedFromBaseline: merged.addedFromBaseline,
    skippedBaselineDuplicates: merged.skippedBaselineDuplicates,
    byDay: summary.by_day
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

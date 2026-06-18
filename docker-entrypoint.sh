#!/usr/bin/env sh
set -eu

echo "[RuoBai] 等待数据库启动..."

cd /app/server

node --input-type=module <<'NODE'
import mysql from 'mysql2/promise';

const host = process.env.DB_HOST || 'db';
const port = Number(process.env.DB_PORT || 3306);
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (let attempt = 1; attempt <= 60; attempt += 1) {
  try {
    const connection = await mysql.createConnection({ host, port, user, password });
    await connection.end();
    console.log('[RuoBai] 数据库已连接');
    process.exit(0);
  } catch (error) {
    if (attempt === 60) {
      console.error('[RuoBai] 数据库连接失败：', error.message);
      process.exit(1);
    }

    await sleep(2000);
  }
}
NODE

echo "[RuoBai] 初始化/迁移数据库..."
node init-db.js

echo "[RuoBai] 启动后端服务..."
exec node server.js

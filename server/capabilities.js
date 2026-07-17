import express from 'express';
import { pool as defaultPool, withTransaction as defaultWithTransaction } from './db.js';
import { asyncHandler } from './helpers.js';
import { buildChatCompletionsUrl } from './chat.js';
import { guessModelCapabilities } from './model-capabilities.js';

const CAPABILITIES = ['chat', 'vision', 'image', 'tts', 'realtime'];

function normalizeExtras(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  return value;
}

function parseCapabilityList(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function supportedCapabilities(row) {
  return new Set([
    ...parseCapabilityList(row.capabilities),
    ...guessModelCapabilities(row.model_id)
  ]);
}

function buildEmptyItem(capability) {
  return {
    capability,
    enabled: false,
    current: null,
    options: []
  };
}

function buildTestPayload(capability, modelId) {
  switch (capability) {
    case 'chat':
    case 'vision':
    case 'image':
    case 'realtime':
      return {
        model: modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        temperature: 0
      };
    case 'tts':
      return {
        model: modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        temperature: 0
      };
    default:
      return {
        model: modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        temperature: 0
      };
  }
}

async function loadAssignments(queryable, userId) {
  const [rows] = await queryable.query(
    `
      SELECT
        ca.capability,
        ca.enabled,
        ca.model_id,
        ca.credential_id,
        ca.extras,
        c.name AS credential_name
      FROM capability_assignments ca
      INNER JOIN credentials c ON c.id = ca.credential_id
      WHERE ca.user_id = ?
    `,
    [userId]
  );

  return rows;
}

async function loadCapabilityOptions(queryable, userId) {
  const [rows] = await queryable.query(
    `
      SELECT
        c.id AS credential_id,
        c.name AS credential_name,
        cm.model_id,
        cm.capabilities
      FROM credentials c
      INNER JOIN credential_models cm ON cm.credential_id = c.id
      WHERE c.user_id = ?
      ORDER BY c.id ASC, cm.model_id ASC
    `,
    [userId]
  );

  return rows;
}

async function loadAssignmentForTest(queryable, userId, capability) {
  const [rows] = await queryable.query(
    `
      SELECT
        ca.capability,
        ca.enabled,
        ca.model_id,
        ca.credential_id,
        ca.extras,
        c.name AS credential_name,
        c.api_base,
        c.api_key
      FROM capability_assignments ca
      INNER JOIN credentials c ON c.id = ca.credential_id
      WHERE ca.user_id = ? AND ca.capability = ?
      LIMIT 1
    `,
    [userId, capability]
  );

  return rows[0] || null;
}

async function loadCompatibleModel(queryable, credentialId, userId, modelId) {
  const [rows] = await queryable.query(
    `
      SELECT
        c.id AS credential_id,
        c.name AS credential_name,
        cm.model_id,
        cm.capabilities
      FROM credential_models cm
      INNER JOIN credentials c ON c.id = cm.credential_id
      WHERE c.id = ? AND c.user_id = ? AND cm.model_id = ?
      LIMIT 1
    `,
    [credentialId, userId, modelId]
  );

  return rows[0] || null;
}

function buildCapabilityItems(assignments, optionsRows) {
  const items = CAPABILITIES.map(buildEmptyItem);
  const byCapability = new Map(items.map(item => [item.capability, item]));

  for (const row of optionsRows) {
    const capabilities = supportedCapabilities(row);
    for (const capability of capabilities) {
      const item = byCapability.get(capability);
      if (!item) continue;
      item.options.push({
        credential_id: row.credential_id,
        credential_name: row.credential_name,
        model_id: row.model_id
      });
    }
  }

  for (const row of assignments) {
    const item = byCapability.get(row.capability);
    if (!item) continue;
    item.enabled = Boolean(row.enabled);
    item.current = {
      credential_id: row.credential_id,
      credential_name: row.credential_name,
      model_id: row.model_id,
      extras: normalizeExtras(row.extras)
    };
  }

  return items;
}

export function createCapabilitiesRouter({
  pool = defaultPool,
  withTransaction = defaultWithTransaction,
  fetchImpl = fetch
} = {}) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    const [assignments, optionsRows] = await Promise.all([
      loadAssignments(pool, req.userId),
      loadCapabilityOptions(pool, req.userId)
    ]);

    return res.json({
      success: true,
      items: buildCapabilityItems(assignments, optionsRows)
    });
  }));

  router.put('/:cap', asyncHandler(async (req, res) => {
    const capability = String(req.params.cap || '').trim();
    if (!CAPABILITIES.includes(capability)) {
      return res.status(400).json({ success: false, error: '能力类型非法' });
    }

    const enabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : true;
    const credentialId = req.body?.credential_id ? Number(req.body.credential_id) : null;
    const modelId = String(req.body?.model_id || '').trim();
    const extras = req.body?.extras || null;

    if (enabled && (!credentialId || !modelId)) {
      return res.status(400).json({ success: false, error: '缺少凭证或模型' });
    }

    if (enabled) {
      const match = await loadCompatibleModel(pool, credentialId, req.userId, modelId);
      if (!match) {
        return res.status(404).json({ success: false, error: '模型不存在或不属于当前用户' });
      }

      const supports = supportedCapabilities(match);
      if (!supports.has(capability)) {
        return res.status(400).json({ success: false, error: '这个模型不支持该能力' });
      }
    }

    await withTransaction(async connection => {
      const [rows] = await connection.query(
        'SELECT id FROM capability_assignments WHERE user_id = ? AND capability = ? LIMIT 1',
        [req.userId, capability]
      );

      if (rows.length > 0) {
        await connection.query(
          `
            UPDATE capability_assignments
            SET credential_id = ?, model_id = ?, enabled = ?, extras = ?, updated_at = NOW()
            WHERE user_id = ? AND capability = ?
          `,
          [
            credentialId,
            modelId || '',
            enabled ? 1 : 0,
            extras ? JSON.stringify(extras) : null,
            req.userId,
            capability
          ]
        );
      } else {
        await connection.query(
          `
            INSERT INTO capability_assignments
              (user_id, capability, credential_id, model_id, enabled, extras, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, NOW())
          `,
          [
            req.userId,
            capability,
            credentialId,
            modelId || '',
            enabled ? 1 : 0,
            extras ? JSON.stringify(extras) : null
          ]
        );
      }
    });

    const [assignments, optionsRows] = await Promise.all([
      loadAssignments(pool, req.userId),
      loadCapabilityOptions(pool, req.userId)
    ]);

    const item = buildCapabilityItems(assignments, optionsRows).find(entry => entry.capability === capability);
    return res.json({
      success: true,
      item
    });
  }));

  router.post('/:cap/test', asyncHandler(async (req, res) => {
    const capability = String(req.params.cap || '').trim();
    if (!CAPABILITIES.includes(capability)) {
      return res.status(400).json({ success: false, error: '能力类型非法' });
    }

    const assignment = await loadAssignmentForTest(pool, req.userId, capability);
    if (!assignment || !assignment.enabled) {
      return res.status(404).json({ success: false, error: '这个能力还没启用' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetchImpl(buildChatCompletionsUrl(assignment.api_base), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${assignment.api_key}`
        },
        body: JSON.stringify(buildTestPayload(capability, assignment.model_id)),
        signal: controller.signal
      });

      const raw = await response.text();
      if (!response.ok) {
        return res.status(400).json({
          success: false,
          error: `测试失败：${response.status} ${raw.slice(0, 200)}`
        });
      }

      return res.json({
        success: true,
        message: '测试通过'
      });
    } finally {
      clearTimeout(timeout);
    }
  }));

  return router;
}

export default createCapabilitiesRouter();

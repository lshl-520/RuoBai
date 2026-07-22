import express from 'express';
import { pool as defaultPool, withTransaction as defaultWithTransaction } from './db.js';
import { asyncHandler, maskSecret, parseInteger } from './helpers.js';
import { buildChatCompletionsUrl } from './chat.js';
import { guessModelCapabilities } from './model-capabilities.js';
import { testVolcRealtimeCredential } from './realtime-call.js';

const TASK_IMAGE_PROVIDER = 'image-task-no-key';
const TASK_IMAGE_MODEL = 'task-image-default';
const VOLC_REALTIME_PROVIDER = 'volc-realtime';
const VOLC_REALTIME_MODEL = '2.2.0.0';

function buildModelsUrl(apiBase) {
  const base = String(apiBase || '').trim().replace(/\/+$/, '');
  if (!base) {
    return '/v1/models';
  }

  if (/\/models$/i.test(base)) {
    return base;
  }

  if (/\/v\d+(?:\/[^/]+)*$/i.test(base)) {
    return `${base}/models`;
  }

  return `${base}/v1/models`;
}

function isTaskImageProvider(providerType) {
  return String(providerType || '').trim() === TASK_IMAGE_PROVIDER;
}

function fixedTaskImageModels() {
  return [{ model_id: TASK_IMAGE_MODEL, capabilities: ['image'] }];
}

function isVolcRealtimeProvider(providerType) {
  return String(providerType || '').trim() === VOLC_REALTIME_PROVIDER;
}

function fixedVolcRealtimeModels() {
  return [{ model_id: VOLC_REALTIME_MODEL, capabilities: ['realtime'] }];
}

function sanitizeCredential(body = {}) {
  return {
    name: String(body.name || '').trim(),
    provider_type: String(body.provider_type || 'openai-compatible').trim() || 'openai-compatible',
    api_base: String(body.api_base || '').trim().replace(/\/+$/, ''),
    api_aux_base: String(body.api_aux_base || '').trim().replace(/\/+$/, ''),
    api_key: String(body.api_key || '').trim()
  };
}

function presentCredential(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    provider_type: row.provider_type,
    api_base: row.api_base,
    api_aux_base: row.api_aux_base || '',
    created_at: row.created_at,
    api_key_masked: maskSecret(row.api_key),
    models_count: Number(row.models_count || 0)
  };
}

function summarizeCapabilities(items = []) {
  const summary = {
    chat: [],
    vision: [],
    image: [],
    tts: [],
    realtime: []
  };

  for (const item of items) {
    for (const capability of item.capabilities) {
      if (summary[capability]) {
        summary[capability].push(item.model_id);
      }
    }
  }

  return summary;
}

async function loadCredentialRow(queryable, credentialId, userId) {
  const [rows] = await queryable.query(
    `
      SELECT id, user_id, name, provider_type, api_base, api_aux_base, api_key, created_at
      FROM credentials
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `,
    [credentialId, userId]
  );

  return rows[0] || null;
}

async function loadCredentials(queryable, userId) {
  const [rows] = await queryable.query(
    `
      SELECT
        c.id,
        c.user_id,
        c.name,
        c.provider_type,
        c.api_base,
        c.api_aux_base,
        c.api_key,
        c.created_at,
        COUNT(cm.id) AS models_count
      FROM credentials c
      LEFT JOIN credential_models cm ON cm.credential_id = c.id
      WHERE c.user_id = ?
      GROUP BY c.id, c.user_id, c.name, c.provider_type, c.api_base, c.api_aux_base, c.api_key, c.created_at
      ORDER BY c.id DESC
    `,
    [userId]
  );

  return rows;
}

export function createCredentialsRouter({
  pool = defaultPool,
  withTransaction = defaultWithTransaction,
  fetchImpl = fetch
} = {}) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    const rows = await loadCredentials(pool, req.userId);
    return res.json({
      success: true,
      items: rows.map(presentCredential)
    });
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const payload = sanitizeCredential(req.body);
    const taskImageProvider = isTaskImageProvider(payload.provider_type);
    if (!payload.name || !payload.api_base || (!payload.api_key && !taskImageProvider)) {
      return res.status(400).json({ success: false, error: '渠道名称、地址或密钥没有填完整' });
    }
    if (taskImageProvider && !payload.api_aux_base) {
      return res.status(400).json({ success: false, error: '任务式图片接口还需要填写“任务查询 / 图片地址”' });
    }

    const [existingRows] = await pool.query(
      'SELECT id FROM credentials WHERE user_id = ? AND name = ? LIMIT 1',
      [req.userId, payload.name]
    );
    if (existingRows.length > 0) {
      return res.status(400).json({ success: false, error: `渠道名"${payload.name}"已存在，换个名字试试` });
    }

    const item = await withTransaction(async connection => {
      const [result] = await connection.query(
        `
          INSERT INTO credentials (user_id, name, provider_type, api_base, api_aux_base, api_key, created_at)
          VALUES (?, ?, ?, ?, ?, ?, NOW())
        `,
        [req.userId, payload.name, payload.provider_type, payload.api_base, payload.api_aux_base, payload.api_key]
      );

      const fixedModels = isTaskImageProvider(payload.provider_type)
        ? fixedTaskImageModels()
        : isVolcRealtimeProvider(payload.provider_type)
          ? fixedVolcRealtimeModels()
          : [];
      for (const fixedModel of fixedModels) {
        await connection.query(
          `INSERT INTO credential_models (credential_id, model_id, capabilities, discovered_at)
           VALUES (?, ?, ?, NOW())`,
          [result.insertId, fixedModel.model_id, JSON.stringify(fixedModel.capabilities)]
        );
      }

      const row = await loadCredentialRow(connection, result.insertId, req.userId);
      return row;
    });

    return res.status(201).json({
      success: true,
      item: presentCredential(item)
    });
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    const credentialId = parseInteger(req.params.id);
    if (!credentialId) {
      return res.status(400).json({ success: false, error: '凭证 ID 非法' });
    }

    const payload = sanitizeCredential(req.body);
    const item = await withTransaction(async connection => {
      const existing = await loadCredentialRow(connection, credentialId, req.userId);
      if (!existing) {
        throw new Error('凭证不存在');
      }

      await connection.query(
        `
          UPDATE credentials SET
            name = COALESCE(?, name),
            provider_type = COALESCE(?, provider_type),
            api_base = COALESCE(?, api_base),
            api_aux_base = COALESCE(?, api_aux_base),
            api_key = COALESCE(?, api_key)
          WHERE id = ? AND user_id = ?
        `,
        [
          req.body?.name !== undefined ? payload.name : null,
          req.body?.provider_type !== undefined ? payload.provider_type : null,
          req.body?.api_base !== undefined ? payload.api_base : null,
          req.body?.api_aux_base !== undefined ? payload.api_aux_base : null,
          req.body?.api_key !== undefined ? payload.api_key : null,
          credentialId,
          req.userId
        ]
      );

      return loadCredentialRow(connection, credentialId, req.userId);
    });

    return res.json({
      success: true,
      item: presentCredential(item)
    });
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const credentialId = parseInteger(req.params.id);
    if (!credentialId) {
      return res.status(400).json({ success: false, error: '凭证 ID 非法' });
    }

    const result = await withTransaction(async connection => {
      const existing = await loadCredentialRow(connection, credentialId, req.userId);
      if (!existing) {
        throw new Error('凭证不存在');
      }

      const [capRows] = await connection.query(
        'SELECT capability FROM capability_assignments WHERE credential_id = ? AND user_id = ?',
        [credentialId, req.userId]
      );

      await connection.query(
        'DELETE FROM credentials WHERE id = ? AND user_id = ?',
        [credentialId, req.userId]
      );

      return {
        disabled_capabilities: capRows.map(row => row.capability)
      };
    });

    return res.json({
      success: true,
      disabled_capabilities: result.disabled_capabilities
    });
  }));

  router.post('/:id/refresh-models', asyncHandler(async (req, res) => {
    const credentialId = parseInteger(req.params.id);
    if (!credentialId) {
      return res.status(400).json({ success: false, error: '凭证 ID 非法' });
    }

    const credential = await loadCredentialRow(pool, credentialId, req.userId);
    if (!credential) {
      return res.status(404).json({ success: false, error: '凭证不存在' });
    }

    let items = [];
    if (isTaskImageProvider(credential.provider_type)) {
      items = fixedTaskImageModels();
    } else if (isVolcRealtimeProvider(credential.provider_type)) {
      items = fixedVolcRealtimeModels();
    } else {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let models = [];
      try {
        const response = await fetchImpl(buildModelsUrl(credential.api_base), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${credential.api_key}`
          },
          signal: controller.signal
        });

        const raw = await response.text();
        if (!response.ok) {
          return res.status(400).json({
            success: false,
            error: `刷新模型失败：${response.status} ${raw.slice(0, 200)}`
          });
        }

        let payload = {};
        try {
          payload = raw ? JSON.parse(raw) : {};
        } catch {
          return res.status(400).json({
            success: false,
            error: '对方回的不是正常模型列表'
          });
        }

        models = Array.isArray(payload?.data)
          ? payload.data.map(item => String(item?.id || '').trim()).filter(Boolean)
          : [];
      } finally {
        clearTimeout(timeout);
      }

      items = models.map(modelId => ({
        model_id: modelId,
        capabilities: guessModelCapabilities(modelId)
      }));
    }

    await withTransaction(async connection => {
      await connection.query(
        'DELETE FROM credential_models WHERE credential_id = ?',
        [credentialId]
      );

      for (const item of items) {
        await connection.query(
          `
            INSERT INTO credential_models (credential_id, model_id, capabilities, discovered_at)
            VALUES (?, ?, ?, NOW())
          `,
          [credentialId, item.model_id, JSON.stringify(item.capabilities)]
        );
      }
    });

    return res.json({
      success: true,
      items,
      summary: summarizeCapabilities(items)
    });
  }));

  router.post('/:id/test', asyncHandler(async (req, res) => {
    const credentialId = parseInteger(req.params.id);
    if (!credentialId) {
      return res.status(400).json({ success: false, error: '凭证 ID 非法' });
    }

    const credential = await loadCredentialRow(pool, credentialId, req.userId);
    if (!credential) {
      return res.status(404).json({ success: false, error: '凭证不存在' });
    }

    if (isVolcRealtimeProvider(credential.provider_type)) {
      try {
        await testVolcRealtimeCredential(credential);
        return res.json({ success: true, message: '火山实时通话连接正常' });
      } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const testUrl = isTaskImageProvider(credential.provider_type)
        ? `${String(credential.api_aux_base || '').replace(/\/+$/, '')}/system_stats`
        : buildModelsUrl(credential.api_base);
      const headers = isTaskImageProvider(credential.provider_type)
        ? { Accept: 'application/json' }
        : { Authorization: `Bearer ${credential.api_key}` };
      const response = await fetchImpl(testUrl, {
        method: 'GET',
        headers,
        signal: controller.signal
      });

      const raw = await response.text();
      if (!response.ok) {
        return res.status(400).json({
          success: false,
          error: `连通失败：${response.status} ${raw.slice(0, 200)}`
        });
      }

      return res.json({
        success: true,
        message: '连通正常'
      });
    } finally {
      clearTimeout(timeout);
    }
  }));

  router.get('/:id/models', asyncHandler(async (req, res) => {
    const credentialId = parseInteger(req.params.id);
    if (!credentialId) {
      return res.status(400).json({ success: false, error: '凭证 ID 非法' });
    }

    const credential = await loadCredentialRow(pool, credentialId, req.userId);
    if (!credential) {
      return res.status(404).json({ success: false, error: '凭证不存在' });
    }

    const [rows] = await pool.query(
      `
        SELECT cm.id, cm.credential_id, cm.model_id, cm.capabilities, cm.discovered_at
        FROM credentials c
        INNER JOIN credential_models cm ON cm.credential_id = c.id
        WHERE c.id = ? AND c.user_id = ?
        ORDER BY cm.model_id ASC
      `,
      [credentialId, req.userId]
    );

    return res.json({
      success: true,
      items: rows.map(row => ({
        id: row.id,
        credential_id: row.credential_id,
        model_id: row.model_id,
        capabilities: typeof row.capabilities === 'string'
          ? JSON.parse(row.capabilities || '[]')
          : (row.capabilities || []),
        discovered_at: row.discovered_at
      }))
    });
  }));

  router.post('/:id/chat-smoke', asyncHandler(async (req, res) => {
    const credentialId = parseInteger(req.params.id);
    if (!credentialId) {
      return res.status(400).json({ success: false, error: '凭证 ID 非法' });
    }

    const credential = await loadCredentialRow(pool, credentialId, req.userId);
    if (!credential) {
      return res.status(404).json({ success: false, error: '凭证不存在' });
    }

    const model = String(req.body?.model || '').trim();
    if (!model) {
      return res.status(400).json({ success: false, error: '缺少模型名' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetchImpl(buildChatCompletionsUrl(credential.api_base), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${credential.api_key}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          temperature: 0
        }),
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
        message: '聊天测试通过'
      });
    } finally {
      clearTimeout(timeout);
    }
  }));

  return router;
}

export default createCredentialsRouter();

import express from 'express';
import { pool as defaultPool, withTransaction as defaultWithTransaction } from './db.js';
import { DEFAULT_MODEL_CONFIG } from './defaults.js';
import { asyncHandler, maskSecret, parseInteger, toBoolean } from './helpers.js';

const ONBOARDING_MESSAGE = '先配置你自己的模型，或先启用测试配置体验聊天。';

function hasDefaultTestConfig() {
  return Boolean(
    DEFAULT_MODEL_CONFIG.api_base &&
    DEFAULT_MODEL_CONFIG.api_key &&
    DEFAULT_MODEL_CONFIG.model
  );
}

export function buildChatCompletionsUrl(apiBase) {
  const base = String(apiBase || '').trim().replace(/\/+$/, '');
  if (!base) {
    return '/v1/chat/completions';
  }

  if (/\/chat\/completions$/i.test(base)) {
    return base;
  }

  if (/\/v\d+(?:\/[^/]+)*$/i.test(base)) {
    return `${base}/chat/completions`;
  }

  return `${base}/v1/chat/completions`;
}

function sanitizeConfig(body = {}) {
  return {
    name: String(body.name || '').trim(),
    provider_type: String(body.provider_type || 'openai-compatible').trim() || 'openai-compatible',
    api_base: String(body.api_base || '').trim().replace(/\/$/, ''),
    api_key: String(body.api_key || '').trim(),
    model: String(body.model || '').trim(),
    purpose: String(body.purpose || 'chat').trim() || 'chat',
    is_active: toBoolean(body.is_active) ? 1 : 0
  };
}

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

function presentConfig(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    provider_type: row.provider_type,
    api_base: row.api_base,
    model: row.model,
    purpose: row.purpose,
    is_active: row.is_active,
    created_at: row.created_at,
    api_key_masked: maskSecret(row.api_key)
  };
}

export function isTestModelConfig(row) {
  if (!row) return false;

  return (
    String(row.provider_type || '') === DEFAULT_MODEL_CONFIG.provider_type &&
    String(row.api_base || '') === DEFAULT_MODEL_CONFIG.api_base &&
    String(row.api_key || '') === DEFAULT_MODEL_CONFIG.api_key &&
    String(row.model || '') === DEFAULT_MODEL_CONFIG.model
  );
}

export function buildModelConfigStatus(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const active = list.find(row => Boolean(row.is_active)) || null;
  const hasTestConfig = list.some(isTestModelConfig);
  const hasCustomConfig = list.some(row => !isTestModelConfig(row));
  const needsOnboarding = !hasCustomConfig;

  return {
    has_any_config: list.length > 0,
    has_active_config: Boolean(active),
    has_test_config: hasTestConfig,
    has_custom_config: hasCustomConfig,
    active_config_is_test: Boolean(active && isTestModelConfig(active)),
    needs_onboarding: needsOnboarding,
    can_use_test_config: hasDefaultTestConfig(),
    onboarding_message: needsOnboarding ? ONBOARDING_MESSAGE : ''
  };
}

async function loadModelConfigRows(queryable, userId) {
  const [rows] = await queryable.query(
    `
      SELECT id, user_id, name, provider_type, api_base, api_key, model, purpose, is_active, created_at
      FROM model_configs
      WHERE user_id = ?
      ORDER BY is_active DESC, id DESC
    `,
    [userId]
  );

  return rows;
}

export function createModelConfigRouter({
  pool = defaultPool,
  withTransaction = defaultWithTransaction,
  fetchImpl = fetch
} = {}) {
  const router = express.Router();

  router.get('/status', asyncHandler(async (req, res) => {
    const rows = await loadModelConfigRows(pool, req.userId);
    return res.json({
      success: true,
      item: buildModelConfigStatus(rows)
    });
  }));

  router.get('/', asyncHandler(async (req, res) => {
    const rows = await loadModelConfigRows(pool, req.userId);

    return res.json({
      success: true,
      items: rows.map(presentConfig)
    });
  }));

  router.post('/use-test-config', asyncHandler(async (req, res) => {
    if (!hasDefaultTestConfig()) {
      return res.status(400).json({
        success: false,
        error: '公开版没有内置测试模型，请先填写你自己的模型 key'
      });
    }

    const result = await withTransaction(async connection => {
      const rows = await loadModelConfigRows(connection, req.userId);
      const existingTestConfig = rows.find(isTestModelConfig) || null;

      await connection.query(
        'UPDATE model_configs SET is_active = 0 WHERE user_id = ?',
        [req.userId]
      );

      let targetId = existingTestConfig?.id || null;

      if (targetId) {
        await connection.query(
          'UPDATE model_configs SET is_active = 1 WHERE id = ? AND user_id = ?',
          [targetId, req.userId]
        );
      } else {
        const [insertResult] = await connection.query(
          `
            INSERT INTO model_configs
              (user_id, name, provider_type, api_base, api_key, model, purpose, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW())
          `,
          [
            req.userId,
            DEFAULT_MODEL_CONFIG.name,
            DEFAULT_MODEL_CONFIG.provider_type,
            DEFAULT_MODEL_CONFIG.api_base,
            DEFAULT_MODEL_CONFIG.api_key,
            DEFAULT_MODEL_CONFIG.model,
            'chat'
          ]
        );
        targetId = insertResult.insertId;
      }

      const [targetRows, statusRows] = await Promise.all([
        connection.query(
          `
            SELECT id, user_id, name, provider_type, api_base, api_key, model, purpose, is_active, created_at
            FROM model_configs
            WHERE id = ? AND user_id = ?
            LIMIT 1
          `,
          [targetId, req.userId]
        ),
        loadModelConfigRows(connection, req.userId)
      ]);

      return {
        item: targetRows[0][0],
        status: buildModelConfigStatus(statusRows)
      };
    });

    return res.json({
      success: true,
      item: presentConfig(result.item),
      status: result.status
    });
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const payload = sanitizeConfig(req.body);
    if (!payload.name || !payload.api_base || !payload.api_key || !payload.model) {
      return res.status(400).json({ success: false, error: '模型配置字段不完整' });
    }

    const created = await withTransaction(async connection => {
      if (payload.is_active) {
        await connection.query(
          'UPDATE model_configs SET is_active = 0 WHERE user_id = ?',
          [req.userId]
        );
      }

      const [result] = await connection.query(
        `
          INSERT INTO model_configs
            (user_id, name, provider_type, api_base, api_key, model, purpose, is_active, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `,
        [
          req.userId,
          payload.name,
          payload.provider_type,
          payload.api_base,
          payload.api_key,
          payload.model,
          payload.purpose,
          payload.is_active
        ]
      );

      const [rows] = await connection.query(
        `
          SELECT id, user_id, name, provider_type, api_base, api_key, model, purpose, is_active, created_at
          FROM model_configs
          WHERE id = ? AND user_id = ?
          LIMIT 1
        `,
        [result.insertId, req.userId]
      );

      return rows[0];
    });

    return res.status(201).json({ success: true, item: presentConfig(created) });
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    const configId = parseInteger(req.params.id);
    if (!configId) {
      return res.status(400).json({ success: false, error: '配置 ID 非法' });
    }

    const payload = sanitizeConfig(req.body);
    const updated = await withTransaction(async connection => {
      const [rows] = await connection.query(
        `
          SELECT id, user_id, name, provider_type, api_base, api_key, model, purpose, is_active, created_at
          FROM model_configs
          WHERE id = ? AND user_id = ?
          LIMIT 1
        `,
        [configId, req.userId]
      );

      const existing = rows[0];
      if (!existing) {
        throw new Error('模型配置不存在');
      }

      if (payload.is_active) {
        await connection.query(
          'UPDATE model_configs SET is_active = 0 WHERE user_id = ?',
          [req.userId]
        );
      }

      await connection.query(
        `
          UPDATE model_configs
          SET
            name = COALESCE(?, name),
            provider_type = COALESCE(?, provider_type),
            api_base = COALESCE(?, api_base),
            api_key = COALESCE(?, api_key),
            model = COALESCE(?, model),
            purpose = COALESCE(?, purpose),
            is_active = ?
          WHERE id = ? AND user_id = ?
        `,
        [
          req.body?.name !== undefined ? payload.name : null,
          req.body?.provider_type !== undefined ? payload.provider_type : null,
          req.body?.api_base !== undefined ? payload.api_base : null,
          req.body?.api_key !== undefined ? payload.api_key : null,
          req.body?.model !== undefined ? payload.model : null,
          req.body?.purpose !== undefined ? payload.purpose : null,
          req.body?.is_active !== undefined ? payload.is_active : existing.is_active,
          configId,
          req.userId
        ]
      );

      const [updatedRows] = await connection.query(
        `
          SELECT id, user_id, name, provider_type, api_base, api_key, model, purpose, is_active, created_at
          FROM model_configs
          WHERE id = ? AND user_id = ?
          LIMIT 1
        `,
        [configId, req.userId]
      );

      return updatedRows[0];
    });

    return res.json({ success: true, item: presentConfig(updated) });
  }));

  router.post('/:id/activate', asyncHandler(async (req, res) => {
    const configId = parseInteger(req.params.id);
    if (!configId) {
      return res.status(400).json({ success: false, error: '配置 ID 非法' });
    }

    await withTransaction(async connection => {
      const [rows] = await connection.query(
        'SELECT id FROM model_configs WHERE id = ? AND user_id = ? LIMIT 1',
        [configId, req.userId]
      );

      if (rows.length === 0) {
        throw new Error('模型配置不存在');
      }

      await connection.query(
        'UPDATE model_configs SET is_active = 0 WHERE user_id = ?',
        [req.userId]
      );
      await connection.query(
        'UPDATE model_configs SET is_active = 1 WHERE id = ? AND user_id = ?',
        [configId, req.userId]
      );
    });

    return res.json({ success: true, message: '已切换当前模型配置' });
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const configId = parseInteger(req.params.id);
    if (!configId) {
      return res.status(400).json({ success: false, error: '配置 ID 非法' });
    }

    await pool.query(
      'DELETE FROM model_configs WHERE id = ? AND user_id = ?',
      [configId, req.userId]
    );

    return res.json({ success: true, message: '模型配置已删除' });
  }));

  router.post('/test', asyncHandler(async (req, res) => {
    try {
      const configId = parseInteger(req.body?.id);
      let payload = sanitizeConfig(req.body);

      if (configId) {
        const [rows] = await pool.query(
          `
            SELECT id, user_id, name, provider_type, api_base, api_key, model, purpose, is_active, created_at
            FROM model_configs
            WHERE id = ? AND user_id = ?
            LIMIT 1
          `,
          [configId, req.userId]
        );

        const existing = rows[0];
        if (!existing) {
          return res.status(404).json({ success: false, error: '模型配置不存在' });
        }

        payload = {
          name: existing.name,
          provider_type: existing.provider_type,
          api_base: existing.api_base,
          api_key: existing.api_key,
          model: existing.model,
          is_active: existing.is_active
        };
      }

      if (!payload.api_base || !payload.api_key || !payload.model) {
        return res.status(400).json({ success: false, error: '测试配置字段不完整' });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetchImpl(buildChatCompletionsUrl(payload.api_base), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${payload.api_key}`
          },
          body: JSON.stringify({
            model: payload.model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
            temperature: 0
          }),
          signal: controller.signal
        });

        clearTimeout(timeout);

        const raw = await response.text();
        if (!response.ok) {
          return res.status(400).json({
            success: false,
            error: `测试失败: ${response.status} ${raw.slice(0, 300)}`
          });
        }

        return res.json({
          success: true,
          message: '模型配置连通性测试成功'
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: `测试失败: ${error.message}`
      });
    }
  }));

  router.post('/discover-models', asyncHandler(async (req, res) => {
    const apiBase = String(req.body?.api_base || '').trim();
    const apiKey = String(req.body?.api_key || '').trim();

    if (!apiBase || !apiKey) {
      return res.status(400).json({
        success: false,
        error: '请先填写网址和 key'
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetchImpl(buildModelsUrl(apiBase), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        signal: controller.signal
      });

      const raw = await response.text();
      if (!response.ok) {
        return res.status(400).json({
          success: false,
          error: `拿模型列表失败：${response.status} ${raw.slice(0, 200)}`
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

      const models = Array.isArray(payload?.data)
        ? payload.data.map(item => item?.id).filter(Boolean)
        : [];

      if (!models.length) {
        return res.status(400).json({
          success: false,
          error: '已经连上了，但对方没有返回可用模型'
        });
      }

      return res.json({
        success: true,
        items: models,
        suggested_model: models[0],
        message: `已经拿到 ${models.length} 个可用模型`
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: `拿模型列表失败：${error.message}`
      });
    } finally {
      clearTimeout(timeout);
    }
  }));

  return router;
}

export default createModelConfigRouter();

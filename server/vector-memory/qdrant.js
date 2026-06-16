import crypto from 'node:crypto';

const DEFAULT_BASE_URL = 'http://127.0.0.1:6333';
const DEFAULT_COLLECTION = 'ruobai_memories_local';
const DEFAULT_VECTOR_SIZE = 384;
const DEFAULT_DISTANCE = 'Cosine';

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

async function parseQdrantError(response) {
  const detail = await response.text().catch(() => '');
  const body = detail ? ` ${detail.slice(0, 300)}` : '';
  return new Error(`Qdrant 请求失败：${response.status}${body}`);
}

export function buildMemoryFilter({ userId, characterId }) {
  if (!userId) {
    throw new Error('检索向量记忆必须传入 userId');
  }
  if (!characterId) {
    throw new Error('检索向量记忆必须传入 characterId');
  }

  return {
    must: [
      { key: 'user_id', match: { value: Number(userId) } },
      { key: 'character_id', match: { value: Number(characterId) } }
    ]
  };
}

export function createPointId(chunk) {
  const hash = crypto
    .createHash('sha1')
    .update([
      chunk.user_id,
      chunk.character_id,
      chunk.start_date,
      chunk.end_date,
      chunk.chunk_index,
      chunk.text
    ].join('|'))
    .digest('hex');

  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32)
  ].join('-');
}

export function mapChunkToPoint(chunk, vector) {
  return {
    id: createPointId(chunk),
    vector,
    payload: {
      user_id: Number(chunk.user_id),
      character_id: Number(chunk.character_id),
      character_name: chunk.character_name,
      roles: chunk.roles,
      start_date: chunk.start_date,
      end_date: chunk.end_date,
      source: chunk.source,
      chunk_index: chunk.chunk_index,
      chunk_type: chunk.chunk_type,
      content_preview: chunk.content_preview,
      text: chunk.text
    }
  };
}

export function createVectorMemoryClient({
  baseUrl = DEFAULT_BASE_URL,
  collectionName = DEFAULT_COLLECTION,
  vectorSize = DEFAULT_VECTOR_SIZE,
  distance = DEFAULT_DISTANCE,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前 Node 环境缺少 fetch，无法连接 Qdrant');
  }

  const root = normalizeBaseUrl(baseUrl);

  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${root}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      throw await parseQdrantError(response);
    }

    return response.json();
  }

  async function tryGetCollection() {
    const response = await fetchImpl(`${root}/collections/${collectionName}`, { method: 'GET' });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw await parseQdrantError(response);
    }
    return response.json();
  }

  return {
    collectionName,
    vectorSize,

    async ensureCollection() {
      const existing = await tryGetCollection();
      const existingSize = existing?.result?.config?.params?.vectors?.size;
      if (existingSize) {
        if (Number(existingSize) !== Number(vectorSize)) {
          throw new Error(`Qdrant 集合已存在，但维度是 ${existingSize}，当前需要 ${vectorSize}`);
        }
        return existing;
      }

      return request(`/collections/${collectionName}`, {
        method: 'PUT',
        body: {
          vectors: {
            size: vectorSize,
            distance
          }
        }
      });
    },

    async upsertChunks(chunks, vectors) {
      if (!Array.isArray(chunks) || !chunks.length) {
        return { points: 0 };
      }
      if (!Array.isArray(vectors) || vectors.length !== chunks.length) {
        throw new Error('写入 Qdrant 时 chunks 和 vectors 数量不一致');
      }

      const points = chunks.map((chunk, index) => mapChunkToPoint(chunk, vectors[index]));
      await request(`/collections/${collectionName}/points?wait=true`, {
        method: 'PUT',
        body: { points }
      });

      return { points: points.length };
    },

    async search({ vector, userId, characterId, limit = 12, scoreThreshold }) {
      const body = {
        vector,
        limit,
        filter: buildMemoryFilter({ userId, characterId }),
        with_payload: true
      };
      if (scoreThreshold !== undefined) {
        body.score_threshold = scoreThreshold;
      }

      const payload = await request(`/collections/${collectionName}/points/search`, {
        method: 'POST',
        body
      });

      return payload.result || [];
    }
  };
}

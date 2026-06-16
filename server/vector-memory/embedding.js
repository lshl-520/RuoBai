import crypto from 'node:crypto';

const DEFAULT_MODEL = 'Xenova/multilingual-e5-small';
const DEFAULT_BATCH_SIZE = 16;
const DEFAULT_API_VECTOR_SIZE = 768;

function normalizeVectorList(rawVectors) {
  if (!Array.isArray(rawVectors)) {
    throw new Error('embedding 结果格式不正确');
  }
  if (!Array.isArray(rawVectors[0])) {
    return [rawVectors];
  }
  return rawVectors;
}

export function createLocalEmbedder({
  model = DEFAULT_MODEL,
  batchSize = DEFAULT_BATCH_SIZE,
  extractorFactory
} = {}) {
  let extractorPromise;

  async function getExtractor() {
    if (extractorFactory) {
      return extractorFactory();
    }

    if (!extractorPromise) {
      extractorPromise = import('@huggingface/transformers')
        .then(({ pipeline }) => pipeline('feature-extraction', model));
    }

    return extractorPromise;
  }

  async function embedBatch(texts) {
    const extractor = await getExtractor();
    const output = await extractor(texts, {
      pooling: 'mean',
      normalize: true
    });
    const vectors = typeof output.tolist === 'function' ? output.tolist() : output;
    return normalizeVectorList(vectors);
  }

  return {
    model,
    vectorSize: 384,

    async embedTexts(texts) {
      const cleanTexts = (Array.isArray(texts) ? texts : [texts])
        .map(text => String(text || '').trim())
        .filter(Boolean);

      if (!cleanTexts.length) {
        return [];
      }

      const vectors = [];
      for (let index = 0; index < cleanTexts.length; index += batchSize) {
        const batch = cleanTexts.slice(index, index + batchSize);
        vectors.push(...await embedBatch(batch));
      }

      return vectors;
    },

    async embedQuery(query) {
      const [vector] = await this.embedTexts([query]);
      if (!vector) {
        throw new Error('查询内容不能为空');
      }
      return vector;
    }
  };
}

export function buildEmbeddingsUrl(apiBase) {
  const base = String(apiBase || '').trim().replace(/\/+$/, '');
  if (!base) {
    return '/v1/embeddings';
  }
  if (/\/embeddings$/i.test(base)) {
    return base;
  }
  if (/\/v\d+(?:\/[^/]+)*$/i.test(base)) {
    return `${base}/embeddings`;
  }
  return `${base}/v1/embeddings`;
}

function inferApiVectorSize(model, fallback) {
  const name = String(model || '').toLowerCase();
  if (name.includes('text-embedding-3-small')) return 1536;
  if (name.includes('text-embedding-3-large')) return 3072;
  if (name.includes('nomic-embed-text')) return 768;
  return fallback || DEFAULT_API_VECTOR_SIZE;
}

export function createOpenAICompatibleEmbedder({
  apiBase,
  apiKey = '',
  model,
  batchSize = DEFAULT_BATCH_SIZE,
  vectorSize,
  fetchImpl = globalThis.fetch
}) {
  if (!model) {
    throw new Error('API embedding 必须指定 model');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前 Node 环境缺少 fetch，无法调用 embedding 接口');
  }

  async function embedBatch(texts) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetchImpl(buildEmbeddingsUrl(apiBase), {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, input: texts })
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`embedding 接口请求失败：${response.status} ${detail.slice(0, 300)}`);
    }

    const payload = await response.json();
    return (payload.data || []).map(item => item.embedding).filter(Boolean);
  }

  return {
    model,
    vectorSize: inferApiVectorSize(model, vectorSize),

    async embedTexts(texts) {
      const cleanTexts = (Array.isArray(texts) ? texts : [texts])
        .map(text => String(text || '').trim())
        .filter(Boolean);
      const vectors = [];

      for (let index = 0; index < cleanTexts.length; index += batchSize) {
        vectors.push(...await embedBatch(cleanTexts.slice(index, index + batchSize)));
      }

      return vectors;
    },

    async embedQuery(query) {
      const [vector] = await this.embedTexts([query]);
      if (!vector) {
        throw new Error('查询内容不能为空');
      }
      return vector;
    }
  };
}

function tokenizeForHashEmbedding(text) {
  const clean = String(text || '').toLowerCase().replace(/\s+/g, '');
  const tokens = [];
  for (let index = 0; index < clean.length; index += 1) {
    tokens.push(clean[index]);
    if (index + 1 < clean.length) {
      tokens.push(clean.slice(index, index + 2));
    }
    if (index + 2 < clean.length) {
      tokens.push(clean.slice(index, index + 3));
    }
  }
  return tokens;
}

function embedByHash(text, vectorSize) {
  const vector = Array.from({ length: vectorSize }, () => 0);
  for (const token of tokenizeForHashEmbedding(text)) {
    const hash = crypto.createHash('sha1').update(token).digest();
    const index = hash.readUInt32BE(0) % vectorSize;
    const sign = hash[4] % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map(value => value / norm);
}

export function createHashEmbedder({ vectorSize = 512 } = {}) {
  return {
    model: 'local-hash-ngram',
    vectorSize,

    async embedTexts(texts) {
      return (Array.isArray(texts) ? texts : [texts])
        .map(text => String(text || '').trim())
        .filter(Boolean)
        .map(text => embedByHash(text, vectorSize));
    },

    async embedQuery(query) {
      const [vector] = await this.embedTexts([query]);
      if (!vector) {
        throw new Error('查询内容不能为空');
      }
      return vector;
    }
  };
}

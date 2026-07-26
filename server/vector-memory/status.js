const DEFAULT_EMBEDDING_URL = process.env.VECTOR_EMBEDDING_URL || 'http://127.0.0.1:8090';
const DEFAULT_QDRANT_URL = process.env.VECTOR_QDRANT_URL || 'http://127.0.0.1:6333';
const DEFAULT_COLLECTION = process.env.VECTOR_COLLECTION || 'ruobai_memories_local';

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

async function requestStatus(fetchImpl, url) {
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      signal: AbortSignal.timeout(1500)
    });
    return { response, error: null };
  } catch {
    return { response: null, error: true };
  }
}

function buildSummary({ qdrantReady, embeddingReady, collectionState }) {
  if (qdrantReady && embeddingReady && collectionState === 'ready') {
    return '已启用，聊天会查找相关旧回忆。';
  }
  if (!qdrantReady && !embeddingReady) {
    return '已降级，向量库和回忆理解服务都没有启动，聊天不会使用旧回忆。';
  }
  if (!qdrantReady) {
    return '已降级，向量库没有启动，聊天不会使用旧回忆。';
  }
  if (!embeddingReady) {
    return '已降级，回忆理解服务没有启动，聊天不会使用旧回忆。';
  }
  if (collectionState === 'missing') {
    return '已降级，向量库可用，但还没有导入旧聊天回忆。';
  }
  if (collectionState === 'empty') {
    return '已降级，向量库可用，但旧聊天回忆还没有可用片段。';
  }
  return '已降级，旧聊天回忆暂时无法确认，聊天不会使用旧回忆。';
}

export async function getVectorMemoryStatus({
  fetchImpl = globalThis.fetch,
  embeddingUrl = DEFAULT_EMBEDDING_URL,
  qdrantUrl = DEFAULT_QDRANT_URL,
  collection = DEFAULT_COLLECTION
} = {}) {
  if (typeof fetchImpl !== 'function') {
    return {
      status: 'degraded',
      summary: '已降级，当前运行环境无法检查旧聊天回忆服务。',
      qdrant: { status: 'unavailable' },
      embedding: { status: 'unavailable' },
      history: { status: 'unknown', chunks: null }
    };
  }

  const [embeddingProbe, collectionProbe] = await Promise.all([
    requestStatus(fetchImpl, `${trimTrailingSlash(embeddingUrl)}/health`),
    requestStatus(fetchImpl, `${trimTrailingSlash(qdrantUrl)}/collections/${encodeURIComponent(collection)}`)
  ]);

  const embeddingReady = Boolean(embeddingProbe.response?.ok);
  const qdrantReady = Boolean(collectionProbe.response) && collectionProbe.response.status !== 0;
  let collectionState = 'unknown';
  let chunks = null;

  if (collectionProbe.response?.ok) {
    try {
      const payload = await collectionProbe.response.json();
      chunks = Number(payload?.result?.points_count ?? payload?.result?.vectors_count ?? 0);
      collectionState = chunks > 0 ? 'ready' : 'empty';
    } catch {
      collectionState = 'unknown';
    }
  } else if (collectionProbe.response?.status === 404) {
    collectionState = 'missing';
  }

  const enabled = qdrantReady && embeddingReady && collectionState === 'ready';
  return {
    status: enabled ? 'enabled' : 'degraded',
    summary: buildSummary({ qdrantReady, embeddingReady, collectionState }),
    qdrant: { status: qdrantReady ? 'available' : 'unavailable' },
    embedding: { status: embeddingReady ? 'available' : 'unavailable' },
    history: { status: collectionState, chunks }
  };
}

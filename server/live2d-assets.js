import AdmZip from 'adm-zip';
import Busboy from 'busboy';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const LIVE2D_MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
export const LIVE2D_MAX_UNCOMPRESSED_BYTES = 240 * 1024 * 1024;
export const LIVE2D_MAX_FILES = 128;
export const LIVE2D_MAX_PATH_LENGTH = 240;

const LIVE2D_EXTENSIONS = [
  '.model3.json',
  '.moc3',
  '.physics3.json',
  '.cdi3.json',
  '.motion3.json',
  '.exp3.json',
  '.vtube.json',
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.ico'
];

function isIgnoredArchiveEntry(name) {
  const normalized = String(name || '').replaceAll('\\', '/');
  const basename = normalized.split('/').pop() || '';
  return normalized.startsWith('__MACOSX/')
    || basename === '.DS_Store'
    || basename.startsWith('._')
    // Baidu Netdisk can leave these upload-progress markers in otherwise valid model packs.
    || /\.baiduyun\.uploading\.cfg$/i.test(basename);
}

export function normalizeArchiveEntryPath(value) {
  const raw = String(value || '').replaceAll('\\', '/');
  if (!raw || raw.includes('\0') || raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) {
    throw new Error('Live2D 压缩包包含不安全的文件路径');
  }

  const segments = raw.split('/');
  if (segments.some(segment => segment === '..')) {
    throw new Error('Live2D 压缩包包含越界文件路径');
  }

  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error('Live2D 压缩包包含不安全的文件路径');
  }
  if (normalized.length > LIVE2D_MAX_PATH_LENGTH) {
    throw new Error('Live2D 压缩包内文件路径过长');
  }
  return normalized;
}

function isDirectoryEntry(entry, normalizedName) {
  return Boolean(entry?.isDirectory) || normalizedName.endsWith('/');
}

function getEntrySize(entry, key) {
  const value = Number(entry?.header?.[key] ?? entry?.[key] ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function hasAllowedExtension(name) {
  const lower = name.toLowerCase();
  return LIVE2D_EXTENSIONS.some(extension => lower.endsWith(extension));
}

function isImagePath(name) {
  return /\.(?:png|jpe?g|webp|ico)$/i.test(name);
}

function findEntry(files, name) {
  const exact = files.find(file => file.name === name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  return files.find(file => file.name.toLowerCase() === lower) || null;
}

function resolveReferencedEntry(files, manifestPath, reference) {
  const value = String(reference || '').replaceAll('\\', '/').trim();
  if (!value) return null;
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(manifestPath), value));
  return findEntry(files, relative) || findEntry(files, path.posix.normalize(value));
}

function readJsonEntry(entry, readEntry) {
  try {
    return JSON.parse(readEntry(entry?.raw || entry).toString('utf8'));
  } catch {
    throw new Error(`Live2D 文件不是有效 JSON：${entry.name}`);
  }
}

function pickPreviewPath(files, readEntry) {
  const vtubeFiles = files.filter(file => file.name.toLowerCase().endsWith('.vtube.json'));
  for (const vtubeFile of vtubeFiles) {
    const config = readJsonEntry(vtubeFile, readEntry);
    const icon = config?.FileReferences?.Icon;
    const preview = resolveReferencedEntry(files, vtubeFile.name, icon);
    if (preview && isImagePath(preview.name)) return preview.name;
  }

  const named = files.find(file => isImagePath(file.name) && /(?:icon|preview|avatar|thumb)/i.test(path.posix.basename(file.name)));
  if (named) return named.name;

  return files.find(file => isImagePath(file.name) && !/texture[_-]?\d+/i.test(file.name))?.name || null;
}

export function inspectLive2DEntries(entries, readEntry) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Live2D 压缩包是空的');
  }
  if (typeof readEntry !== 'function') {
    throw new Error('Live2D 压缩包读取器不可用');
  }

  const files = [];
  let uncompressedBytes = 0;
  let compressedBytes = 0;

  for (const entry of entries) {
    const normalizedName = normalizeArchiveEntryPath(entry?.entryName ?? entry?.name);
    if (isIgnoredArchiveEntry(normalizedName) || isDirectoryEntry(entry, normalizedName)) continue;
    if (!hasAllowedExtension(normalizedName)) {
      throw new Error(`Live2D 压缩包包含不支持的文件：${normalizedName}`);
    }

    const size = getEntrySize(entry, 'size');
    const compressedSize = getEntrySize(entry, 'compressedSize');
    uncompressedBytes += size;
    compressedBytes += compressedSize;
    if (files.length >= LIVE2D_MAX_FILES || uncompressedBytes > LIVE2D_MAX_UNCOMPRESSED_BYTES) {
      throw new Error('Live2D 压缩包过大或文件数量过多');
    }

    files.push({ name: normalizedName, size, compressedSize, raw: entry });
  }

  const modelFiles = files.filter(file => file.name.toLowerCase().endsWith('.model3.json'));
  if (modelFiles.length !== 1) {
    throw new Error('Live2D 压缩包必须包含且只能包含一个 .model3.json 模型文件');
  }
  const mocFiles = files.filter(file => file.name.toLowerCase().endsWith('.moc3'));
  if (mocFiles.length !== 1) {
    throw new Error('Live2D 压缩包必须包含且只能包含一个 .moc3 文件');
  }

  const modelFile = modelFiles[0];
  const modelJson = readJsonEntry(modelFile, readEntry);
  const references = modelJson?.FileReferences || {};
  const requiredReferences = [references.Moc, references.Physics, references.DisplayInfo, ...(Array.isArray(references.Textures) ? references.Textures : [])]
    .filter(Boolean);
  for (const reference of requiredReferences) {
    if (!resolveReferencedEntry(files, modelFile.name, reference)) {
      throw new Error(`Live2D 模型引用的文件不存在：${reference}`);
    }
  }

  const previewPath = pickPreviewPath(files, readEntry);
  return {
    modelPath: modelFile.name,
    modelVersion: modelJson?.Version ?? null,
    previewPath,
    expressionPaths: files.filter(file => file.name.toLowerCase().endsWith('.exp3.json')).map(file => file.name),
    motionPaths: files.filter(file => file.name.toLowerCase().endsWith('.motion3.json')).map(file => file.name),
    files: files.map(file => ({ name: file.name, size: file.size })),
    fileCount: files.length,
    uncompressedBytes,
    compressedBytes,
    entries: files
  };
}

function buildPublicAssetUrl(publicBaseUrl, relativePath) {
  return `${String(publicBaseUrl || '').replace(/\/$/, '')}/${String(relativePath || '')
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')}`;
}

export async function installLive2DArchive({
  archivePath,
  targetDir,
  publicBaseUrl,
  sourceName = '',
  fileStorage = fs,
  now = Date.now
} = {}) {
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();
  const info = inspectLive2DEntries(entries, entry => entry.getData());
  const root = path.resolve(targetDir);

  await fileStorage.mkdir(root, { recursive: true });
  try {
    for (const file of info.entries) {
      const destination = path.resolve(root, ...file.name.split('/'));
      if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) {
        throw new Error('Live2D 压缩包包含越界文件路径');
      }
      await fileStorage.mkdir(path.dirname(destination), { recursive: true });
      const data = file.raw.getData();
      if (data.length > LIVE2D_MAX_UNCOMPRESSED_BYTES) {
        throw new Error('Live2D 文件过大');
      }
      await fileStorage.writeFile(destination, data);
    }

    const manifest = {
      version: 1,
      kind: 'live2d',
      sourceName: path.basename(String(sourceName || 'live2d.zip')).slice(0, 120),
      modelVersion: info.modelVersion,
      modelPath: info.modelPath,
      modelUrl: buildPublicAssetUrl(publicBaseUrl, info.modelPath),
      previewPath: info.previewPath,
      previewUrl: info.previewPath ? buildPublicAssetUrl(publicBaseUrl, info.previewPath) : null,
      expressionPaths: info.expressionPaths,
      motionPaths: info.motionPaths,
      fileCount: info.fileCount,
      uncompressedBytes: info.uncompressedBytes,
      compressedBytes: info.compressedBytes,
      uploadedAt: new Date(now()).toISOString()
    };
    await fileStorage.writeFile(path.join(root, 'asset-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    return manifest;
  } catch (error) {
    await fileStorage.rm?.(root, { recursive: true, force: true })?.catch?.(() => {});
    throw error;
  }
}

export async function readMultipartUpload(req, {
  tempDir = path.join(os.tmpdir(), 'ruobai-live2d'),
  maxBytes = LIVE2D_MAX_UPLOAD_BYTES
} = {}) {
  await fs.mkdir(tempDir, { recursive: true });

  return new Promise((resolve, reject) => {
    let tempPath = null;
    let fileInfo = null;
    let fileWrite = null;
    let fileTruncated = false;
    let settled = false;

    const cleanup = async () => {
      if (!tempPath) return;
      await fs.rm(tempPath, { force: true }).catch(() => {});
    };
    const fail = async error => {
      if (settled) return;
      settled = true;
      await cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: maxBytes }
      });
    } catch (error) {
      fail(new Error('请使用 multipart/form-data 上传 Live2D 压缩包'));
      return;
    }

    parser.on('file', (fieldName, file, info) => {
      if (!['file', 'model', 'archive'].includes(fieldName)) {
        file.resume();
        return;
      }
      if (fileInfo) {
        file.resume();
        fail(new Error('一次只能上传一个 Live2D 压缩包'));
        return;
      }

      tempPath = path.join(tempDir, `${randomUUID()}.upload`);
      fileInfo = {
        filename: String(info?.filename || 'live2d.zip').slice(0, 160),
        mimeType: String(info?.mimeType || '')
      };
      const output = createWriteStream(tempPath, { flags: 'wx' });
      fileWrite = new Promise((resolveWrite, rejectWrite) => {
        output.once('finish', resolveWrite);
        output.once('error', rejectWrite);
        file.once('error', rejectWrite);
      });
      file.once('limit', () => {
        fileTruncated = true;
      });
      file.pipe(output);
    });

    parser.once('filesLimit', () => fail(new Error('一次只能上传一个 Live2D 压缩包')));
    parser.once('error', error => fail(error));
    parser.once('finish', async () => {
      if (settled) return;
      try {
        if (!fileInfo || !tempPath || !fileWrite) {
          throw new Error('没有收到 Live2D 压缩包文件');
        }
        await fileWrite;
        if (fileTruncated) {
          throw new Error('Live2D 压缩包超过 80MB 上传上限');
        }
        settled = true;
        resolve({ ...fileInfo, path: tempPath });
      } catch (error) {
        await fail(error);
      }
    });
    req.once('error', error => fail(error));
    req.pipe(parser);
  });
}

export async function inspectLive2DArchive(archivePath) {
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();
  return inspectLive2DEntries(entries, entry => entry.getData());
}

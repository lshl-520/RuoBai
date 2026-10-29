import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_XIAOBAI_PERSONA_PATH =
  process.env.DEFAULT_XIAOBAI_PERSONA_PATH || path.join(__dirname, 'default-persona.md');

export const FALLBACK_DEFAULT_PERSONA = '我是小白，一个温柔的AI助手，会陪伴你聊天。';

export function extractDefaultPersonaText(source) {
  const normalized = String(source || '').replace(/^\uFEFF/, '').trim();
  if (!normalized) {
    return '';
  }

  const fencedBlockMatch = normalized.match(/```(?:\w+)?\r?\n([\s\S]*?)```/);
  if (fencedBlockMatch) {
    return fencedBlockMatch[1].trim();
  }

  return normalized;
}

export function loadDefaultXiaobaiPersona({
  filePath = DEFAULT_XIAOBAI_PERSONA_PATH,
  logger = console,
  readFileSync = fs.readFileSync
} = {}) {
  try {
    const persona = extractDefaultPersonaText(readFileSync(filePath, 'utf8'));
    if (!persona) {
      throw new Error('default persona content is empty');
    }
    return persona;
  } catch (error) {
    logger.warn?.(
      `[defaults] Failed to load default xiaobai persona from ${filePath}, using fallback persona: ${error.message}`
    );
    return FALLBACK_DEFAULT_PERSONA;
  }
}

export function createDefaultCharacters(options = {}) {
  return [
    {
      char_key: 'xiaobai',
      name: '小白',
      tag: '陪伴',
      persona: loadDefaultXiaobaiPersona(options),
      avatar: '/assets/char-ruobai.png',
      mood: 85,
      intimacy: 50,
      is_active: 1
    }
  ];
}

export const DEFAULT_CHARACTERS = createDefaultCharacters();

export const DEFAULT_MODEL_CONFIG = {
  name: '默认模型',
  provider_type: 'openai-compatible',
  api_base: '',
  api_key: '',
  model: '',
  is_active: 0
};

export function getRegistrationMode() {
  const openSourceSingleUser = process.env.OPEN_SOURCE_SINGLE_USER === 'true';
  const betaRegistrationEnabled =
    process.env.BETA_REGISTRATION_ENABLED !== 'false' && !openSourceSingleUser;

  return {
    beta_registration_enabled: betaRegistrationEnabled,
    registration_visible: betaRegistrationEnabled,
    invite_code_required: Boolean(process.env.REGISTRATION_INVITE_CODE),
    registration_note: process.env.REGISTRATION_NOTE || '',
    registration_block_reason: openSourceSingleUser
      ? 'open_source_single_user'
      : betaRegistrationEnabled
        ? ''
        : 'beta_registration_closed'
  };
}

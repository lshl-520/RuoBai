import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultCharacters,
  DEFAULT_MODEL_CONFIG,
  DEFAULT_XIAOBAI_PERSONA_PATH,
  FALLBACK_DEFAULT_PERSONA,
  loadDefaultXiaobaiPersona
} from './defaults.js';

test('loadDefaultXiaobaiPersona extracts the first fenced persona block from the source file', () => {
  const warningCalls = [];

  const persona = loadDefaultXiaobaiPersona({
    filePath: 'E:\\fake\\正常.txt',
    logger: {
      warn: (...args) => warningCalls.push(args)
    },
    readFileSync: () => `
### 1. 小白

\`\`\`text
你是小白，一个温柔的AI伴侣，会认真陪伴我。
\`\`\`

### 2. 其他角色

\`\`\`text
你是另一个角色。
\`\`\`
`
  });

  assert.equal(persona, '你是小白，一个温柔的AI伴侣，会认真陪伴我。');
  assert.equal(warningCalls.length, 0);
});

test('loadDefaultXiaobaiPersona falls back to a built-in safe persona and warns when file read fails', () => {
  const warningCalls = [];

  const persona = loadDefaultXiaobaiPersona({
    filePath: 'E:\\fake\\missing.txt',
    logger: {
      warn: (...args) => warningCalls.push(args.join(' '))
    },
    readFileSync: () => {
      throw new Error('ENOENT');
    }
  });

  assert.equal(persona, FALLBACK_DEFAULT_PERSONA);
  assert.equal(warningCalls.length, 1);
  assert.match(warningCalls[0], /missing\.txt/);
  assert.match(warningCalls[0], /ENOENT/);
});

test('createDefaultCharacters builds a default xiaobai record with non-empty persona text', () => {
  const characters = createDefaultCharacters({
    readFileSync: () => '你是小白，一个温柔的AI助手，会陪伴用户聊天。'
  });

  assert.equal(characters.length, 1);
  assert.equal(characters[0].char_key, 'xiaobai');
  assert.equal(characters[0].name, '小白');
  assert.notEqual(characters[0].persona, '');
});

test('DEFAULT_MODEL_CONFIG does not ship with real service endpoint or API key', () => {
  assert.equal(DEFAULT_MODEL_CONFIG.api_base, '');
  assert.equal(DEFAULT_MODEL_CONFIG.api_key, '');
  assert.equal(DEFAULT_MODEL_CONFIG.model, '');
  assert.equal(DEFAULT_MODEL_CONFIG.is_active, 0);
});

test('default persona path points to a public project file', () => {
  assert.match(DEFAULT_XIAOBAI_PERSONA_PATH.replaceAll('\\', '/'), /server\/default-persona\.md$/);
  assert.doesNotMatch(DEFAULT_XIAOBAI_PERSONA_PATH, /高风险/);
});

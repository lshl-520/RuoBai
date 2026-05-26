import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCapabilityLoadErrorMessage,
  parseCapabilityResponseError
} from './profile-capability-errors.mjs';

test('buildCapabilityLoadErrorMessage shows the real error reason and concrete next steps', () => {
  const html = buildCapabilityLoadErrorMessage(new Error('请先登录'));

  assert.equal(html.includes('没能拉到能力面板（请先登录）'), true);
  assert.equal(html.includes('一键关闭.bat'), true);
  assert.equal(html.includes('重新登录一次'), true);
});

test('parseCapabilityResponseError translates 401 into a login hint', async () => {
  const error = await parseCapabilityResponseError({
    status: 401,
    async json() {
      return { success: false, error: '请先登录' };
    }
  });

  assert.equal(error.message, '请先登录');
});

test('parseCapabilityResponseError translates 404 into a restart hint', async () => {
  const error = await parseCapabilityResponseError({
    status: 404,
    async json() {
      return { success: false };
    }
  });

  assert.equal(error.message, '接口没找到，像是后端还没重启');
});

test('parseCapabilityResponseError prefers backend error details for 500 responses', async () => {
  const error = await parseCapabilityResponseError({
    status: 500,
    async json() {
      return { success: false, error: 'Table capability_assignments does not exist' };
    }
  });

  assert.equal(error.message, 'Table capability_assignments does not exist');
});

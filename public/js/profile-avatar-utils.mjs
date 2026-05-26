export function buildAvatarChoices({
  presetCount = 18,
  uploadedAvatarUrl = '',
  selectedAvatarUrl = ''
} = {}) {
  const items = [];

  if (uploadedAvatarUrl) {
    items.push({
      url: uploadedAvatarUrl,
      label: '我上传的',
      selected: uploadedAvatarUrl === selectedAvatarUrl,
      uploaded: true,
      actions: ['delete', 'reset']
    });
  }

  for (let index = 0; index < presetCount; index += 1) {
    const url = `/assets/avatar-squares/${index}.png`;
    items.push({
      url,
      label: `${index} 号`,
      selected: url === selectedAvatarUrl,
      uploaded: false
    });
  }

  return items;
}

export function shortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function prepTarget(roleName) {
  const role = (roleName || '').toLowerCase();
  if (role.includes('grammarian')) return { tab: 'info', field: 'keyword' };
  if (role.includes('table topics master')) return { tab: 'info', field: 'theme' };
  if (role.includes('speaker') || role.includes('prepared speech')) return { tab: 'speeches', field: '' };
  return { tab: 'roles', field: '' };
}
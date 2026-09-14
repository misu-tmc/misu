export function canEdit(user) {
  return user?.role === 'editor';
}

export const GUEST_NOTICE = 'Guest access is read-only. Ask an administrator for editing access.';

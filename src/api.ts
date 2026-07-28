// force rebuild
export const API_URL = import.meta.env.VITE_API_URL || '';

export function apiFetch(path: string, init?: RequestInit) {
  return fetch(`${API_URL}${path}`, init);
}
import { getErrorMessage } from '@/utils/api';

export function chatErrorMessage(error: unknown, fallback: string): string {
  let message = (
    error instanceof Error ? error.message : getErrorMessage(error)
  ).trim();
  try {
    const body: unknown = JSON.parse(message);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return fallback;
    message = getErrorMessage(body).trim();
  } catch {
    // Transport failures can contain plain text instead of a JSON body.
  }
  return !message ||
    /[{}<>[\]\r\n]/.test(message) ||
    /failed to fetch|network|load failed|unexpected error/i.test(message) ||
    message.length > 300
    ? fallback
    : message;
}

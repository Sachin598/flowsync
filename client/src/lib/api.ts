import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000';

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  withCredentials: true,
  headers: { 'X-Requested-With': 'FlowSync' }, // required by the server's CSRF guard
});

export function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const e = err.response?.data?.error;
    if (e?.details?.length && e.details[0]?.message) return `${e.message}: ${e.details[0].message}`;
    return e?.message ?? (err.code === 'ERR_NETWORK' ? 'Cannot reach the server' : err.message);
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}

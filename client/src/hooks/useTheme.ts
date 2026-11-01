import { useState } from 'react';

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('flowsync-theme', next ? 'dark' : 'light');
    } catch {
      /* storage unavailable - theme just won't persist */
    }
    setDark(next);
  };
  return { dark, toggle };
}

import { useMemo } from 'react';
import { useWorkspace } from './useWorkspace';

/**
 * What the signed-in user may do in the current workspace. The list comes from the server (which owns the role matrix),
 * so the interface can never disagree with what the API will actually allow. This only decides what to SHOW;
 * the API enforces every rule again.
 */
export function usePermissions() {
  const { current } = useWorkspace();
  const set = useMemo(() => new Set(current?.permissions ?? []), [current]);
  return { can: (permission: string) => set.has(permission), role: current?.myRole, hasWorkspace: !!current };
}

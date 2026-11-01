import { localToday } from './utils';

/** The user's own calendar day and time zone: "today" and "per day" depend on where the user is. The server validates both. */
export const dashParams = (workspaceId: string) => ({ workspaceId, today: localToday(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });

// English twin of copy-announcement.ts (AISLG-162, v60). Every member satisfies the Chinese type.

import type { ANNOUNCEMENT_COPY } from './copy-announcement';

export const ANNOUNCEMENT_COPY_EN = {
  launcher: {
    label: 'News',
    open: 'Open announcements',
    unread: (count: number) => `${count} unread`,
  },
  modal: {
    title: 'Announcements',
    empty: 'No announcements right now',
    loadFailed: 'Failed to load announcements, please try again later',
    detailFailed: 'Failed to load this announcement, please try again later',
  },
  tabs: {
    active: 'Current',
    history: 'Past',
  },
  category: {
    system: 'System',
    event: 'Event',
  },
  badge: {
    pinned: 'Pinned',
    strong: 'Important',
    unread: 'New',
    expired: 'Ended',
  },
  detail: {
    back: 'Back to list',
    loading: 'Loading…',
    publishedAt: (time: string) => `Published ${time}`,
    endsAt: (time: string) => `Ends ${time}`,
    noEnd: 'No end date',
  },
  history: {
    loadMore: 'Older',
  },
  strong: {
    title: 'Important announcement',
    hint: 'Press "Got it" to mark as read; it will not pop up again',
    confirm: 'Got it',
  },
  broadcast: {
    text: (title: string) => `Announcement: ${title}`,
    open: 'View announcement',
  },
} satisfies typeof ANNOUNCEMENT_COPY;

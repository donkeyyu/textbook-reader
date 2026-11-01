import type { RefObject } from 'react';
import type { LinkIndex } from '../../desktop/links';
import type { AnchorTarget } from '../../desktop/anchors';
export type AnchorSession = { vaultToken: string; key?: number; path?: string; anchors: unknown; originals?: string[]; writable: boolean; index: LinkIndex };
export type AnchorCommand = { session: AnchorSession; append?: unknown[]; index?: number; rects?: unknown; create?: { name: string; anchors: unknown[] } };
export type AnchorBridge = RefObject<((command: AnchorCommand) => Promise<boolean>) | null>;
export type LocateRequest = AnchorTarget & { serial: number; vaultToken: string; origin?: 'relation' };

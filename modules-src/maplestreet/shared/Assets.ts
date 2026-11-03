/**
 * Publishing state shared by every admin-published asset (Buy items,
 * vehicles, and the garments, props and buildings that follow). Drafts are
 * listed only to the administrator and only in the developer instance
 * (`?dev=1`); retired assets stay registered so owners keep them.
 */
export const ASSET_STATUSES = ['draft', 'published', 'retired'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export const isAssetStatus = (v: unknown): v is AssetStatus => typeof v === 'string' && (ASSET_STATUSES as readonly string[]).includes(v);
export const isDraft = (r: { status?: AssetStatus }) => r.status === 'draft';

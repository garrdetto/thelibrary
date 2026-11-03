/**
 * The developer instance (`?dev=1`): a private solo game that also loads the
 * administrator's draft items and vehicles, so they can be placed, bought and
 * driven before anyone else sees them. It keeps its own save, so trying drafts
 * never touches the regular solo neighborhood, and it never joins the shared
 * world (whose authority only knows published assets).
 */
export const DEV_MODE = typeof location !== 'undefined' && new URLSearchParams(location.search).get('dev') === '1';
export const DEV_SAVE = 'maplestreet/dev/v1';

/** List URL for a published-asset endpoint; the dev instance asks for drafts too. */
export const assetListUrl = (endpoint: string) => (DEV_MODE ? `${endpoint}?drafts=1` : endpoint);

/** What the server actually sent: drafts come back only for the signed-in administrator. */
export const devDrafts = { allowed: false, items: 0, vehicles: 0, ids: new Set<string>() };

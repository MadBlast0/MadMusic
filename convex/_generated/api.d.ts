/* eslint-disable */
/** Generated API types. Hand-written for now — see `dataModel.d.ts`. */
import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from 'convex/server';

import type * as desktopAuth from '../desktopAuth.js';
import type * as devices from '../devices.js';
import type * as lib from '../lib.js';
import type * as sessions from '../sessions.js';
import type * as sync from '../sync.js';
import type * as uploads from '../uploads.js';

declare const fullApi: ApiFromModules<{
  desktopAuth: typeof desktopAuth;
  devices: typeof devices;
  lib: typeof lib;
  sessions: typeof sessions;
  sync: typeof sync;
  uploads: typeof uploads;
}>;

export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, 'public'>
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, 'internal'>
>;

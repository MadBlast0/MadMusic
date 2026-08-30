/* eslint-disable */
/** Generated server helpers. Hand-written for now — see `dataModel.d.ts`. */
import type {
  ActionBuilder,
  GenericActionCtx,
  GenericMutationCtx,
  GenericQueryCtx,
  MutationBuilder,
  QueryBuilder,
} from 'convex/server';

import type { DataModel } from './dataModel.js';

export declare const query: QueryBuilder<DataModel, 'public'>;
export declare const internalQuery: QueryBuilder<DataModel, 'internal'>;
export declare const mutation: MutationBuilder<DataModel, 'public'>;
export declare const internalMutation: MutationBuilder<DataModel, 'internal'>;
export declare const action: ActionBuilder<DataModel, 'public'>;
export declare const internalAction: ActionBuilder<DataModel, 'internal'>;

export type QueryCtx = GenericQueryCtx<DataModel>;
export type MutationCtx = GenericMutationCtx<DataModel>;
export type ActionCtx = GenericActionCtx<DataModel>;

/* eslint-disable */
/**
 * Generated data model types.
 *
 * # Why this is written by hand
 *
 * `npx convex codegen` normally writes this, and it refuses to run without a
 * configured deployment. That left `convex/` importing a directory that did not
 * exist, so the backend — sixty-four functions over eighteen tables — had never
 * been compiled even once. Nothing in the repository checked it: the root
 * `tsconfig.json` references only the app and node projects, and the frontend
 * deliberately avoids the generated API so that it can build with no backend.
 *
 * These are not stand-ins. They are the same construction the real codegen
 * emits, derived from `schema.ts` itself through Convex's own public generic
 * types — so a query against a table that does not exist, or a field that is
 * not on it, is a type error here exactly as it would be after a deploy.
 *
 * `npx convex dev` will overwrite this file, which is the intended outcome: it
 * regenerates from the same schema and should produce the same thing.
 */
import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
  TableNamesInDataModel,
  SystemTableNames,
} from 'convex/server';
import type { GenericId } from 'convex/values';

import schema from '../schema.js';

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export type TableNames = TableNamesInDataModel<DataModel>;
export type Doc<TableName extends TableNames> = DocumentByName<
  DataModel,
  TableName
>;
export type Id<TableName extends TableNames | SystemTableNames> =
  GenericId<TableName>;

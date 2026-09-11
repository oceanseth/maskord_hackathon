/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent from "../agent.js";
import type * as cast from "../cast.js";
import type * as debate from "../debate.js";
import type * as files from "../files.js";
import type * as messages from "../messages.js";
import type * as nebius from "../nebius.js";
import type * as presence from "../presence.js";
import type * as pro from "../pro.js";
import type * as rentable from "../rentable.js";
import type * as research from "../research.js";
import type * as rooms from "../rooms.js";
import type * as servers from "../servers.js";
import type * as wizard from "../wizard.js";
import type * as wizard_engine from "../wizard/engine.js";
import type * as wizard_pregens from "../wizard/pregens.js";
import type * as wizard_scenario from "../wizard/scenario.js";
import type * as wizard_types from "../wizard/types.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  cast: typeof cast;
  debate: typeof debate;
  files: typeof files;
  messages: typeof messages;
  nebius: typeof nebius;
  presence: typeof presence;
  pro: typeof pro;
  rentable: typeof rentable;
  research: typeof research;
  rooms: typeof rooms;
  servers: typeof servers;
  wizard: typeof wizard;
  "wizard/engine": typeof wizard_engine;
  "wizard/pregens": typeof wizard_pregens;
  "wizard/scenario": typeof wizard_scenario;
  "wizard/types": typeof wizard_types;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};

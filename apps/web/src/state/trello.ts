import { createTrelloEnvironmentAtoms } from "@t3tools/client-runtime/state/trello";

import { connectionAtomRuntime } from "../connection/runtime";

export const trelloEnvironment = createTrelloEnvironmentAtoms(connectionAtomRuntime);

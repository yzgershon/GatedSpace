import { createContext } from "react";

/** A host with multiple visible tab groups owns which group has keyboard focus. */
export const WorkspaceFocusContext = createContext(true);

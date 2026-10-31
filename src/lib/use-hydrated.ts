"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
const ready = () => true;
const server = () => false;
/** Do not accept a file before the browser-side change handler is attached. */
export function useHydrated() { return useSyncExternalStore(subscribe, ready, server); }

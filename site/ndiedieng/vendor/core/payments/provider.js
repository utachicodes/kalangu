/**
 * Payment provider port (docs/payments-design.md §10, §6).
 *
 * Core defines the interface and result types. A concrete provider
 * (pawaPay, a fake for tests and the simulator) implements it. Core never
 * calls a provider directly except through this port, so swapping providers
 * or testing without one requires no change to the engine.
 */
export {};
/**
 * Which model backs the optional conversational layer, in one place so the
 * badge a vendor reads and the model actually called can never drift apart.
 *
 * Naming it matters: a vendor deciding whether to trust a recommendation is
 * owed the difference between "a calculator did this" and "a language model
 * suggested this". Here the honest answer is the former — the numbers are
 * deterministic — and this label only ever appears alongside the part the
 * model genuinely does.
 */
export const ADVISOR_MODEL_ID = "claude-opus-4-8";
export const ADVISOR_MODEL_LABEL = "Claude Opus 4.8";

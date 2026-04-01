/**
 * Re-exports experimental AI grid-parsing prompts for backward compatibility.
 * The grid-parsing AI flow is no longer exposed in the main UI; prompts live in
 * experimental_prompts.ts. This file keeps the public API stable for any
 * internal hooks (useAIConversion) that still reference it.
 */
export type { PromptVersion, PromptConfig } from "./experimental_prompts";
export { PROMPT_GALLERY, DEFAULT_PROMPT_VERSION } from "./experimental_prompts";

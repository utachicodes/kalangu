// The website's Gemini endpoint when the Vercel project's root is the
// repository (with site/ as the output). When the root is site/, Vercel
// uses site/api/ndiedieng/gemini.mjs directly and ignores this file.
// Built from examples/ndiedieng/src/geminiFunction.ts; see that file.
export { GET, POST } from "../../site/api/ndiedieng/gemini.mjs";

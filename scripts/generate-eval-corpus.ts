import { generateEvaluationCorpus } from "./fixtures.js";

const result = await generateEvaluationCorpus();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

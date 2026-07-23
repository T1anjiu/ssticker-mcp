import { generateDemoCatalog } from "./fixtures.js";

const result = await generateDemoCatalog();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

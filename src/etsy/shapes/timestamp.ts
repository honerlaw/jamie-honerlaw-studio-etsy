import { z } from "zod";

// Etsy's epoch seconds, shown to the model as an ISO 8601 time.
export const TIMESTAMP = z.number().transform((seconds) => new Date(seconds * 1000).toISOString());

import * as z from "zod/v4";
import type { AppConfig } from "../config.js";
import { SCENES, redactSensitiveText } from "../domain/scenes.js";
import { clamp } from "../utils.js";

const LlmClassificationSchema = z.object({
  scene_id: z.string(),
  confidence: z.number().min(0).max(1),
  tones: z.array(z.string()).max(4),
  intensity: z.number().min(0).max(1),
  serious: z.boolean()
});

export type LlmClassification = z.infer<typeof LlmClassificationSchema>;

export class OpenAiCompatibleClassifier {
  constructor(private readonly config: NonNullable<AppConfig["llm"]>) {}

  async classify(context: string): Promise<LlmClassification | null> {
    const allowedScenes = SCENES.map((scene) => scene.id).join(", ");
    const prompt = redactSensitiveText(context).slice(-4000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {})
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `Classify a chat reaction. Return JSON only with scene_id, confidence, tones, intensity, serious. scene_id must be one of: ${allowedScenes}. Never include reasoning.`
            },
            { role: "user", content: prompt }
          ]
        })
      });
      if (!response.ok) {
        return null;
      }
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        return null;
      }
      const parsed = LlmClassificationSchema.safeParse(JSON.parse(content));
      if (!parsed.success || !SCENES.some((scene) => scene.id === parsed.data.scene_id)) {
        return null;
      }
      return {
        ...parsed.data,
        confidence: clamp(parsed.data.confidence),
        intensity: clamp(parsed.data.intensity)
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

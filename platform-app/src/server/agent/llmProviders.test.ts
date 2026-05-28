import { describe, expect, it } from "vitest";
import { prepareMessagesForLLM } from "./llmProviders";
import type { ChatMessage } from "./types";

function totalChars(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + message.content.length + message.role.length + 4, 0);
}

describe("prepareMessagesForLLM", () => {
  it("compacts older conversation into a summary while preserving recent turns", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "system prompt" },
      ...Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? "user" as const : "assistant" as const,
        content: `old message ${i} ${"x".repeat(500)}`,
      })),
      { role: "user", content: "fresh user request" },
    ];

    const prepared = prepareMessagesForLLM(messages, 9_000);

    expect(totalChars(prepared)).toBeLessThanOrEqual(9_000);
    expect(prepared[0]).toEqual({ role: "system", content: "system prompt" });
    expect(prepared.some((m) => m.role === "system" && m.content.includes("Всего свернуто сообщений"))).toBe(true);
    expect(prepared.at(-1)?.content).toBe("fresh user request");
  });

  it("removes inline image data from summary/context payloads", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "system prompt" },
      { role: "user", content: `draw this data:image/png;base64,${"a".repeat(20_000)}` },
      { role: "assistant", content: "ok" },
    ];

    const prepared = prepareMessagesForLLM(messages, 5_000);
    const joined = prepared.map((m) => m.content).join("\n");

    expect(joined).toContain("[image data omitted]");
    expect(joined).not.toContain("data:image/png;base64");
    expect(totalChars(prepared)).toBeLessThanOrEqual(5_000);
  });
});

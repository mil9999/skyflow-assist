import { randomUUID } from "node:crypto";

import type { SimulatorConversation } from "./types";

/**
 * Development-only. Conversations live in the Node process and are lost when the
 * dev server restarts. Phase 6 moves anything worth keeping into the database.
 */
const conversations = new Map<string, SimulatorConversation>();

export function createConversation(sessionId: string): SimulatorConversation {
  const conversation: SimulatorConversation = {
    conversationId: `conv_${randomUUID()}`,
    sessionId,
    input: [],
    messages: [],
    latestOptions: [],
    createdAt: new Date(),
  };
  conversations.set(conversation.conversationId, conversation);
  return conversation;
}

export function getConversation(conversationId: string): SimulatorConversation | undefined {
  return conversations.get(conversationId);
}

export function clearConversations(): void {
  conversations.clear();
}

export function conversationCount(): number {
  return conversations.size;
}

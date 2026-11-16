ALTER TABLE "ConversationSession" ADD COLUMN "controller" TEXT NOT NULL DEFAULT 'AI';
ALTER TABLE "ConversationSession" ADD COLUMN "takenOverAt" DATETIME;

CREATE TABLE "VoiceConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "busy" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VoiceConversation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ConversationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VoiceConversation_sessionId_key" ON "VoiceConversation"("sessionId");

CREATE TABLE "VoiceToolCall" (
    "conversationId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("conversationId", "callId"),
    CONSTRAINT "VoiceToolCall_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "VoiceConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ConversationEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ConversationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConversationEntry_sessionId_sourceId_key" ON "ConversationEntry"("sessionId", "sourceId");
CREATE INDEX "ConversationEntry_sessionId_createdAt_idx" ON "ConversationEntry"("sessionId", "createdAt");

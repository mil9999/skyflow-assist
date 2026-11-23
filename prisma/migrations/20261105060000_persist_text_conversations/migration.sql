CREATE TABLE "TextConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "busy" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TextConversation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ConversationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TextConversation_sessionId_key" ON "TextConversation"("sessionId");

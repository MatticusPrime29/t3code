import { TrelloId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { formatInitialTrelloPrompt, formatTrelloUpdates } from "./trelloContext";

const context = {
  id: TrelloId.make("card-1"),
  name: "Repair login redirect",
  url: "https://trello.com/c/card-1",
  description: "Preserve the return URL after login.",
  dateLastActivity: "2026-08-31T12:00:00.000Z",
  comments: [
    {
      id: TrelloId.make("comment-2"),
      text: "Also cover expired sessions.",
      author: "Julius",
      date: "2026-08-31T11:00:00.000Z",
    },
    {
      id: TrelloId.make("comment-1"),
      text: "This reproduces on desktop.",
      author: "Theo",
      date: "2026-08-31T10:00:00.000Z",
    },
  ],
  attachments: [],
  updates: { description: true, comments: true, attachments: false },
} as const;

describe("Trello composer context", () => {
  it("formats a complete initial card without sending it", () => {
    expect(formatInitialTrelloPrompt(context)).toBe(
      [
        "The following is a Trello card.",
        "# Repair login redirect",
        "Trello card: https://trello.com/c/card-1",
        "## Description",
        "Preserve the return URL after login.",
        "## Comments",
        "- Theo (2026-08-31T10:00:00.000Z):\nThis reproduces on desktop.\n\n- Julius (2026-08-31T11:00:00.000Z):\nAlso cover expired sessions.",
      ].join("\n\n"),
    );
  });

  it("includes only the update sections selected by the user", () => {
    expect(
      formatTrelloUpdates({
        context,
        includeDescription: true,
        includeComments: false,
      }),
    ).toBe("## Updated description\n\nPreserve the return URL after login.");
  });
});

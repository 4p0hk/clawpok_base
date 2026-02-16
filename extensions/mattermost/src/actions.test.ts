import { describe, expect, it, vi, beforeEach } from "vitest";

import { mattermostMessageActions } from "./actions.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

// --- mocks ---

vi.mock("./mattermost/accounts.js", () => ({
  listEnabledMattermostAccounts: vi.fn(
    (cfg: OpenClawConfig) => {
      const mm = cfg?.channels?.mattermost as Record<string, unknown> | undefined;
      if (!mm || mm.enabled === false) return [];
      const token = mm.botToken ?? "bot-tok";
      const baseUrl = mm.baseUrl ?? "https://mm.test";
      return [{ accountId: "default", botToken: token, baseUrl, enabled: true, config: mm }];
    },
  ),
  resolveMattermostAccount: vi.fn(({ cfg, accountId }) => {
    const mm = cfg?.channels?.mattermost as Record<string, unknown> | undefined;
    return {
      accountId: accountId ?? "default",
      enabled: true,
      botToken: mm?.botToken ?? "bot-tok",
      baseUrl: mm?.baseUrl ?? "https://mm.test",
      config: mm ?? {},
    };
  }),
}));

const mockRequest = vi.fn();

vi.mock("./mattermost/client.js", () => ({
  normalizeMattermostBaseUrl: vi.fn((url: string) => url?.replace(/\/+$/, "")),
  createMattermostClient: vi.fn(() => ({
    baseUrl: "https://mm.test",
    apiBaseUrl: "https://mm.test/api/v4",
    token: "bot-tok",
    request: (...args: unknown[]) => mockRequest(...args),
  })),
  fetchMattermostMe: vi.fn().mockResolvedValue({ id: "bot-user-id", username: "bot" }),
  getMattermostPost: vi.fn().mockResolvedValue({ id: "post-1", message: "hello" }),
  updateMattermostPost: vi.fn().mockResolvedValue({ id: "post-1", message: "edited" }),
  deleteMattermostPost: vi.fn().mockResolvedValue(undefined),
  addMattermostReaction: vi.fn().mockResolvedValue({ user_id: "bot-user-id", post_id: "post-1", emoji_name: "thumbsup" }),
  removeMattermostReaction: vi.fn().mockResolvedValue(undefined),
  getMattermostReactions: vi.fn().mockResolvedValue([
    { user_id: "u1", post_id: "post-1", emoji_name: "thumbsup", create_at: 1000 },
  ]),
  pinMattermostPost: vi.fn().mockResolvedValue(undefined),
  unpinMattermostPost: vi.fn().mockResolvedValue(undefined),
  getPinnedMattermostPosts: vi.fn().mockResolvedValue({
    order: ["pin-1"],
    posts: { "pin-1": { id: "pin-1", user_id: "u1", message: "pinned msg", create_at: 2000 } },
  }),
  getMattermostChannelPosts: vi.fn().mockResolvedValue({
    order: ["p1", "p2"],
    posts: {
      p1: { id: "p1", user_id: "u1", message: "first", create_at: 1000 },
      p2: { id: "p2", user_id: "u2", message: "second", create_at: 2000 },
    },
  }),
}));

vi.mock("./mattermost/send.js", () => ({
  sendMessageMattermost: vi.fn().mockResolvedValue({ messageId: "new-msg-1", channelId: "ch-1" }),
}));

// --- helpers ---

function mmCfg(overrides?: Record<string, unknown>): OpenClawConfig {
  return {
    channels: {
      mattermost: {
        botToken: "bot-tok",
        baseUrl: "https://mm.test",
        ...overrides,
      },
    },
  };
}

// --- tests ---

describe("mattermostMessageActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- listActions ---

  describe("listActions", () => {
    it("returns empty array when no accounts are enabled", () => {
      const cfg: OpenClawConfig = { channels: { mattermost: { enabled: false } } };
      const actions = mattermostMessageActions.listActions!({ cfg });
      expect(actions).toEqual([]);
    });

    it("returns empty array when account has no botToken", async () => {
      const { listEnabledMattermostAccounts } = await import("./mattermost/accounts.js");
      vi.mocked(listEnabledMattermostAccounts).mockReturnValueOnce([
        { accountId: "default", botToken: "", baseUrl: "https://mm.test", enabled: true, config: {} } as never,
      ]);
      const actions = mattermostMessageActions.listActions!({ cfg: mmCfg() });
      expect(actions).toEqual([]);
    });

    it("returns all actions when configured and no gates disabled", () => {
      const actions = mattermostMessageActions.listActions!({ cfg: mmCfg() });
      expect(actions).toContain("send");
      expect(actions).toContain("react");
      expect(actions).toContain("reactions");
      expect(actions).toContain("read");
      expect(actions).toContain("edit");
      expect(actions).toContain("delete");
      expect(actions).toContain("pin");
      expect(actions).toContain("unpin");
      expect(actions).toContain("list-pins");
    });

    it("excludes reaction actions when reactions gate is off", () => {
      const actions = mattermostMessageActions.listActions!({
        cfg: mmCfg({ actions: { reactions: false } }),
      });
      expect(actions).toContain("send");
      expect(actions).not.toContain("react");
      expect(actions).not.toContain("reactions");
      // messages + pins still present
      expect(actions).toContain("read");
      expect(actions).toContain("pin");
    });

    it("excludes message actions when messages gate is off", () => {
      const actions = mattermostMessageActions.listActions!({
        cfg: mmCfg({ actions: { messages: false } }),
      });
      expect(actions).toContain("send");
      expect(actions).not.toContain("read");
      expect(actions).not.toContain("edit");
      expect(actions).not.toContain("delete");
      // reactions + pins still present
      expect(actions).toContain("react");
      expect(actions).toContain("pin");
    });

    it("excludes pin actions when pins gate is off", () => {
      const actions = mattermostMessageActions.listActions!({
        cfg: mmCfg({ actions: { pins: false } }),
      });
      expect(actions).toContain("send");
      expect(actions).not.toContain("pin");
      expect(actions).not.toContain("unpin");
      expect(actions).not.toContain("list-pins");
      // reactions + messages still present
      expect(actions).toContain("react");
      expect(actions).toContain("read");
    });
  });

  // --- extractToolSend ---

  describe("extractToolSend", () => {
    it("extracts to param from sendMessage action", () => {
      const result = mattermostMessageActions.extractToolSend!({
        args: { action: "sendMessage", to: "ch-123" },
      });
      expect(result).toEqual({ to: "ch-123" });
    });

    it("returns null for non-sendMessage action", () => {
      const result = mattermostMessageActions.extractToolSend!({
        args: { action: "react", to: "ch-123" },
      });
      expect(result).toBeNull();
    });

    it("returns null when to is missing", () => {
      const result = mattermostMessageActions.extractToolSend!({
        args: { action: "sendMessage" },
      });
      expect(result).toBeNull();
    });
  });

  // --- handleAction ---

  describe("handleAction", () => {
    it("throws for unsupported actions", async () => {
      await expect(
        mattermostMessageActions.handleAction!({
          action: "unknownAction",
          params: {},
          cfg: mmCfg(),
          accountId: null,
        }),
      ).rejects.toThrow("is not supported");
    });

    // --- send ---

    describe("send", () => {
      it("sends a message via sendMessageMattermost", async () => {
        const { sendMessageMattermost } = await import("./mattermost/send.js");

        const result = await mattermostMessageActions.handleAction!({
          action: "send",
          params: { to: "ch-1", message: "hello world" },
          cfg: mmCfg(),
          accountId: null,
        });

        expect(sendMessageMattermost).toHaveBeenCalledWith(
          "ch-1",
          "hello world",
          expect.objectContaining({}),
        );
        expect(result).toMatchObject({ details: { ok: true, messageId: "new-msg-1" } });
      });

      it("passes media and replyTo options", async () => {
        const { sendMessageMattermost } = await import("./mattermost/send.js");

        await mattermostMessageActions.handleAction!({
          action: "send",
          params: { to: "ch-1", message: "pic", media: "https://img.test/a.png", replyTo: "parent-1" },
          cfg: mmCfg(),
          accountId: null,
        });

        expect(sendMessageMattermost).toHaveBeenCalledWith(
          "ch-1",
          "pic",
          expect.objectContaining({
            mediaUrl: "https://img.test/a.png",
            replyToId: "parent-1",
          }),
        );
      });
    });

    // --- react ---

    describe("react", () => {
      it("adds a reaction", async () => {
        const { addMattermostReaction, fetchMattermostMe } = await import("./mattermost/client.js");

        const result = await mattermostMessageActions.handleAction!({
          action: "react",
          params: { messageId: "post-1", emoji: "thumbsup" },
          cfg: mmCfg(),
          accountId: null,
        });

        expect(fetchMattermostMe).toHaveBeenCalled();
        expect(addMattermostReaction).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            userId: "bot-user-id",
            postId: "post-1",
            emojiName: "thumbsup",
          }),
        );
        expect(result).toMatchObject({ details: { ok: true, added: "thumbsup" } });
      });

      it("removes a reaction when remove flag is set", async () => {
        const { removeMattermostReaction } = await import("./mattermost/client.js");

        const result = await mattermostMessageActions.handleAction!({
          action: "react",
          params: { messageId: "post-1", emoji: "thumbsup", remove: true },
          cfg: mmCfg(),
          accountId: null,
        });

        expect(removeMattermostReaction).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            userId: "bot-user-id",
            postId: "post-1",
            emojiName: "thumbsup",
          }),
        );
        expect(result).toMatchObject({ details: { ok: true, removed: true, emoji: "thumbsup" } });
      });

      it("throws when emoji is missing", async () => {
        await expect(
          mattermostMessageActions.handleAction!({
            action: "react",
            params: { messageId: "post-1" },
            cfg: mmCfg(),
            accountId: null,
          }),
        ).rejects.toThrow(/emoji/i);
      });

      it("throws when messageId is missing", async () => {
        await expect(
          mattermostMessageActions.handleAction!({
            action: "react",
            params: { emoji: "thumbsup" },
            cfg: mmCfg(),
            accountId: null,
          }),
        ).rejects.toThrow("messageId");
      });
    });

    // --- reactions ---

    describe("reactions", () => {
      it("lists reactions for a post", async () => {
        const { getMattermostReactions } = await import("./mattermost/client.js");

        const result = await mattermostMessageActions.handleAction!({
          action: "reactions",
          params: { messageId: "post-1" },
          cfg: mmCfg(),
          accountId: null,
        });

        expect(getMattermostReactions).toHaveBeenCalledWith(expect.anything(), "post-1");
        expect(result).toMatchObject({
          details: {
            ok: true,
            messageId: "post-1",
            reactions: [{ userId: "u1", emoji: "thumbsup", createdAt: 1000 }],
          },
        });
      });
    });

    // --- read ---

    describe("read", () => {
      it("reads channel posts", async () => {
        const { getMattermostChannelPosts } = await import("./mattermost/client.js");

        const result = await mattermostMessageActions.handleAction!({
          action: "read",
          params: { to: "ch-1" },
          cfg: mmCfg(),
          accountId: null,
        });

        expect(getMattermostChannelPosts).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ channelId: "ch-1" }),
        );
        expect(result).toMatchObject({
          details: {
            ok: true,
            channelId: "ch-1",
            messages: [
              { id: "p1", userId: "u1", message: "first" },
              { id: "p2", userId: "u2", message: "second" },
            ],
          },
        });
      });

      it("passes pagination params", async () => {
        const { getMattermostChannelPosts } = await import("./mattermost/client.js");

        await mattermostMessageActions.handleAction!({
          action: "read",
          params: { channelId: "ch-1", limit: 5, before: "cursor-b", after: "cursor-a" },
          cfg: mmCfg(),
          accountId: null,
        });

        expect(getMattermostChannelPosts).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            channelId: "ch-1",
            perPage: 5,
            before: "cursor-b",
            after: "cursor-a",
          }),
        );
      });

      it("resolves channelId from channelId param over to param", async () => {
        const { getMattermostChannelPosts } = await import("./mattermost/client.js");

        await mattermostMessageActions.handleAction!({
          action: "read",
          params: { channelId: "explicit-ch", to: "fallback-ch" },
          cfg: mmCfg(),
          accountId: null,
        });

        expect(getMattermostChannelPosts).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ channelId: "explicit-ch" }),
        );
      });
    });

    // --- edit ---

    describe("edit", () => {
      it("edits a post", async () => {
        const { updateMattermostPost } = await import("./mattermost/client.js");

        const result = await mattermostMessageActions.handleAction!({
          action: "edit",
          params: { messageId: "post-1", message: "updated text" },
          cfg: mmCfg(),
          accountId: null,
        });

        expect(updateMattermostPost).toHaveBeenCalledWith(expect.anything(), "post-1", "updated text");
        expect(result).toMatchObject({
          details: { ok: true, messageId: "post-1", message: "edited" },
        });
      });

      it("throws when messageId is missing", async () => {
        await expect(
          mattermostMessageActions.handleAction!({
            action: "edit",
            params: { message: "updated" },
            cfg: mmCfg(),
            accountId: null,
          }),
        ).rejects.toThrow("messageId");
      });

      it("throws when message is missing", async () => {
        await expect(
          mattermostMessageActions.handleAction!({
            action: "edit",
            params: { messageId: "post-1" },
            cfg: mmCfg(),
            accountId: null,
          }),
        ).rejects.toThrow("message");
      });
    });

    // --- delete ---

    describe("delete", () => {
      it("deletes a post", async () => {
        const { deleteMattermostPost } = await import("./mattermost/client.js");

        const result = await mattermostMessageActions.handleAction!({
          action: "delete",
          params: { messageId: "post-1" },
          cfg: mmCfg(),
          accountId: null,
        });

        expect(deleteMattermostPost).toHaveBeenCalledWith(expect.anything(), "post-1");
        expect(result).toMatchObject({ details: { ok: true, messageId: "post-1", deleted: true } });
      });
    });

    // --- pin / unpin ---

    describe("pin", () => {
      it("pins a post", async () => {
        const { pinMattermostPost } = await import("./mattermost/client.js");

        const result = await mattermostMessageActions.handleAction!({
          action: "pin",
          params: { messageId: "post-1" },
          cfg: mmCfg(),
          accountId: null,
        });

        expect(pinMattermostPost).toHaveBeenCalledWith(expect.anything(), "post-1");
        expect(result).toMatchObject({ details: { ok: true, messageId: "post-1", pinned: true } });
      });
    });

    describe("unpin", () => {
      it("unpins a post", async () => {
        const { unpinMattermostPost } = await import("./mattermost/client.js");

        const result = await mattermostMessageActions.handleAction!({
          action: "unpin",
          params: { messageId: "post-1" },
          cfg: mmCfg(),
          accountId: null,
        });

        expect(unpinMattermostPost).toHaveBeenCalledWith(expect.anything(), "post-1");
        expect(result).toMatchObject({ details: { ok: true, messageId: "post-1", unpinned: true } });
      });
    });

    // --- list-pins ---

    describe("list-pins", () => {
      it("lists pinned posts in a channel", async () => {
        const { getPinnedMattermostPosts } = await import("./mattermost/client.js");

        const result = await mattermostMessageActions.handleAction!({
          action: "list-pins",
          params: { to: "ch-1" },
          cfg: mmCfg(),
          accountId: null,
        });

        expect(getPinnedMattermostPosts).toHaveBeenCalledWith(expect.anything(), "ch-1");
        expect(result).toMatchObject({
          details: {
            ok: true,
            channelId: "ch-1",
            pins: [{ id: "pin-1", userId: "u1", message: "pinned msg", createdAt: 2000 }],
          },
        });
      });
    });
  });
});

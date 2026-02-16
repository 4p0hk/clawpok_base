import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import {
  createActionGate,
  jsonResult,
  readNumberParam,
  readReactionParams,
  readStringParam,
  type ChannelMessageActionAdapter,
  type ChannelMessageActionName,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";

import {
  listEnabledMattermostAccounts,
  resolveMattermostAccount,
} from "./mattermost/accounts.js";
import {
  addMattermostReaction,
  createMattermostClient,
  deleteMattermostPost,
  getMattermostChannelPosts,
  getMattermostReactions,
  getPinnedMattermostPosts,
  fetchMattermostMe,
  normalizeMattermostBaseUrl,
  pinMattermostPost,
  removeMattermostReaction,
  unpinMattermostPost,
  updateMattermostPost,
  type MattermostClient,
} from "./mattermost/client.js";
import { sendMessageMattermost } from "./mattermost/send.js";

function resolveClient(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): { client: MattermostClient; accountId: string } {
  const account = resolveMattermostAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  const token = account.botToken?.trim();
  if (!token) {
    throw new Error(
      `Mattermost bot token missing for account "${account.accountId}"`,
    );
  }
  const baseUrl = normalizeMattermostBaseUrl(account.baseUrl);
  if (!baseUrl) {
    throw new Error(
      `Mattermost baseUrl missing for account "${account.accountId}"`,
    );
  }
  const client = createMattermostClient({ baseUrl, botToken: token });
  return { client, accountId: account.accountId };
}

function resolveChannelId(params: Record<string, unknown>): string {
  return readStringParam(params, "channelId") ?? readStringParam(params, "to", { required: true });
}

async function handleMattermostAction(
  ctx: { action: string; params: Record<string, unknown>; cfg: OpenClawConfig; accountId?: string | null },
): Promise<AgentToolResult<unknown>> {
  const { action, params, cfg } = ctx;
  const accountId = ctx.accountId ?? readStringParam(params, "accountId");

  if (action === "send") {
    const to = readStringParam(params, "to", { required: true });
    const message = readStringParam(params, "message", { required: true, allowEmpty: true });
    const mediaUrl = readStringParam(params, "media", { trim: false });
    const replyTo = readStringParam(params, "replyTo");
    const result = await sendMessageMattermost(to, message, {
      accountId: accountId ?? undefined,
      mediaUrl: mediaUrl ?? undefined,
      replyToId: replyTo ?? undefined,
    });
    return jsonResult({ ok: true, ...result });
  }

  if (action === "react") {
    const messageId = readStringParam(params, "messageId", { required: true });
    const { emoji, remove } = readReactionParams(params, {
      removeErrorMessage: "Removing a Mattermost reaction requires an emoji name.",
    });
    const { client } = resolveClient({ cfg, accountId });
    const botUser = await fetchMattermostMe(client);
    if (remove) {
      await removeMattermostReaction(client, {
        userId: botUser.id,
        postId: messageId,
        emojiName: emoji,
      });
      return jsonResult({ ok: true, removed: true, emoji });
    }
    await addMattermostReaction(client, {
      userId: botUser.id,
      postId: messageId,
      emojiName: emoji,
    });
    return jsonResult({ ok: true, added: emoji });
  }

  if (action === "reactions") {
    const messageId = readStringParam(params, "messageId", { required: true });
    const { client } = resolveClient({ cfg, accountId });
    const reactions = await getMattermostReactions(client, messageId);
    return jsonResult({
      ok: true,
      messageId,
      reactions: reactions.map((r) => ({
        userId: r.user_id,
        emoji: r.emoji_name,
        createdAt: r.create_at,
      })),
    });
  }

  if (action === "read") {
    const channelId = resolveChannelId(params);
    const limit = readNumberParam(params, "limit", { integer: true });
    const before = readStringParam(params, "before");
    const after = readStringParam(params, "after");
    const { client } = resolveClient({ cfg, accountId });
    const result = await getMattermostChannelPosts(client, {
      channelId,
      perPage: limit ?? undefined,
      before: before ?? undefined,
      after: after ?? undefined,
    });
    const messages = result.order.map((id) => {
      const post = result.posts[id];
      return {
        id: post?.id,
        userId: post?.user_id,
        message: post?.message,
        createdAt: post?.create_at,
        rootId: post?.root_id || undefined,
        fileIds: post?.file_ids?.length ? post.file_ids : undefined,
      };
    });
    return jsonResult({ ok: true, channelId, messages });
  }

  if (action === "edit") {
    const messageId = readStringParam(params, "messageId", { required: true });
    const message = readStringParam(params, "message", { required: true });
    const { client } = resolveClient({ cfg, accountId });
    const updated = await updateMattermostPost(client, messageId, message);
    return jsonResult({ ok: true, messageId: updated.id, message: updated.message });
  }

  if (action === "delete") {
    const messageId = readStringParam(params, "messageId", { required: true });
    const { client } = resolveClient({ cfg, accountId });
    await deleteMattermostPost(client, messageId);
    return jsonResult({ ok: true, messageId, deleted: true });
  }

  if (action === "pin") {
    const messageId = readStringParam(params, "messageId", { required: true });
    const { client } = resolveClient({ cfg, accountId });
    await pinMattermostPost(client, messageId);
    return jsonResult({ ok: true, messageId, pinned: true });
  }

  if (action === "unpin") {
    const messageId = readStringParam(params, "messageId", { required: true });
    const { client } = resolveClient({ cfg, accountId });
    await unpinMattermostPost(client, messageId);
    return jsonResult({ ok: true, messageId, unpinned: true });
  }

  if (action === "list-pins") {
    const channelId = resolveChannelId(params);
    const { client } = resolveClient({ cfg, accountId });
    const result = await getPinnedMattermostPosts(client, channelId);
    const pins = result.order.map((id) => {
      const post = result.posts[id];
      return {
        id: post?.id,
        userId: post?.user_id,
        message: post?.message,
        createdAt: post?.create_at,
      };
    });
    return jsonResult({ ok: true, channelId, pins });
  }

  throw new Error(`Action ${String(action)} is not supported for Mattermost.`);
}

export const mattermostMessageActions: ChannelMessageActionAdapter = {
  listActions: ({ cfg }) => {
    const accounts = listEnabledMattermostAccounts(cfg).filter(
      (account) => Boolean(account.botToken && account.baseUrl),
    );
    if (accounts.length === 0) {
      return [];
    }
    const mmConfig = cfg.channels?.mattermost as
      | { actions?: Record<string, boolean | undefined> }
      | undefined;
    const gate = createActionGate(mmConfig?.actions);
    const actions = new Set<ChannelMessageActionName>(["send"]);
    if (gate("reactions")) {
      actions.add("react");
      actions.add("reactions");
    }
    if (gate("messages")) {
      actions.add("read");
      actions.add("edit");
      actions.add("delete");
    }
    if (gate("pins")) {
      actions.add("pin");
      actions.add("unpin");
      actions.add("list-pins");
    }
    return Array.from(actions);
  },
  extractToolSend: ({ args }) => {
    const action = typeof args.action === "string" ? args.action.trim() : "";
    if (action === "sendMessage") {
      const to = typeof args.to === "string" ? args.to : undefined;
      return to ? { to } : null;
    }
    return null;
  },
  handleAction: async ({ action, params, cfg, accountId }) => {
    return await handleMattermostAction({ action, params, cfg, accountId });
  },
};

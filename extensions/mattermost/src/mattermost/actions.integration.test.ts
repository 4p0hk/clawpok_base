import { beforeAll, describe, expect, it } from "vitest";
import {
  addMattermostReaction,
  createMattermostClient,
  createMattermostPost,
  deleteMattermostPost,
  fetchMattermostMe,
  getMattermostChannelPosts,
  getMattermostPost,
  getMattermostReactions,
  getPinnedMattermostPosts,
  pinMattermostPost,
  removeMattermostReaction,
  unpinMattermostPost,
  updateMattermostPost,
  type MattermostClient,
} from "./client.js";

const MM_URL = process.env.MM_URL ?? "http://localhost:8065";
const MM_BOT_TOKEN = process.env.MM_BOT_TOKEN ?? "";
const MM_CHANNEL_ID = process.env.MM_CHANNEL_ID ?? "";

const canRun = Boolean(MM_BOT_TOKEN && MM_CHANNEL_ID);

describe.skipIf(!canRun)("mattermost actions integration", () => {
  let client: MattermostClient;
  let botUserId: string;

  beforeAll(async () => {
    client = createMattermostClient({
      baseUrl: MM_URL,
      botToken: MM_BOT_TOKEN,
    });
    const me = await fetchMattermostMe(client);
    botUserId = me.id;
  });

  it("adds and removes a reaction", async () => {
    const post = await createMattermostPost(client, {
      channelId: MM_CHANNEL_ID,
      message: `react-test ${Date.now()}`,
    });

    const reaction = await addMattermostReaction(client, {
      userId: botUserId,
      postId: post.id,
      emojiName: "thumbsup",
    });
    expect(reaction.emoji_name).toBe("thumbsup");
    expect(reaction.post_id).toBe(post.id);

    const reactions = await getMattermostReactions(client, post.id);
    expect(reactions.some((r) => r.emoji_name === "thumbsup")).toBe(true);

    await removeMattermostReaction(client, {
      userId: botUserId,
      postId: post.id,
      emojiName: "thumbsup",
    });

    const afterRemove = await getMattermostReactions(client, post.id);
    // mattermost returns null (not []) when no reactions remain
    expect(afterRemove === null || !afterRemove.some((r) => r.emoji_name === "thumbsup")).toBe(true);
  });

  it("reads channel posts with pagination", async () => {
    const msg1 = await createMattermostPost(client, {
      channelId: MM_CHANNEL_ID,
      message: `read-test-1 ${Date.now()}`,
    });
    const msg2 = await createMattermostPost(client, {
      channelId: MM_CHANNEL_ID,
      message: `read-test-2 ${Date.now()}`,
    });

    const posts = await getMattermostChannelPosts(client, {
      channelId: MM_CHANNEL_ID,
      perPage: 10,
    });

    expect(posts.order).toContain(msg1.id);
    expect(posts.order).toContain(msg2.id);
    // most recent first
    expect(posts.order.indexOf(msg2.id)).toBeLessThan(posts.order.indexOf(msg1.id));
  });

  it("edits a message", async () => {
    const original = `edit-test-original ${Date.now()}`;
    const post = await createMattermostPost(client, {
      channelId: MM_CHANNEL_ID,
      message: original,
    });

    const edited = `edit-test-updated ${Date.now()}`;
    const updated = await updateMattermostPost(client, post.id, edited);
    expect(updated.message).toBe(edited);

    const fetched = await getMattermostPost(client, post.id);
    expect(fetched.message).toBe(edited);
  });

  it("deletes a message", async () => {
    const post = await createMattermostPost(client, {
      channelId: MM_CHANNEL_ID,
      message: `delete-test ${Date.now()}`,
    });

    await deleteMattermostPost(client, post.id);

    // mattermost returns 404 for deleted posts
    await expect(getMattermostPost(client, post.id)).rejects.toThrow("404");
  });

  it("pins and unpins a message", async () => {
    const post = await createMattermostPost(client, {
      channelId: MM_CHANNEL_ID,
      message: `pin-test ${Date.now()}`,
    });

    await pinMattermostPost(client, post.id);

    const pinned = await getPinnedMattermostPosts(client, MM_CHANNEL_ID);
    expect(pinned.order).toContain(post.id);

    await unpinMattermostPost(client, post.id);

    const afterUnpin = await getPinnedMattermostPosts(client, MM_CHANNEL_ID);
    expect(afterUnpin.order).not.toContain(post.id);
  });
});

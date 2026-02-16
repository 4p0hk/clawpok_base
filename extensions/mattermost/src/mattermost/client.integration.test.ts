import { beforeAll, describe, expect, it } from "vitest";
import {
  createMattermostClient,
  createMattermostPost,
  fetchMattermostMe,
  getMattermostChannelPosts,
  getMattermostPost,
  type MattermostClient,
} from "./client.js";

const MM_URL = process.env.MM_URL ?? "http://localhost:8065";
const MM_BOT_TOKEN = process.env.MM_BOT_TOKEN ?? "";
const MM_CHANNEL_ID = process.env.MM_CHANNEL_ID ?? "";

const canRun = Boolean(MM_BOT_TOKEN && MM_CHANNEL_ID);

describe.skipIf(!canRun)("mattermost client integration", () => {
  let client: MattermostClient;

  beforeAll(() => {
    client = createMattermostClient({
      baseUrl: MM_URL,
      botToken: MM_BOT_TOKEN,
    });
  });

  it("authenticates and fetches bot user", async () => {
    const me = await fetchMattermostMe(client);
    expect(me.id).toBeTruthy();
    expect(me.username).toBeTruthy();
  });

  it("sends a message and reads it back", async () => {
    const testMessage = `integration-test ${Date.now()}`;

    const post = await createMattermostPost(client, {
      channelId: MM_CHANNEL_ID,
      message: testMessage,
    });

    expect(post.id).toBeTruthy();
    expect(post.channel_id).toBe(MM_CHANNEL_ID);
    expect(post.message).toBe(testMessage);

    const fetched = await getMattermostPost(client, post.id);
    expect(fetched.id).toBe(post.id);
    expect(fetched.message).toBe(testMessage);
  });

  it("message appears in channel post list", async () => {
    const testMessage = `channel-list-test ${Date.now()}`;

    const post = await createMattermostPost(client, {
      channelId: MM_CHANNEL_ID,
      message: testMessage,
    });

    const channelPosts = await getMattermostChannelPosts(client, {
      channelId: MM_CHANNEL_ID,
      perPage: 5,
    });

    expect(channelPosts.order).toContain(post.id);
    expect(channelPosts.posts[post.id]?.message).toBe(testMessage);
  });
});

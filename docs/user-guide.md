# Using your Etsy shop from Claude or ChatGPT

This guide is for the shop owner. It explains how to connect an AI assistant to your Etsy shop and what it can do. The technical setup lives in the README.

## What it is

A small private server connects your AI assistant to your Etsy shop. Once it's connected, you can ask things like "how's my shop doing?" in a normal chat. More abilities arrive in the next update: managing listings and photos, orders and shipping, prices and stock, and sales numbers.

**Only your Etsy account can use it.** The server checks your Etsy user and shop every time someone connects, and refuses everyone else.

## Connecting

You connect each app once. You need three things from whoever set up the server:

- the server's address, which ends in `/mcp` (for example `https://etsy-shop-mcp.<your-name>.workers.dev/mcp`);
- that app's **client ID** (for example `claude`);
- that app's **client secret**, a long random string. Treat it like a password.

Only apps that were set up on the server can connect, and the server has no sign-up. Connecting opens a sign-in in your browser:

1. Etsy asks you to sign in and allow access. Allow it.
2. You land back in the app, connected.

### Claude (web, desktop and phone)

1. On claude.ai, open **Settings → Connectors** and choose **Add custom connector**.
2. Name it "Etsy shop" and paste the `/mcp` address.
3. Open **Advanced settings** and enter the Claude **OAuth Client ID** and **OAuth Client Secret**. Then add the connector.
4. Press **Connect** and follow the sign-in above.
5. In a chat, turn the connector on from the tools menu.

A connector added on the web also works in the Claude phone app.

### ChatGPT

1. On chatgpt.com, open **Settings → Apps & Connectors**. Custom connectors may need **Developer mode** turned on under **Advanced**.
2. Create a connector, paste the `/mcp` address and choose **OAuth** for authentication.
3. Under the OAuth settings, enter the ChatGPT client ID and client secret yourself. ChatGPT calls this a user-defined OAuth client. If ChatGPT shows a callback URL other than `https://chatgpt.com/connector_platform_oauth_redirect`, send it to whoever set up the server, who must add it first.
4. Save, then follow the sign-in above.

ChatGPT's support for custom connectors depends on your plan, and so does whether they can make changes and whether they work in the phone app. OpenAI's own pages disagree. **Claude is the app that's sure to work**, including on your phone.

> **To be filled in after the first real connection:** which apps and devices worked, on which ChatGPT plan, and anything that needed a workaround.

### If it says "Etsy connection expired"

Etsy sign-ins last up to 90 days without use. If one lapses, the assistant tells you to reconnect. Open the connector's settings in the app and connect again.

## What you can ask today

- **"Give me an overview of my shop."** Your shop's name, active listings, total sales, reviews and whether vacation mode is on. It also shows when Etsy last refreshed your sign-in and when the daily stats snapshot last ran (that snapshot starts with the next update).

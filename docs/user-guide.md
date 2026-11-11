# Using your Etsy shop from Claude or ChatGPT

This guide is for the shop owner. It explains how to connect an AI assistant to your Etsy shop and what it can do. The technical setup lives in the README.

## What it is

A small private server connects your AI assistant to your Etsy shop. Once it's connected, you can ask things like "how's my shop doing?" in a normal chat. More abilities arrive in the next update: managing listings and photos, orders and shipping, prices and stock, and sales numbers.

**Only your Etsy account can use it.** The server checks your Etsy user and shop every time someone connects, and refuses everyone else.

## Connecting

You connect each app once. Each connection opens a sign-in in your browser:

1. A page names the app that wants to connect and where its access goes. Press **Continue to Etsy** only if you just started connecting from that app.
2. Etsy asks you to sign in and allow access. Allow it.
3. You land back in the app, connected.

You need the server's address, which ends in `/mcp` (for example `https://etsy-shop-mcp.<your-name>.workers.dev/mcp`).

### Claude (web, desktop and phone)

1. On claude.ai, open **Settings → Connectors** and choose **Add custom connector**.
2. Name it "Etsy shop", paste the `/mcp` address, and add it.
3. Press **Connect** and follow the sign-in above.
4. In a chat, turn the connector on from the tools menu.

A connector added on the web also works in the Claude phone app.

### ChatGPT

1. On chatgpt.com, open **Settings → Apps & Connectors**. Custom connectors may need **Developer mode** turned on under **Advanced**.
2. Create a connector, paste the `/mcp` address, choose **OAuth** for authentication, and save.
3. Follow the sign-in above.

ChatGPT's support for custom connectors depends on your plan, and so does whether they can make changes and whether they work in the phone app. OpenAI's own pages disagree. **Claude is the app that's sure to work**, including on your phone.

> **To be filled in after the first real connection:** which apps and devices worked, on which ChatGPT plan, and anything that needed a workaround.

### If it says "Etsy connection expired"

Etsy sign-ins last up to 90 days without use. If one lapses, the assistant tells you to reconnect. Open the connector's settings in the app and connect again.

## What you can ask today

- **"Give me an overview of my shop."** Your shop's name, active listings, total sales, reviews and whether vacation mode is on. It also shows when Etsy last refreshed your sign-in and when the daily stats snapshot last ran (that snapshot starts with the next update).

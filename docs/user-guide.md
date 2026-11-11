# Using your Etsy shop from Claude or ChatGPT

This guide is for the shop owner. It explains how to connect an AI assistant to your Etsy shop and what it can do. The technical setup lives in the README.

## What it is

A small private server connects your AI assistant to your Etsy shop. Once it's connected, you can manage listings and photos, prices and stock, and orders and shipping, and see your sales numbers, all in a normal chat.

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

## What you can ask

Talk to it the way you'd talk to an assistant. Some examples:

- **Your shop:** "Give me an overview of my shop." "What shipping profiles do I have?"
- **Listings:** "Show my drafts." "Make a draft listing for a blue ceramic mug, $24.50, three in stock." "Change the mug's title to …" "Add tags: gift, coffee."
- **Photos:** "Add photos to the blue mug." You get a private link (it works for 30 minutes, just for that listing). Open it on your phone, pick or take up to 10 photos, put them in order, tap **Upload**, then tell the assistant you're done. The new photos go after the ones the listing already has. If adding them stops partway, just ask the assistant to try again. Photos that already went through are never added twice.
- **Prices and stock:** "Raise the large size to $30." "I have 5 more green ones." Only what you mention changes.
- **Orders:** "What do I need to ship?" "Show order 1234 with the address." Orders show the buyer's name and country; the address appears only when you ask for it.
- **Numbers:** "How were sales last month?" "Which listings got the most views this week?" "Show my latest reviews."

### Things it checks with you first

Publishing, renewing, deactivating or deleting a listing, removing a photo, and marking an order shipped all cost money or can't be undone. For those, the assistant first shows you exactly what will happen (including Etsy's listing fee, currently $0.20, when there is one) and asks. Nothing changes until you say yes. Everything else, like editing a draft or changing a price, happens straight away.

## What the numbers can't show

Etsy doesn't share everything its Stats page shows. Through this connection there are **no visits, no search terms and no conversion rate**. What you do get:

- **Views:** each listing's lifetime views, which Etsy updates once a day. The server saves them every morning, so "views this week" works once it has a few days of history.
- **Favorites** per listing, **reviews**, and **sales**: item sales (after coupons, without tax or shipping), shipping and refunds, number of orders and best sellers for any date range. Etsy's fees aren't taken off, so this is what buyers paid her, not what she kept.

## First run checklist

After setting it up, try each of these once and note anything that doesn't work:

1. Make a draft listing.
2. Add two photos to it through the upload link.
3. Change one price on an existing listing.
4. Publish the draft (it asks you to confirm first).
5. Ask what you need to ship today.
6. The next day, ask for the shop overview and check that the daily snapshot ran.

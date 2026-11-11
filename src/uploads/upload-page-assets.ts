// The upload page's only script and stylesheet. The CSP allows exactly these two by
// hash, so nothing else can run or style the page. The script reads the token from the
// URL fragment, clears it from the address bar, shrinks each photo to at most 3000 px
// (re-encoding as JPEG, which also turns iPhone HEIC photos into JPEG), and sends them
// one per request, in her order, with the token in a header.
export const UPLOAD_SCRIPT = `"use strict";
const token = new URLSearchParams(location.hash.slice(1)).get("t") || "";
history.replaceState(null, "", location.pathname);
const MAX = 10, SIDE = 3000;
const pick = document.getElementById("pick"), list = document.getElementById("list");
const send = document.getElementById("send"), status = document.getElementById("status");
let items = [], busy = false;
function button(text, label, onClick, disabled) {
  const b = document.createElement("button");
  b.type = "button"; b.textContent = text; b.setAttribute("aria-label", label);
  b.disabled = disabled || busy; b.addEventListener("click", onClick); return b;
}
function move(i, d) { const [it] = items.splice(i, 1); items.splice(i + d, 0, it); render(); }
function render() {
  list.replaceChildren(...items.map((item, i) => {
    const li = document.createElement("li"), img = document.createElement("img"), note = document.createElement("span");
    img.src = item.url; img.alt = "";
    note.textContent = "Photo " + (i + 1) + (item.state ? " - " + item.state : "");
    li.append(img, note, button("\\u2191", "Move up", () => move(i, -1), i === 0),
      button("\\u2193", "Move down", () => move(i, 1), i === items.length - 1),
      button("\\u2715", "Remove", () => { URL.revokeObjectURL(item.url); items.splice(i, 1); render(); }, false));
    return li;
  }));
  send.disabled = busy || items.length === 0 || token === "";
}
pick.addEventListener("change", () => {
  for (const file of pick.files) { if (items.length < MAX) items.push({ file, url: URL.createObjectURL(file), state: "" }); }
  pick.value = "";
  status.textContent = items.length >= MAX ? "That's the most for one upload (10)." : "";
  render();
});
async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode"))), "image/jpeg", 0.9));
}
send.addEventListener("click", async () => {
  busy = true; render();
  let failed = 0;
  for (const [i, item] of items.entries()) {
    item.state = "uploading"; render();
    try {
      const response = await fetch("/upload/image", { method: "POST", body: await shrink(item.file),
        headers: { authorization: "Upload " + token, "content-type": "image/jpeg", "x-photo-rank": String(i) } });
      item.state = response.ok ? "done" : "failed: " + (await response.text());
      if (!response.ok) failed += 1;
    } catch { item.state = "failed"; failed += 1; }
    render();
  }
  busy = false; render();
  status.textContent = failed === 0 ? "All uploaded. Go back to the chat and say you're done."
    : "Some photos didn't upload. Tap Upload to try again.";
});
if (token === "") status.textContent = "This link is incomplete. Ask the assistant for a new upload link.";
render();
`;

export const UPLOAD_STYLE = `body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:16px;max-width:640px}
h1{font-size:1.4rem}ol{list-style:none;padding:0}li{display:flex;align-items:center;gap:8px;margin:8px 0}
img{width:64px;height:64px;object-fit:cover;border-radius:6px}li span{flex:1}
button,.pick{font:inherit;padding:10px 14px;border-radius:8px;border:1px solid #888;background:#fff}
#send{width:100%;background:#222;color:#fff}#send:disabled{opacity:.5}
.pick{display:inline-block}.pick input{display:block;margin-top:8px}`;

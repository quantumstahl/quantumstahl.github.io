// ---------- Firebase imports ----------
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";

import {
  getFirestore,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  signInWithPopup,
  getRedirectResult,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

// ---------- Config ----------
const firebaseConfig = {
  apiKey: "AIzaSyABkVGems0dMpPJHU1ZD8DC8MEff93NAIE",
  authDomain: "ibc-lager.firebaseapp.com",
  projectId: "ibc-lager",
  storageBucket: "ibc-lager.firebasestorage.app",
  messagingSenderId: "998447660944",
  appId: "1:998447660944:web:19312163b4a5749a0afd15",
};

const companyId = "company1";
const COLLECTION = "IBC-lager";

// WebP settings
const MAIN_MAX = 1024;
const THUMB_SIZE = 128;
const WEBP_QUALITY_MAIN = 0.82;
const WEBP_QUALITY_THUMB = 0.75;

// ---------- Init ----------
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// ---------- DOM ----------
const el = {
  loginBtn: document.getElementById("loginBtn"),
  authStatus: document.getElementById("authStatus"),

  imageInput: document.getElementById("imageInput"),
  preview: document.getElementById("preview"),

  name: document.getElementById("name"),
  lotNo: document.getElementById("lotNo"),
  locationId: document.getElementById("locationId"),
  qty: document.getElementById("qty"),
  saveBtn: document.getElementById("saveBtn"),

  status: document.getElementById("status"),

  search: document.getElementById("search"),
  list: document.getElementById("list"),

  imageModal: document.getElementById("imageModal"),
  modalImg: document.getElementById("modalImg"),
  logoutBtn: document.getElementById("logoutBtn"),
  printBtn:document.getElementById("printBtn")
};

el.logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

function setStatus(t) {
  el.status.textContent = t || "";
}

// ---------- State ----------
let currentRows = [];
let searchTimer = null;

// ---------- Auth ----------
el.loginBtn.addEventListener("click", async () => {
  try {
    el.authStatus.textContent = "Loggar in (popup)...";
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.warn("Popup misslyckades, testar redirect:", e);
    el.authStatus.textContent = "Loggar in (redirect)...";
    await signInWithRedirect(auth, provider);
  }
});

getRedirectResult(auth)
  .then((res) => {
    if (res?.user) console.log("Redirect login OK:", res.user.email);
  })
  .catch((e) => {
    console.error("RedirectResult error:", e);
    el.authStatus.textContent = "Redirect-fel: " + (e?.message ?? e);
  });

onAuthStateChanged(auth, async (user) => {
  el.authStatus.textContent = user ? `Inloggad: ${user.email}` : "Inte inloggad";
  el.loginBtn.style.display = user ? "none" : "inline-block";
  el.logoutBtn.style.display = user ? "inline-block" : "none";
  if (user) {
    setStatus("Laddar lista...");
    await loadList();
    setStatus("");
  } else {
    el.list.innerHTML = "";
  }
});

// ---------- Preview ----------
el.imageInput.addEventListener("change", () => {
  const file = el.imageInput.files?.[0];
  if (!file) return;

  el.preview.src = URL.createObjectURL(file);
  el.preview.style.display = "block";
});

// ---------- Save (create/update lot) ----------
el.saveBtn.addEventListener("click", async () => {
  try {
    if (!auth.currentUser) {
      alert("Logga in först.");
      return;
    }

    const file = el.imageInput.files?.[0] ?? null;
    const name = el.name.value.trim();
    const lotNo = el.lotNo.value.trim();
    const locationId = el.locationId.value.trim();
    const qty = Number(el.qty.value);

    if (!name || !lotNo || !locationId || Number.isNaN(qty)) {
      alert("Fyll i namn, lotnummer, lagerplats och antal.");
      return;
    }

    setStatus(file ? "Skapar WebP..." : "Sparar...");

    let imageUrl = null;
    let thumbUrl = null;

    if (file) {
      const mainBlob = await makeMainWebP(file, MAIN_MAX);
      const thumbBlob = await makeThumbWebP(file, THUMB_SIZE);

      const mainPath = `companies/${companyId}/items/${lotNo}/main.webp`;
      const thumbPath = `companies/${companyId}/items/${lotNo}/thumb.webp`;

      const mainRef = storageRef(storage, mainPath);
      const thumbRef = storageRef(storage, thumbPath);

      setStatus("Laddar upp bilder...");

      await uploadBytes(mainRef, mainBlob, { contentType: "image/webp" });
      await uploadBytes(thumbRef, thumbBlob, { contentType: "image/webp" });

      imageUrl = await getDownloadURL(mainRef);
      thumbUrl = await getDownloadURL(thumbRef);
    }

    setStatus("Sparar artikel...");

    await saveLot({
      namn: name,
      lotnummer: lotNo,
      lager: locationId,
      antal: qty,
      imageUrl,
      thumbUrl,
    });

    setStatus("✅ Klart!");
    await loadList();
    resetForm({ keepLocation: true });
  } catch (err) {
    console.error(err);
    setStatus("❌ Fel: " + (err?.message ?? err));
  }
});

// ---------- Search (local filter, debounced) ----------
el.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => renderList(currentRows), 150);
});

// ---------- Lightbox ----------
function openImage(url) {
  if (!url) return;
  el.modalImg.src = url;
  el.imageModal.style.display = "flex";
}

function closeImage() {
  el.imageModal.style.display = "none";
  el.modalImg.src = "";
}

el.imageModal.addEventListener("click", closeImage);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeImage();
});

// ---------- Firestore ops ----------
async function saveLot({ namn, lotnummer, lager, antal, imageUrl, thumbUrl }) {
  const Namn = (namn ?? "").trim();
  const Lotnummer = String(lotnummer ?? "").trim();
  const Lager = (lager ?? "").trim();
  const Antal = Number(antal);

  if (!Namn || !Lotnummer || !Lager || Number.isNaN(Antal)) {
    throw new Error("Fyll i Namn, Lotnummer, Lager och Antal.");
  }

  const data = {
    Namn,
    Lotnummer,
    Lager,
    Antal,
    updatedAt: serverTimestamp(),
  };
  if (imageUrl) data.imageUrl = imageUrl;
  if (thumbUrl) data.thumbUrl = thumbUrl;

  await setDoc(doc(db, COLLECTION, Lotnummer), data, { merge: true });
}

async function setQty(docId, value) {
  const qty = Number(value);
  if (!Number.isFinite(qty) || qty < 0) {
    alert("Antal måste vara ett tal (0 eller mer).");
    return;
  }

  setStatus("Sparar antal...");
  await updateDoc(doc(db, COLLECTION, docId), {
    Antal: qty,
    updatedAt: serverTimestamp(),
  });
  setStatus("");
  await loadList();
}

async function deleteLotAndImage(docId) {
  const row = currentRows.find((r) => r.id === docId);
  const label = row ? `${row.Namn} (Lot ${row.Lotnummer ?? docId})` : docId;

  if (!confirm(`Ta bort ${label}?\n\nDetta raderar även bilden.`)) return;

  setStatus("Tar bort...");

  const mainWebp = `companies/${companyId}/items/${docId}/main.webp`;
  const thumbWebp = `companies/${companyId}/items/${docId}/thumb.webp`;

  for (const p of [mainWebp, thumbWebp]) {
    try {
      await deleteObject(storageRef(storage, p));
    } catch (e) {
      console.warn("Ignorerar bild-delete-fel:", p, e?.code || e);
    }
  }

  await deleteDoc(doc(db, COLLECTION, docId));
  setStatus("");
  await loadList();
}

// ---------- List loading + rendering ----------
async function loadList() {
  const snap = await getDocs(query(collection(db, COLLECTION), orderBy("Lotnummer", "asc")));
  const rows = [];
  snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));

  // Naturlig sort (om Lotnummer ibland är tomt eller blandat)
  currentRows = sortByLotnummer(rows);
  renderList(currentRows);
}

function renderList(rows) {
  const term = (el.search.value || "").toLowerCase().trim();

  const filtered = term
    ? rows.filter((r) => {
        const namn = String(r.Namn || "").toLowerCase();
        const lot = String(r.Lotnummer || r.id || "").toLowerCase();
        const lag = String(r.Lager || "").toLowerCase();
        return namn.includes(term) || lot.includes(term) || lag.includes(term);
      })
    : rows;

  el.list.innerHTML = filtered
    .map((r) => {
      const thumb = r.thumbUrl || r.imageUrl || "";
      const full = r.imageUrl || r.thumbUrl || "";

      return `
  <div class="rowItem" data-id="${escapeHtml(r.id)}">
    ${
      thumb
        ? `<img class="thumbImg"
               loading="lazy"
               decoding="async"
               src="${thumb}"
               data-full="${encodeURIComponent(full)}" />`
        : ``
    }

    <div class="rowMain">
      <div class="rowTitle">${escapeHtml(r.Namn ?? "")}</div>
      <div class="rowMeta">Lot: ${escapeHtml(r.Lotnummer ?? r.id)} · Lager: ${escapeHtml(r.Lager ?? "")}</div>
    </div>

    <div class="rowRight">
      <div class="qtyRow">
        <input class="qtyInput" data-id="${escapeHtml(r.id)}" type="number" step="1" min="0"
               value="${Number.isFinite(r.Antal) ? r.Antal : 0}">
        <button class="btn smallBtn qtySave" data-id="${escapeHtml(r.id)}">Spara</button>
      </div>
      <button class="btn delBtn" data-id="${escapeHtml(r.id)}">🗑️ Ta bort</button>
    </div>
  </div>
`;
    })
    .join("");

  // Bind events (no inline handlers)
  el.list.querySelectorAll(".thumbImg").forEach((img) => {
    img.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const full = decodeURIComponent(img.dataset.full || "");
      openImage(full);
    });
  });

  el.list.querySelectorAll(".qtySave").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const id = btn.dataset.id;
      const input = el.list.querySelector(`.qtyInput[data-id="${cssEscape(id)}"]`);
      await setQty(id, input?.value);
    });
  });

  el.list.querySelectorAll(".qtyInput").forEach((inp) => {
    inp.addEventListener("keydown", async (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        ev.stopPropagation();
        await setQty(inp.dataset.id, inp.value);
      }
    });
  });

  el.list.querySelectorAll(".delBtn").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await deleteLotAndImage(btn.dataset.id);
    });
  });
}

// ---------- Utils ----------
function sortByLotnummer(rows) {
  const collator = new Intl.Collator("sv", { numeric: true, sensitivity: "base" });
  return rows.sort((a, b) =>
    collator.compare(String(a.Lotnummer ?? a.id), String(b.Lotnummer ?? b.id))
  );
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// CSS.escape finns inte i alla äldre webviews – fallback
function cssEscape(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/["\\]/g, "\\$&");
}
function resetForm({ keepLocation = true } = {}) {
  el.name.value = "";
  el.lotNo.value = "";
  if (!keepLocation) el.locationId.value = "";
  el.qty.value = "0";

  // Rensa fil + preview
  el.imageInput.value = "";
  el.preview.src = "";
  el.preview.style.display = "none";

  // Fokus för snabb inmatning
  el.name.focus();
}

// ---------- WebP helpers ----------
async function fileToImageBitmap(file) {
  if ("createImageBitmap" in window) return await createImageBitmap(file);
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  return img;
}

function canvasToWebPBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Kunde inte skapa WebP blob."));
        else resolve(blob);
      },
      "image/webp",
      quality
    );
  });
}

async function makeMainWebP(file, maxSize = MAIN_MAX) {
  const img = await fileToImageBitmap(file);
  const w = img.width,
    h = img.height;

  const scale = Math.min(1, maxSize / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, outW, outH);

  return await canvasToWebPBlob(canvas, WEBP_QUALITY_MAIN);
}

async function makeThumbWebP(file, size = THUMB_SIZE) {
  const img = await fileToImageBitmap(file);
  const w = img.width,
    h = img.height;

  const scale = Math.max(size / w, size / h);
  const drawW = Math.round(w * scale);
  const drawH = Math.round(h * scale);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  const dx = Math.round((size - drawW) / 2);
  const dy = Math.round((size - drawH) / 2);

  ctx.drawImage(img, dx, dy, drawW, drawH);

  return await canvasToWebPBlob(canvas, WEBP_QUALITY_THUMB);
}
el.printBtn.addEventListener("click", () => {
  try {
    buildPrintAreaAndPrint();   // synkront
  } catch (e) {
    console.error(e);
    alert("Kunde inte skriva ut.");
  }
});
//----print----------
function buildPrintAreaAndPrint() {
  const term = (el.search.value || "").toLowerCase().trim();

  const rows = currentRows.filter(r =>
    String(r.Namn || "").toLowerCase().includes(term) ||
    String(r.Lotnummer || "").toLowerCase().includes(term) ||
    String(r.Lager || "").toLowerCase().includes(term)
  );

  if (!rows.length) {
    alert("Inget att skriva ut.");
    return;
  }

  const title = term ? `Lagerlista – filter: "${term}"` : "Lagerlista";
  const now = new Date().toLocaleString("sv-SE");

  const printArea = document.getElementById("printArea");

  // Flagga för att slå av tunga effekter innan print (snabbar upp)
  document.body.classList.add("isPrinting");

  printArea.innerHTML = `
    <div class="printWrap">
      <h1>${escapeHtml(title)}</h1>
      <div class="printMeta">${escapeHtml(now)}</div>

      <table>
        <thead>
          <tr><th>Namn</th><th>Lotnummer</th><th>Lager</th><th>Antal</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${escapeHtml(r.Namn ?? "")}</td>
              <td>${escapeHtml(r.Lotnummer ?? r.id)}</td>
              <td>${escapeHtml(r.Lager ?? "")}</td>
              <td>${Number.isFinite(r.Antal) ? r.Antal : ""}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  // tvinga layout (synkront)
  void printArea.offsetHeight;

  // VIKTIGT: inga await / setTimeout här
  window.print();
}
window.addEventListener("afterprint", () => {
  document.body.classList.remove("isPrinting");
  const printArea = document.getElementById("printArea");
  if (printArea) printArea.innerHTML = "";
});

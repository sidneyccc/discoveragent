const CSV_FILE = "canadian_non_bank_locations_reviewed.csv";
const GEOCODE_CACHE_KEY = "vendor-location-geocode-v1";

const PROVINCE_CENTERS = {
  ON: { lat: 50.0, lng: -85.0 },
  QC: { lat: 52.0, lng: -71.5 },
  BC: { lat: 53.7, lng: -125.0 },
  AB: { lat: 54.5, lng: -114.5 },
  MB: { lat: 53.7, lng: -98.8 },
  SK: { lat: 53.9, lng: -106.0 },
  NS: { lat: 45.0, lng: -63.6 },
  NB: { lat: 46.7, lng: -66.4 },
  NL: { lat: 53.3, lng: -60.3 },
  PE: { lat: 46.3, lng: -63.1 },
};

const CITY_CENTERS = {
  toronto: { lat: 43.6532, lng: -79.3832 },
  scarborough: { lat: 43.7764, lng: -79.2318 },
  "north york": { lat: 43.7615, lng: -79.4111 },
  markham: { lat: 43.8561, lng: -79.3370 },
  "richmond hill": { lat: 43.8828, lng: -79.4403 },
  vaughan: { lat: 43.8361, lng: -79.4983 },
  mississauga: { lat: 43.5890, lng: -79.6441 },
  woodbridge: { lat: 43.7860, lng: -79.5927 },
  thornhill: { lat: 43.8032, lng: -79.4020 },
  aurora: { lat: 44.0065, lng: -79.4504 },
  concord: { lat: 43.7960, lng: -79.5273 },
  unionville: { lat: 43.8622, lng: -79.3051 },
  bramton: { lat: 43.7315, lng: -79.7624 },
  brampton: { lat: 43.7315, lng: -79.7624 },
  ottawa: { lat: 45.4215, lng: -75.6972 },
  york: { lat: 43.6896, lng: -79.4792 },
  montreal: { lat: 45.5019, lng: -73.5674 },
  lasalle: { lat: 45.4307, lng: -73.6318 },
  calgary: { lat: 51.0447, lng: -114.0719 },
  burnaby: { lat: 49.2488, lng: -122.9805 },
  richmond: { lat: 49.1666, lng: -123.1336 },
  vancouver: { lat: 49.2827, lng: -123.1207 },
  "north vancouver": { lat: 49.3200, lng: -123.0724 },
  "st john's": { lat: 47.5615, lng: -52.7126 },
};

const map = L.map("map").setView([56.1304, -106.3468], 4);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const searchInput = document.getElementById("searchInput");
const geocodeBtn = document.getElementById("geocodeBtn");
const clearCacheBtn = document.getElementById("clearCacheBtn");
const summary = document.getElementById("summary");
const vendorList = document.getElementById("vendorList");

const markerLayer = L.layerGroup().addTo(map);
let markerById = new Map();
let vendors = [];
let filteredVendors = [];
let geocodeCache = loadGeocodeCache();

function parseCSV(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      row.push(current);
      current = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") {
        i += 1;
      }
      row.push(current);
      current = "";
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
    } else {
      current += ch;
    }
  }

  if (current.length || row.length) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function loadGeocodeCache() {
  try {
    return JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || "{}");
  } catch (_err) {
    return {};
  }
}

function saveGeocodeCache() {
  localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(geocodeCache));
}

function formatMoney(raw) {
  const numeric = Number(String(raw).replace(/,/g, ""));
  if (Number.isNaN(numeric)) {
    return raw;
  }
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 2,
  }).format(numeric);
}

function normalizeAddress(address) {
  return address.trim().replace(/\s+/g, " ").toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deriveApproxCoords(address) {
  const text = (address || "").toLowerCase();

  const cityKeys = Object.keys(CITY_CENTERS).sort((a, b) => b.length - a.length);
  for (const city of cityKeys) {
    if (text.includes(city)) {
      return { ...CITY_CENTERS[city], source: "approx-city" };
    }
  }

  const match = text.match(/\b(on|qc|bc|ab|mb|sk|ns|nb|nl|pe)\b/i);
  if (match) {
    const province = match[1].toUpperCase();
    if (PROVINCE_CENTERS[province]) {
      return { ...PROVINCE_CENTERS[province], source: "approx-province" };
    }
  }

  return null;
}

async function geocodeAddress(address) {
  const encoded = encodeURIComponent(address);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ca&q=${encoded}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Geocode failed: ${res.status}`);
  }

  const data = await res.json();
  if (!data.length) {
    return null;
  }

  return {
    lat: Number(data[0].lat),
    lng: Number(data[0].lon),
  };
}

function updateSummary(extra = "") {
  const exactCount = vendors.filter((vendor) => vendor.coordsSource === "geocoded").length;
  const approxCount = vendors.filter((vendor) => vendor.coordsSource && vendor.coordsSource !== "geocoded").length;
  const shownCount = filteredVendors.length;
  const totalCount = vendors.length;
  summary.textContent = `Showing ${shownCount}/${totalCount}. Exact: ${exactCount}. Approx: ${approxCount}. ${extra}`.trim();
}

function setActiveInList(vendorId) {
  vendorList.querySelectorAll(".vendor-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.id === String(vendorId));
  });
}

function renderList() {
  vendorList.innerHTML = "";

  if (!filteredVendors.length) {
    const item = document.createElement("li");
    item.className = "vendor-item";
    item.textContent = "No vendors match your search.";
    vendorList.appendChild(item);
    return;
  }

  filteredVendors.forEach((vendor) => {
    const item = document.createElement("li");
    item.className = "vendor-item";
    item.dataset.id = String(vendor.id);

    item.innerHTML = `
      <div class="vendor-name">${vendor.vendor_name}</div>
      <div class="vendor-meta">${vendor.address}</div>
      <div class="vendor-meta">Account: ${vendor.account_number || "-"}</div>
      <div class="vendor-amount">Claim: ${formatMoney(vendor.claim_amount)}</div>
      <div class="vendor-meta">${vendor.coordsSource === "geocoded" ? "Mapped (exact)" : vendor.coords ? "Mapped (approx)" : "Not mapped yet"}</div>
    `;

    item.addEventListener("click", () => {
      const marker = markerById.get(vendor.id);
      if (marker && vendor.coords) {
        map.flyTo([vendor.coords.lat, vendor.coords.lng], 12, { duration: 0.7 });
        marker.openPopup();
        setActiveInList(vendor.id);
      }
    });

    vendorList.appendChild(item);
  });
}

function renderMarkers() {
  markerLayer.clearLayers();
  markerById = new Map();

  const bounds = [];
  filteredVendors.forEach((vendor) => {
    if (!vendor.coords) {
      return;
    }

    const marker = L.marker([vendor.coords.lat, vendor.coords.lng]).addTo(markerLayer);
    marker.bindPopup(`
      <strong>${vendor.vendor_name}</strong><br />
      ${vendor.address}<br />
      Account: ${vendor.account_number || "-"}<br />
      Claim: ${formatMoney(vendor.claim_amount)}
    `);
    marker.on("click", () => setActiveInList(vendor.id));
    markerById.set(vendor.id, marker);
    bounds.push([vendor.coords.lat, vendor.coords.lng]);
  });

  if (bounds.length) {
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12 });
  }
}

function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  filteredVendors = vendors.filter((vendor) => {
    return (
      !query ||
      vendor.vendor_name.toLowerCase().includes(query) ||
      vendor.address.toLowerCase().includes(query) ||
      vendor.claim_amount.toLowerCase().includes(query)
    );
  });

  renderMarkers();
  renderList();
  updateSummary();
}

async function geocodeMissing() {
  geocodeBtn.disabled = true;

  const pending = filteredVendors.filter((vendor) => vendor.coordsSource !== "geocoded");
  if (!pending.length) {
    updateSummary("No missing locations in current view.");
    geocodeBtn.disabled = false;
    return;
  }

  let done = 0;
  let failures = 0;

  for (const vendor of pending) {
    const key = normalizeAddress(vendor.address);

    try {
      if (!geocodeCache[key]) {
        const coords = await geocodeAddress(vendor.address);
        if (coords) {
          geocodeCache[key] = coords;
          saveGeocodeCache();
        } else {
          failures += 1;
        }
        await sleep(1100);
      }

      if (geocodeCache[key]) {
        vendor.coords = geocodeCache[key];
        vendor.coordsSource = "geocoded";
      }
    } catch (_err) {
      failures += 1;
      await sleep(1200);
    }

    done += 1;
    updateSummary(`Geocoding ${done}/${pending.length}... Failures: ${failures}`);
    renderMarkers();
    renderList();
  }

  geocodeBtn.disabled = false;
  updateSummary(`Geocoding complete. Failures: ${failures}`);
}

function clearCache() {
  geocodeCache = {};
  saveGeocodeCache();
  vendors.forEach((vendor) => {
    vendor.coords = deriveApproxCoords(vendor.address);
    vendor.coordsSource = vendor.coords ? vendor.coords.source : null;
  });
  applyFilters();
  updateSummary("Cache cleared.");
}

async function loadVendors() {
  try {
    const res = await fetch(CSV_FILE);
    if (!res.ok) {
      throw new Error(`Failed to load ${CSV_FILE}`);
    }

    const text = await res.text();
    const parsed = parseCSV(text);
    const [header, ...records] = parsed;

    const indexMap = {
      vendor_name: header.indexOf("vendor_name"),
      address: header.indexOf("address"),
      account_number: header.indexOf("account_number"),
      claim_amount: header.indexOf("claim_amount"),
    };

    vendors = records
      .filter((row) => row.length > 1)
      .map((row, idx) => {
        const address = row[indexMap.address] || "";
        const cacheKey = normalizeAddress(address);
        const cached = geocodeCache[cacheKey] || null;
        const approx = deriveApproxCoords(address);
        const coords = cached || approx;
        return {
          id: idx + 1,
          vendor_name: row[indexMap.vendor_name] || "",
          address,
          account_number: row[indexMap.account_number] || "",
          claim_amount: row[indexMap.claim_amount] || "",
          coords,
          coordsSource: cached ? "geocoded" : coords ? coords.source : null,
        };
      });

    applyFilters();
  } catch (err) {
    summary.textContent = `Load error: ${err.message}`;
  }
}

searchInput.addEventListener("input", applyFilters);
geocodeBtn.addEventListener("click", geocodeMissing);
clearCacheBtn.addEventListener("click", clearCache);

loadVendors();

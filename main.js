// --- CONFIGURATION ---
proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

const map = L.map('map', { doubleClickZoom: false }).setView([42.7905, 0.5912], 14);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20 }).addTo(map);

let mntStore = [];
let drawStore = [];
let currentPoints = [];
let tempLine = null;
let chartInstance = null;
let cursorMarker = null;

// ==========================================
// 1. GESTION DES FICHIERS MNT
// ==========================================
document.getElementById('file-input').onchange = async (e) => {
    for (const file of e.target.files) {
        if (!file.name.match(/\.(tif|tiff)$/i)) continue;
        
        const buffer = await file.arrayBuffer();
        const tiff = await GeoTIFF.fromArrayBuffer(buffer);
        const image = await tiff.getImage();
        const bbox = image.getBoundingBox();
        const raster = await image.readRasters();
        
        // Affichage du rectangle sur la carte
        const sw = proj4("EPSG:2154", "EPSG:4326", [bbox[0], bbox[1]]);
        const ne = proj4("EPSG:2154", "EPSG:4326", [bbox[2], bbox[3]]);
        const visual = L.rectangle([[sw[1], sw[0]], [ne[1], ne[0]]], { color: "#00d1b2", weight: 2, fillOpacity: 0.15 }).addTo(map);

        const id = Date.now() + Math.random();
        mntStore.push({ id, name: file.name, bbox, width: image.getWidth(), height: image.getHeight(), data: raster[0], visual, visible: true });
        
        map.fitBounds(visual.getBounds());
    }
    updateMntUI();
};

function updateMntUI() {
    const list = document.getElementById('mnt-list');
    list.innerHTML = '';
    mntStore.forEach(m => {
        list.innerHTML += `
        <div class="card">
            <div class="card-header">
                <div>
                    <input type="checkbox" ${m.visible ? 'checked' : ''} onchange="toggleMNT(${m.id})">
                    <span title="${m.name}">${m.name.length > 20 ? m.name.substring(0,18)+'...' : m.name}</span>
                </div>
                <button class="btn-del" onclick="deleteMNT(${m.id})">✕</button>
            </div>
        </div>`;
    });
}

window.toggleMNT = (id) => {
    const m = mntStore.find(x => x.id === id);
    m.visible = !m.visible;
    if (m.visible) m.visual.addTo(map); else map.removeLayer(m.visual);
};

window.deleteMNT = (id) => {
    const m = mntStore.find(x => x.id === id);
    map.removeLayer(m.visual);
    mntStore = mntStore.filter(x => x.id !== id);
    updateMntUI();
};

// --- EXTRACTION ALTITUDE ---
function getZ(l93) {
    for (let m of mntStore) {
        if (!m.visible) continue;
        if (l93[0] >= m.bbox[0] && l93[0] <= m.bbox[2] && l93[1] >= m.bbox[1] && l93[1] <= m.bbox[3]) {
            const px = Math.floor(((l93[0] - m.bbox[0]) / (m.bbox[2] - m.bbox[0])) * m.width);
            const py = Math.floor(((m.bbox[3] - l93[1]) / (m.bbox[3] - m.bbox[1])) * m.height);
            const val = m.data[py * m.width + px];
            if (val > -1000) return val;
        }
    } return null;
}

// ==========================================
// 2. OUTIL DE TRACÉ (2 POINTS STRICTS)
// ==========================================
window.startLineTool = () => {
    currentPoints = [];
    if (tempLine) map.removeLayer(tempLine);
    
    map.off('click').on('click', (e) => {
        currentPoints.push(e.latlng);
        
        if (tempLine) map.removeLayer(tempLine);
        tempLine = L.polyline(currentPoints, { color: '#f1c40f', weight: 5 }).addTo(map);

        // Si 2 points atteints, on finalise
        if (currentPoints.length === 2) {
            map.off('click');
            saveAndCalculateDraw();
        }
    });
};

function saveAndCalculateDraw() {
    const id = Date.now();
    const l93Pts = currentPoints.map(p => proj4("EPSG:4326", "EPSG:2154", [p.lng, p.lat]));
    
    // Calculs : Longueur, Pente, Delta Z
    const dist = Math.sqrt(Math.pow(l93Pts[1][0]-l93Pts[0][0], 2) + Math.pow(l93Pts[1][1]-l93Pts[0][1], 2));
    const z1 = getZ(l93Pts[0]) || 0;
    const z2 = getZ(l93Pts[1]) || 0;
    const dz = Math.abs(z2 - z1);
    const pente = dist > 0 ? (dz / dist * 100).toFixed(1) : 0;

    const finalLine = L.polyline(currentPoints, { color: '#f1c40f', weight: 5 }).addTo(map);
    map.removeLayer(tempLine);
    tempLine = null;

    drawStore.push({ id, layer: finalLine, ptsGPS: [...currentPoints], ptsL93: l93Pts, dist, dz, pente, visible: true, color: '#f1c40f' });
    
    updateDrawUI();
    generateProfile(l93Pts, dist);
}

// ==========================================
// 3. GESTION DES TRACÉS (Droite)
// ==========================================
function updateDrawUI() {
    const list = document.getElementById('measure-list');
    list.innerHTML = '';
    drawStore.forEach(d => {
        list.innerHTML += `
        <div class="card" style="border-left-color: ${d.color}">
            <div class="card-header">
                <div>
                    <input type="checkbox" ${d.visible ? 'checked' : ''} onchange="toggleDraw(${d.id})">
                    <input type="color" class="color-picker" value="${d.color}" onchange="changeColor(${d.id}, this.value)">
                    <strong>Ligne</strong>
                </div>
                <button class="btn-del" onclick="deleteDraw(${d.id})">✕</button>
            </div>
            <div>
                L: <b>${d.dist.toFixed(2)} m</b> | Pente: <b>${d.pente}%</b><br>
                ΔZ: <b>${d.dz.toFixed(2)} m</b>
            </div>
            <button onclick="generateProfileById(${d.id})" style="width:100%; margin-top:5px; font-size:0.8em; cursor:pointer;">Revoir le profil</button>
        </div>`;
    });
}

window.toggleDraw = (id) => {
    const d = drawStore.find(x => x.id === id);
    d.visible = !d.visible;
    if (d.visible) d.layer.addTo(map); else map.removeLayer(d.layer);
};

window.changeColor = (id, color) => {
    const d = drawStore.find(x => x.id === id);
    d.color = color;
    d.layer.setStyle({ color: color });
    updateDrawUI();
};

window.deleteDraw = (id) => {
    const d = drawStore.find(x => x.id === id);
    map.removeLayer(d.layer);
    drawStore = drawStore.filter(x => x.id !== id);
    updateDrawUI();
    document.getElementById('profile-window').style.display = 'none';
};

window.generateProfileById = (id) => {
    const d = drawStore.find(x => x.id === id);
    generateProfile(d.ptsL93, d.dist);
};

// ==========================================
// 4. PROFIL ALTIMÉTRIQUE & CURSEUR
// ==========================================
function generateProfile(l93Pts, totalDist) {
    document.getElementById('profile-window').style.display = 'block';
    const ctx = document.getElementById('profileChart').getContext('2d');
    
    let chartData = [];
    let geoRef = [];
    const pointsCount = 100;

    for (let i = 0; i <= pointsCount; i++) {
        const t = i / pointsCount;
        const x = l93Pts[0][0] + (l93Pts[1][0] - l93Pts[0][0]) * t;
        const y = l93Pts[0][1] + (l93Pts[1][1] - l93Pts[0][1]) * t;
        const z = getZ([x, y]) || 0;
        
        chartData.push({ x: (t * totalDist).toFixed(1), y: z });
        geoRef.push(proj4("EPSG:2154", "EPSG:4326", [x, y]));
    }

    if (chartInstance) chartInstance.destroy();
    
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{ label: 'Altitude Z (m)', data: chartData, borderColor: '#3498db', backgroundColor: 'rgba(52, 152, 219, 0.2)', fill: true, pointRadius: 0 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: { x: { type: 'linear' } },
            onHover: (event, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const pos = geoRef[idx];
                    // Affichage du point rouge sur la carte
                    if (!cursorMarker) cursorMarker = L.circleMarker([pos[1], pos[0]], { radius: 6, color: 'red', fillColor: '#fff', fillOpacity: 1 }).addTo(map);
                    else cursorMarker.setLatLng([pos[1], pos[0]]);
                }
            }
        }
    });

    // Cacher le curseur rouge quand la souris quitte le graphique
    document.getElementById('profileChart').onmouseleave = () => {
        if (cursorMarker) { map.removeLayer(cursorMarker); cursorMarker = null; }
    };
}

// ==========================================
// 5. SUIVI SOURIS (COORDONNÉES)
// ==========================================
map.on('mousemove', (e) => {
    const l93 = proj4("EPSG:4326", "EPSG:2154", [e.latlng.lng, e.latlng.lat]);
    const z = getZ(l93);
    document.getElementById('cur-x').textContent = l93[0].toFixed(2);
    document.getElementById('cur-y').textContent = l93[1].toFixed(2);
    document.getElementById('cur-z').textContent = z !== null ? z.toFixed(2) : "---";
});

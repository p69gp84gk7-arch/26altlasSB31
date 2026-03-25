// ==========================================
// 1. CONFIGURATION ET FONDS DE CARTE
// ==========================================
proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

const map = L.map('map', { doubleClickZoom: false }).setView([42.7905, 0.5912], 14);

// Définition de 3 fonds de carte différents
const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
    maxZoom: 19, attribution: 'Esri Satellite' 
});

const planOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
    maxZoom: 19, attribution: '© OpenStreetMap' 
});

const topoMap = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { 
    maxZoom: 17, attribution: '© OpenTopoMap' 
});

// On met le satellite par défaut
satellite.addTo(map);

// On ajoute le menu en haut à droite pour pouvoir changer
L.control.layers({
    "🌍 Satellite (Esri)": satellite,
    "🗺️ Plan (OSM)": planOSM,
    "⛰️ Topographie": topoMap
}).addTo(map);

// Variables globales
let mntStore = [];
let drawStore = [];
let currentPoints = [];
let tempLayer = null;
let currentTool = null;
let chartInstance = null;
let cursorMarker = null;
let currentProfileExportData = [];

// ==========================================
// 2. IMPORTATION MNT
// ==========================================
document.getElementById('file-input').onchange = async (e) => {
    for (const file of e.target.files) {
        if (!file.name.match(/\.(tif|tiff)$/i)) continue;
        
        try {
            const buffer = await file.arrayBuffer();
            const tiff = await GeoTIFF.fromArrayBuffer(buffer);
            const image = await tiff.getImage();
            const bbox = image.getBoundingBox();
            const raster = await image.readRasters();
            
            const sw = proj4("EPSG:2154", "EPSG:4326", [bbox[0], bbox[1]]);
            const ne = proj4("EPSG:2154", "EPSG:4326", [bbox[2], bbox[3]]);
            const visual = L.rectangle([[sw[1], sw[0]], [ne[1], ne[0]]], { color: "#00d1b2", weight: 2, fillOpacity: 0.15 }).addTo(map);

            const id = Date.now() + Math.random();
            mntStore.push({ id, name: file.name, bbox, width: image.getWidth(), height: image.getHeight(), data: raster[0], visual, visible: true });
            
            map.fitBounds(visual.getBounds());
        } catch(err) {
            console.error("Erreur lecture:", err);
        }
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

function getZ(l93) {
    for (let m of mntStore) {
        if (!m.visible) continue;
        if (l93[0] >= m.bbox[0] && l93[0] <= m.bbox[2] && l93[1] >= m.bbox[1] && l93[1] <= m.bbox[3]) {
            const px = ((l93[0] - m.bbox[0]) / (m.bbox[2] - m.bbox[0])) * m.width;
            const py = ((m.bbox[3] - l93[1]) / (m.bbox[3] - m.bbox[1])) * m.height;
            
            const x1 = Math.floor(px), x2 = Math.min(x1 + 1, m.width - 1);
            const y1 = Math.floor(py), y2 = Math.min(y1 + 1, m.height - 1);

            const dx = px - x1, dy = py - y1;
            const q11 = m.data[y1 * m.width + x1] || 0;
            const q21 = m.data[y1 * m.width + x2] || 0;
            const q12 = m.data[y2 * m.width + x1] || 0;
            const q22 = m.data[y2 * m.width + x2] || 0;

            if (q11 < -500) return null;
            return (1-dx)*(1-dy)*q11 + dx*(1-dy)*q21 + (1-dx)*dy*q12 + dx*dy*q22;
        }
    } return null;
}

// ==========================================
// 3. OUTILS DE TRACÉ SÉCURISÉS (BOUTON MOBILE)
// ==========================================
window.startTool = (tool) => {
    currentTool = tool;
    currentPoints = [];
    if (tempLayer) map.removeLayer(tempLayer);
    
    document.querySelectorAll('.btn-tool').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById('btn-' + tool);
    activeBtn.classList.add('active');

    const finishBtn = document.getElementById('btn-finish');
    activeBtn.insertAdjacentElement('afterend', finishBtn);

    if (tool === 'line' || tool === 'area') {
        finishBtn.style.display = 'block';
    } else {
        finishBtn.style.display = 'none';
    }
};

map.on('click', (e) => {
    if (!currentTool) return;
    
    currentPoints.push(e.latlng);
    if (tempLayer) map.removeLayer(tempLayer);
    
    const color = currentTool === 'area' ? '#e67e22' : (currentTool === 'profile' ? '#f1c40f' : '#3498db');
    
    if (currentTool === 'area') {
        tempLayer = L.polygon(currentPoints, { color, weight: 3, fillOpacity: 0.3 }).addTo(map);
    } else {
        tempLayer = L.polyline(currentPoints, { color, weight: 4 }).addTo(map);
    }

    if (currentTool === 'profile' && currentPoints.length === 2) {
        window.finalizeDraw();
    }
});

window.finalizeDraw = () => {
    if (!currentTool || currentPoints.length < 2) {
        alert("Veuillez placer au moins 2 points sur la carte.");
        return;
    }
    
    try {
        const type = currentTool;
        const color = type === 'area' ? '#e67e22' : (type === 'profile' ? '#f1c40f' : '#3498db');
        
        const layer = type === 'area' 
            ? L.polygon(currentPoints, { color, weight: 3, fillOpacity: 0.3 }).addTo(map) 
            : L.polyline(currentPoints, { color, weight: 4 }).addTo(map);

        if (tempLayer) map.removeLayer(tempLayer);
        tempLayer = null;

        const drawObj = { 
            id: Date.now(), type, layer, 
            ptsGPS: [...currentPoints], 
            visible: true, color, 
            editGroup: L.layerGroup().addTo(map) 
        };
        
        drawStore.push(drawObj);
        recalculateStats(drawObj);
        makeEditable(drawObj);
        
        if (type === 'profile') generateProfile(drawObj);
        
        currentTool = null;
        currentPoints = [];
        document.querySelectorAll('.btn-tool').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-finish').style.display = 'none';
        
    } catch (e) {
        console.error("Erreur de finalisation :", e);
    }
};

// ==========================================
// 4. CALCULS ET ÉDITION (LIVE)
// ==========================================
function recalculateStats(d) {
    const l93 = d.ptsGPS.map(p => proj4("EPSG:4326", "EPSG:2154", [p.lng, p.lat]));
    
    if (d.type === 'profile' || d.type === 'line') {
        let dist = 0;
        for (let i = 1; i < l93.length; i++) {
            dist += Math.sqrt(Math.pow(l93[i][0]-l93[i-1][0], 2) + Math.pow(l93[i][1]-l93[i-1][1], 2));
        }
        const z1 = getZ(l93[0]) || 0;
        const z2 = getZ(l93[l93.length-1]) || 0;
        const dz = Math.abs(z2 - z1);
        const pente = dist > 0 ? (dz / dist * 100).toFixed(1) : 0;
        
        d.totalDist = dist;
        d.statsHtml = `L: <b>${dist.toFixed(2)} m</b> | Pente: <b>${pente}%</b><br>ΔZ: <b>${dz.toFixed(2)} m</b>`;
    } else if (d.type === 'area') {
        let area = 0;
        for (let i = 0; i < l93.length; i++) {
            let j = (i+1) % l93.length;
            area += l93[i][0]*l93[j][1] - l93[j][0]*l93[i][1];
        }
        d.statsHtml = `Surface: <b>${(Math.abs(area)/2).toFixed(2)} m²</b>`;
    }
    
    const statsDiv = document.getElementById(`stats-${d.id}`);
    if (statsDiv) statsDiv.innerHTML = d.statsHtml;
    else updateDrawUI();
}

function updateDrawUI() {
    const list = document.getElementById('measure-list');
    list.innerHTML = '';
    drawStore.forEach(d => {
        const title = d.type === 'profile' ? 'PROFIL' : (d.type === 'line' ? 'LONGUEUR & PENTE' : 'SURFACE');
        list.innerHTML += `
        <div class="card" style="border-left-color: ${d.color}">
            <div class="card-header">
                <div>
                    <input type="checkbox" ${d.visible ? 'checked' : ''} onchange="toggleDraw(${d.id})">
                    <input type="color" class="color-picker" value="${d.color}" onchange="changeColor(${d.id}, this.value)">
                    <strong>${title}</strong>
                </div>
                <button class="btn-del" onclick="deleteDraw(${d.id})">✕</button>
            </div>
            <div id="stats-${d.id}" style="margin-top:5px; font-size:1.1em;">${d.statsHtml}</div>
            ${d.type === 'profile' ? `<button onclick="generateProfileById(${d.id})" style="width:100%; margin-top:8px; font-size:0.8em; cursor:pointer; background:#333; color:white; border:1px solid #555; padding:5px; border-radius:3px;">Afficher le profil</button>` : ''}
        </div>`;
    });
}

function makeEditable(d) {
    d.editGroup.clearLayers();
    if (!d.visible) return;

    const icon = L.divIcon({ className: 'edit-handle', iconSize: [12, 12] });

    d.ptsGPS.forEach((pt, idx) => {
        const marker = L.marker(pt, { icon, draggable: true }).addTo(d.editGroup);
        
        marker.on('drag', (e) => {
            d.ptsGPS[idx] = e.latlng;
            d.layer.setLatLngs(d.ptsGPS);
            recalculateStats(d);
            if (d.type === 'profile') generateProfile(d);
        });
    });
}

window.toggleDraw = (id) => {
    const d = drawStore.find(x => x.id === id);
    d.visible = !d.visible;
    if (d.visible) { d.layer.addTo(map); makeEditable(d); } 
    else { map.removeLayer(d.layer); d.editGroup.clearLayers(); }
};

window.changeColor = (id, color) => {
    const d = drawStore.find(x => x.id === id);
    d.color = color; d.layer.setStyle({ color: color });
    updateDrawUI();
};

window.deleteDraw = (id) => {
    const d = drawStore.find(x => x.id === id);
    map.removeLayer(d.layer); map.removeLayer(d.editGroup);
    drawStore = drawStore.filter(x => x.id !== id);
    updateDrawUI();
    document.getElementById('profile-window').style.display = 'none';
};

// ==========================================
// 5. PROFIL ALTIMÉTRIQUE & EXPORTS
// ==========================================
window.generateProfileById = (id) => {
    const d = drawStore.find(x => x.id === id);
    generateProfile(d);
};

function generateProfile(d) {
    document.getElementById('profile-window').style.display = 'block';
    const ctx = document.getElementById('profileChart').getContext('2d');
    
    const l93Pts = d.ptsGPS.map(p => proj4("EPSG:4326", "EPSG:2154", [p.lng, p.lat]));
    let chartData = [];
    let geoRef = [];
    currentProfileExportData = []; 
    const pointsCount = 100;

    for (let i = 0; i <= pointsCount; i++) {
        const t = i / pointsCount;
        const x = l93Pts[0][0] + (l93Pts[1][0] - l93Pts[0][0]) * t;
        const y = l93Pts[0][1] + (l93Pts[1][1] - l93Pts[0][1]) * t;
        const z = getZ([x, y]) || 0;
        
        const currentDist = t * d.totalDist;
        chartData.push({ x: parseFloat(currentDist.toFixed(2)), y: parseFloat(z.toFixed(3)) }); 
        
        const gps = proj4("EPSG:2154", "EPSG:4326", [x, y]);
        geoRef.push(gps);
        
        currentProfileExportData.push({ dist: currentDist.toFixed(2), z: z.toFixed(3), lat: gps[1].toFixed(6), lng: gps[0].toFixed(6), x: x.toFixed(2), y: y.toFixed(2) });
    }

    if (chartInstance) chartInstance.destroy();
    
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{ 
                label: 'Altitude Z (m)', 
                data: chartData, 
                borderColor: d.color, 
                backgroundColor: d.color + '33', 
                fill: true, pointRadius: 0, tension: 0.1 
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: { 
                x: { type: 'linear', title: { display: true, text: 'Distance (m)' } },
                y: { title: { display: true, text: 'Z (m)' } }
            },
            onHover: (event, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const pos = geoRef[idx];
                    if (!cursorMarker) cursorMarker = L.circleMarker([pos[1], pos[0]], { radius: 6, color: 'red', fillColor: '#fff', fillOpacity: 1 }).addTo(map);
                    else cursorMarker.setLatLng([pos[1], pos[0]]);
                }
            }
        }
    });

    document.getElementById('profileChart').onmouseleave = () => {
        if (cursorMarker) { map.removeLayer(cursorMarker); cursorMarker = null; }
    };
}

window.exportChartPNG = () => {
    const a = document.createElement('a');
    a.href = document.getElementById('profileChart').toDataURL('image/png');
    a.download = 'profil_luchon.png';
    a.click();
};

window.exportChartCSV = () => {
    let csv = "\ufeffDistance (m);Altitude Z (m);Latitude (GPS);Longitude (GPS);X (Lambert 93);Y (Lambert 93)\n";
    currentProfileExportData.forEach(row => {
        let dist = row.dist.replace('.', ',');
        let z = row.z.replace('.', ',');
        let lat = row.lat.replace('.', ',');
        let lng = row.lng.replace('.', ',');
        let x = row.x.replace('.', ',');
        let y = row.y.replace('.', ',');
        csv += `${dist};${z};${lat};${lng};${x};${y}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export_profil_altimetrique.csv';
    a.click();
};

// ==========================================
// 6. SUIVI SOURIS COORDONNÉES (SÉCURISÉ)
// ==========================================
map.on('mousemove', (e) => {
    try {
        // Sécurité : on vérifie que la souris est bien sur la carte
        if (!e.latlng) return;
        
        // 1. Conversion GPS vers Lambert 93
        const l93 = proj4("EPSG:4326", "EPSG:2154", [e.latlng.lng, e.latlng.lat]);
        
        // 2. Mise à jour des textes X et Y
        const elX = document.getElementById('cur-x');
        const elY = document.getElementById('cur-y');
        if (elX) elX.innerText = l93[0].toFixed(2);
        if (elY) elY.innerText = l93[1].toFixed(2);
        
        // 3. Extraction et mise à jour de l'altitude Z
        const elZ = document.getElementById('cur-z');
        if (elZ) {
            let z = null;
            try { 
                z = getZ(l93); 
            } catch (err) { 
                /* On ignore les erreurs de lecture MNT si on est hors zone */ 
            }
            
            // Affichage avec 3 chiffres après la virgule, ou "---" si on est dans le vide
            elZ.innerText = (z !== null && !isNaN(z)) ? z.toFixed(3) : "---";
        }
    } catch (error) {
        console.warn("Erreur mineure de suivi souris ignorée :", error);
    }
});
// ==========================================
// 7. FENÊTRE FLOTTANTE (DRAG & DROP)
// ==========================================
const profileWin = document.getElementById('profile-window');
const profileHeader = document.getElementById('profile-header');

let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

profileHeader.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    const rect = profileWin.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    let newX = e.clientX - dragOffsetX;
    let newY = e.clientY - dragOffsetY;
    
    if (newX < 0) newX = 0;
    if (newY < 0) newY = 0;
    
    profileWin.style.bottom = 'auto'; 
    profileWin.style.right = 'auto';  
    profileWin.style.left = newX + 'px';
    profileWin.style.top = newY + 'px';
});

document.addEventListener('mouseup', () => { isDragging = false; });

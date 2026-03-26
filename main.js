// ==========================================
// 1. CONFIGURATION ET FONDS DE CARTE
// ==========================================
proj4.defs("EPSG:2154","+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs");

const map = L.map('map', { doubleClickZoom: false }).setView([42.7905, 0.5912], 14);

const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri Satellite' });
const planOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
const topoMap = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenTopoMap' });

satellite.addTo(map);
L.control.layers({ "🌍 Satellite": satellite, "🗺️ Plan": planOSM, "⛰️ Topographie": topoMap }).addTo(map);

// Variables globales
let mntStore = [];
let drawStore = [];
let kmzStore = []; 
let currentPoints = [];
let tempLayer = null;
let currentTool = null;
let chartInstance = null;
let cursorMarker = null;
let currentProfileExportData = [];
let currentProfileDrawId = null; // Pour synchroniser la couleur

// ==========================================
// 2. IMPORTATION MNT
// ==========================================
document.getElementById('mnt-input').onchange = async (e) => {
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

            mntStore.push({ id: Date.now()+Math.random(), name: file.name, bbox, width: image.getWidth(), height: image.getHeight(), data: raster[0], visual, visible: true });
            map.fitBounds(visual.getBounds());
        } catch(err) { console.error(err); }
    }
    updateMntUI();
};

function updateMntUI() {
    const list = document.getElementById('mnt-list');
    list.innerHTML = '';
    mntStore.forEach(m => {
        list.innerHTML += `<div class="card"><div class="card-header"><div><input type="checkbox" ${m.visible ? 'checked' : ''} onchange="toggleMNT(${m.id})"> <span>${m.name.substring(0,18)}...</span></div><button class="btn-del" onclick="deleteMNT(${m.id})">✕</button></div></div>`;
    });
}

window.toggleMNT = (id) => { const m = mntStore.find(x => x.id === id); m.visible = !m.visible; if (m.visible) m.visual.addTo(map); else map.removeLayer(m.visual); };
window.deleteMNT = (id) => { const m = mntStore.find(x => x.id === id); map.removeLayer(m.visual); mntStore = mntStore.filter(x => x.id !== id); updateMntUI(); };

function getZ(l93) {
    for (let m of mntStore) {
        if (!m.visible) continue;
        if (l93[0] >= m.bbox[0] && l93[0] <= m.bbox[2] && l93[1] >= m.bbox[1] && l93[1] <= m.bbox[3]) {
            const px = ((l93[0] - m.bbox[0]) / (m.bbox[2] - m.bbox[0])) * m.width;
            const py = ((m.bbox[3] - l93[1]) / (m.bbox[3] - m.bbox[1])) * m.height;
            const x1 = Math.floor(px), x2 = Math.min(x1 + 1, m.width - 1);
            const y1 = Math.floor(py), y2 = Math.min(y1 + 1, m.height - 1);
            const dx = px - x1, dy = py - y1;
            const q11 = m.data[y1 * m.width + x1] || 0; const q21 = m.data[y1 * m.width + x2] || 0;
            const q12 = m.data[y2 * m.width + x1] || 0; const q22 = m.data[y2 * m.width + x2] || 0;
            if (q11 < -500) return null;
            return (1-dx)*(1-dy)*q11 + dx*(1-dy)*q21 + (1-dx)*dy*q12 + dx*dy*q22;
        }
    } return null;
}

// ==========================================
// 3. GESTION DES KMZ
// ==========================================
document.getElementById('kmz-input').onchange = (e) => {
    const file = e.target.files[0];
    if (file) { const url = URL.createObjectURL(file); processKMZ(url, file.name); }
};

window.loadGithubKMZ = () => {
    const url = prompt("Entrez l'URL raw du fichier .kmz sur GitHub\n(ex: https://raw.githubusercontent.com/user/repo/branch/pistes.kmz)");
    if (url) processKMZ(url, "pistes_github.kmz");
};

function processKMZ(url, name) {
    const kmzLayer = L.kmzLayer().addTo(map);
    kmzLayer.on('load', function(e) {
        const id = Date.now();
        kmzStore.push({ id, name, layer: e.layer, visible: true, color: '#e74c3c', weight: 3 });
        updateKmzUI();
        applyKmzStyle(id);
        map.fitBounds(e.layer.getBounds());
    });
    kmzLayer.load(url);
}

function updateKmzUI() {
    const list = document.getElementById('kmz-list'); list.innerHTML = '';
    kmzStore.forEach(k => {
        list.innerHTML += `<div class="card" style="border-left-color: ${k.color}"><div class="card-header"><div><input type="checkbox" ${k.visible ? 'checked' : ''} onchange="toggleKMZ(${k.id})"> <input type="color" class="color-picker" value="${k.color}" onchange="changeKmzColor(${k.id}, this.value)"> <span>${k.name.substring(0,15)}...</span></div><button class="btn-del" onclick="deleteKMZ(${k.id})">✕</button></div><div style="margin-top:5px; font-size: 0.9em;">Épaisseur : <input type="range" min="1" max="10" value="${k.weight}" class="slider-width" onchange="changeKmzWeight(${k.id}, this.value)"></div></div>`;
    });
}

window.toggleKMZ = (id) => { const k = kmzStore.find(x => x.id === id); k.visible = !k.visible; if (k.visible) k.layer.addTo(map); else map.removeLayer(k.layer); };
window.deleteKMZ = (id) => { const k = kmzStore.find(x => x.id === id); map.removeLayer(k.layer); kmzStore = kmzStore.filter(x => x.id !== id); updateKmzUI(); };
window.changeKmzColor = (id, color) => { const k = kmzStore.find(x => x.id === id); k.color = color; applyKmzStyle(id); updateKmzUI(); };
window.changeKmzWeight = (id, weight) => { const k = kmzStore.find(x => x.id === id); k.weight = parseInt(weight); applyKmzStyle(id); updateKmzUI(); };

function applyKmzStyle(id) {
    const k = kmzStore.find(x => x.id === id); if (!k) return;
    k.layer.eachLayer(l => {
        if (l.eachLayer) { l.eachLayer(sub => { if (sub.setStyle) sub.setStyle({ color: k.color, weight: k.weight }); }); }
        else if (l.setStyle) { l.setStyle({ color: k.color, weight: k.weight }); }
    });
}

// ==========================================
// 4. OUTILS DE TRACÉ SÉCURISÉS
// ==========================================
window.startTool = (tool) => {
    currentTool = tool; currentPoints = [];
    if (tempLayer) map.removeLayer(tempLayer);
    document.querySelectorAll('.btn-tool').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-' + tool).classList.add('active');
    const finishBtn = document.getElementById('btn-finish'); activeBtn = document.getElementById('btn-' + tool);
    activeBtn.insertAdjacentElement('afterend', finishBtn);
    finishBtn.style.display = 'block';
};

map.on('click', (e) => {
    if (!currentTool) return; currentPoints.push(e.latlng);
    if (tempLayer) map.removeLayer(tempLayer);
    const color = currentTool === 'area' ? '#e67e22' : '#3498db';
    if (currentTool === 'area') tempLayer = L.polygon(currentPoints, { color, weight: 3, fillOpacity: 0.3 }).addTo(map);
    else tempLayer = L.polyline(currentPoints, { color, weight: 4 }).addTo(map);
});

window.finalizeDraw = () => {
    if (!currentTool || currentPoints.length < 2) { alert("Veuillez placer au moins 2 points."); return; }
    try {
        const type = currentTool; const color = type === 'area' ? '#e67e22' : '#3498db';
        const layer = type === 'area' ? L.polygon(currentPoints, { color, weight: 3, fillOpacity: 0.3 }).addTo(map) : L.polyline(currentPoints, { color, weight: 4 }).addTo(map);
        if (tempLayer) map.removeLayer(tempLayer); tempLayer = null;
        const drawObj = { id: Date.now(), type, layer, ptsGPS: [...currentPoints], visible: true, color, editGroup: L.layerGroup().addTo(map) };
        drawStore.push(drawObj); recalculateStats(drawObj); makeEditable(drawObj);
        if (type === 'line') { currentProfileDrawId = drawObj.id; generateProfile(drawObj); } 
        currentTool = null; currentPoints = [];
        document.querySelectorAll('.btn-tool').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-finish').style.display = 'none';
    } catch (e) { console.error(e); }
};

// ==========================================
// 5. CALCULS ET ÉDITION LIVE
// ==========================================
function recalculateStats(d) {
    const l93 = d.ptsGPS.map(p => proj4("EPSG:4326", "EPSG:2154", [p.lng, p.lat]));
    if (d.type === 'line') {
        let dist = 0;
        for (let i = 1; i < l93.length; i++) dist += Math.hypot(l93[i][0]-l93[i-1][0], l93[i][1]-l93[i-1][1]);
        const z1 = getZ(l93[0]) || 0; const z2 = getZ(l93[l93.length-1]) || 0;
        const dz = Math.abs(z2 - z1); pente = dist > 0 ? (dz / dist * 100).toFixed(1) : 0;
        d.totalDist = dist; d.statsHtml = `Dist: <b>${dist.toFixed(1)} m</b> | ΔZ: <b>${dz.toFixed(1)} m</b> | Pente Moy: <b>${pente}%</b>`;
    } else {
        let area = 0;
        for (let i = 0; i < l93.length; i++) { let j = (i+1) % l93.length; area += l93[i][0]*l93[j][1] - l93[j][0]*l93[i][1]; }
        d.statsHtml = `Surface: <b>${(Math.abs(area)/2).toFixed(1) } m²</b>`;
    }
    const statsDiv = document.getElementById(`stats-${d.id}`); if (statsDiv) statsDiv.innerHTML = d.statsHtml; else updateDrawUI();
}

function updateDrawUI() {
    const list = document.getElementById('measure-list'); list.innerHTML = '';
    drawStore.forEach(d => {
        const title = d.type === 'line' ? 'PARCOURS' : 'SURFACE';
        list.innerHTML += `<div class="card" style="border-left-color: ${d.color}"><div class="card-header"><div><input type="checkbox" ${d.visible ? 'checked' : ''} onchange="toggleDraw(${d.id})"> <input type="color" class="color-picker" value="${d.color}" onchange="changeColor(${d.id}, this.value)"> <strong>${title}</strong></div><button class="btn-del" onclick="deleteDraw(${d.id})">✕</button></div><div id="stats-${d.id}" style="margin-top:5px; font-size:1.1em;">${d.statsHtml}</div>${d.type === 'line' ? `<button onclick="generateProfileById(${d.id})" style="width:100%; margin-top:8px; font-size:0.8em; cursor:pointer; background:#333; color:white; border:1px solid #555; padding:5px; border-radius:3px;">Afficher le profil</button>` : ''}</div>`;
    });
}

function makeEditable(d) {
    d.editGroup.clearLayers(); if (!d.visible) return;
    const icon = L.divIcon({ className: 'edit-handle', iconSize: [12, 12] });
    d.ptsGPS.forEach((pt, idx) => {
        const marker = L.marker(pt, { icon, draggable: true }).addTo(d.editGroup);
        marker.on('drag', (e) => {
            d.ptsGPS[idx] = e.latlng; d.layer.setLatLngs(d.ptsGPS); recalculateStats(d);
            if (d.type === 'line') generateProfile(d);
        });
    });
}

window.toggleDraw = (id) => { const d = drawStore.find(x => x.id === id); d.visible = !d.visible; if (d.visible) { d.layer.addTo(map); makeEditable(d); } else { map.removeLayer(d.layer); d.editGroup.clearLayers(); } };

// CORRECTION ICI : Synchronisation immédiate de la couleur avec le graphique
window.changeColor = (id, color) => {
    const d = drawStore.find(x => x.id === id); if (!d) return;
    d.color = color; d.layer.setStyle({ color: color }); updateDrawUI();
    // Si ce tracé est affiché dans le graphique, on met à jour la courbe
    if (chartInstance && currentProfileDrawId === id) {
        chartInstance.data.datasets[0].borderColor = color;
        chartInstance.data.datasets[0].backgroundColor = color + '33'; // 20% transparence
        chartInstance.update();
    }
};

window.deleteDraw = (id) => { const d = drawStore.find(x => x.id === id); map.removeLayer(d.layer); map.removeLayer(d.editGroup); drawStore = drawStore.filter(x => x.id !== id); updateDrawUI(); document.getElementById('profile-window').style.display = 'none'; if(currentProfileDrawId === id) currentProfileDrawId = null; };

// ==========================================
// 6. PROFIL ALTIMÉTRIQUE HAUTE PRÉCISION
// ==========================================
window.generateProfileById = (id) => { currentProfileDrawId = id; const d = drawStore.find(x => x.id === id); generateProfile(d); };

function generateProfile(d) {
    document.getElementById('profile-window').style.display = 'block';
    const ctx = document.getElementById('profileChart').getContext('2d');
    
    // Coordonnées Lambert 93 des sommets réels
    const l93Pts = d.ptsGPS.map(p => proj4("EPSG:4326", "EPSG:2154", [p.lng, p.lat]));
    
    // 1. Calculer les distances cumulées précises à chaque sommet
    let cumulativeDistances = [0];
    let totalDist = 0;
    for (let i = 1; i < l93Pts.length; i++) {
        totalDist += Math.hypot(l93Pts[i][0]-l93Pts[i-1][0], l93Pts[i][1]-l93Pts[i-1][1]);
        cumulativeDistances.push(totalDist);
    }

    let chartData = []; let geoRef = []; currentProfileExportData = []; 
    
    // CORRECTION PRÉCISION : Échantillonnage basé sur une distance fixe + points réels
    const samplingInterval = 10; // Nous lisons l'altitude tous les 10 mètres le long du parcours

    // Ajouter le point de départ réel
    let zStart = getZ(l93Pts[0]) || 0;
    let gpsStart = proj4("EPSG:2154", "EPSG:4326", [l93Pts[0][0], l93Pts[0][1]]);
    addPointToChart(0, zStart, gpsStart, l93Pts[0][0], l93Pts[0][1]);

    let nextSampleDist = samplingInterval;

    // Parcourir chaque segment du tracé
    for (let i = 1; i < l93Pts.length; i++) {
        const segLen = cumulativeDistances[i] - cumulativeDistances[i-1];
        const p1 = l93Pts[i-1]; const p2 = l93Pts[i];

        // Échantillonner à intervalle fixe à l'intérieur du segment
        while (nextSampleDist < cumulativeDistances[i]) {
            const distInSeg = nextSampleDist - cumulativeDistances[i-1];
            const t = segLen === 0 ? 0 : distInSeg / segLen;
            const x = p1[0] + (p2[0] - p1[0]) * t;
            const y = p1[1] + (p2[1] - p1[1]) * t;
            const z = getZ([x, y]) || 0;
            const gps = proj4("EPSG:2154", "EPSG:4326", [x, y]);
            addPointToChart(nextSampleDist, z, gps, x, y);
            nextSampleDist += samplingInterval;
        }

        // Toujours inclure le sommet réel p2 pour une précision maximale aux virages
        let zReal = getZ(l93Pts[i]) || 0;
        let gpsReal = proj4("EPSG:2154", "EPSG:4326", [l93Pts[i][0], l93Pts[i][1]]);
        // On évite un duplicata si l'échantillon tombe pile sur le sommet
        if (Math.abs(cumulativeDistances[i] - (nextSampleDist - samplingInterval)) > 0.1) {
             addPointToChart(cumulativeDistances[i], zReal, gpsReal, l93Pts[i][0], l93Pts[i][1]);
        }
    }

    // Fonction interne pour structurer les données
    function addPointToChart(dist, z, gps, x, y) {
        chartData.push({ x: parseFloat(dist.toFixed(1)), y: parseFloat(z.toFixed(2)) }); 
        geoRef.push(gps);
        currentProfileExportData.push({ dist: dist.toFixed(2), z: z.toFixed(3), lat: gps[1].toFixed(6), lng: gps[0].toFixed(6), x: x.toFixed(2), y: y.toFixed(2) });
    }

    // Création du graphique Chart.js
    if (chartInstance) chartInstance.destroy();
    
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: { datasets: [{ label: 'Altitude Z (m)', data: chartData, borderColor: d.color, backgroundColor: d.color + '33', fill: true, pointRadius: 0, tension: 0.1 }] },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            scales: { x: { type: 'linear', title: { display: true, text: 'Distance totale (m)' }, ticks: { precision: 0 } }, y: { title: { display: true, text: 'Altitude Z (m)' } } },
            onHover: (event, elements) => {
                if (elements.length > 0) {
                    const pos = geoRef[elements[0].index];
                    if (!cursorMarker) cursorMarker = L.circleMarker([pos[1], pos[0]], { radius: 6, color: 'red', fillColor: '#fff', fillOpacity: 1 }).addTo(map);
                    else cursorMarker.setLatLng([pos[1], pos[0]]);
                }
            }
        }
    });

    document.getElementById('profileChart').onmouseleave = () => { if (cursorMarker) { map.removeLayer(cursorMarker); cursorMarker = null; } };
}

window.exportChartPNG = () => { const a = document.createElement('a'); a.href = document.getElementById('profileChart').toDataURL('image/png'); a.download = 'profil.png'; a.click(); };
window.exportChartCSV = () => {
    let csv = "\ufeffDistance (m);Altitude Z (m);Latitude (GPS);Longitude (GPS);X (Lambert 93);Y (Lambert 93)\n";
    currentProfileExportData.forEach(row => { csv += `${row.dist.replace('.', ',')};${row.z.replace('.', ',')};${row.lat.replace('.', ',')};${row.lng.replace('.', ',')};${row.x.replace('.', ',')};${row.y.replace('.', ',')}\n`; });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'export_profil.csv'; a.click();
};

// ==========================================
// 7. SUIVI SOURIS COORDONNÉES
// ==========================================
map.on('mousemove', (e) => {
    try {
        if (!e.latlng) return;
        const l93 = proj4("EPSG:4326", "EPSG:2154", [e.latlng.lng, e.latlng.lat]);
        const elX = document.getElementById('cur-x'), elY = document.getElementById('cur-y'), elZ = document.getElementById('cur-z');
        if (elX) elX.innerText = l93[0].toFixed(1); if (elY) elY.innerText = l93[1].toFixed(1);
        if (elZ) { let z = null; try { z = getZ(l93); } catch (err) {} elZ.innerText = (z !== null && !isNaN(z)) ? z.toFixed(2) : "---"; }
    } catch (error) {}
});

// ==========================================
// 8. FENÊTRE FLOTTANTE (DRAG & DROP)
// ==========================================
const profileWin = document.getElementById('profile-window'), profileHeader = document.getElementById('profile-header');
let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;

profileHeader.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    const rect = profileWin.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left; dragOffsetY = e.clientY - rect.top;
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    let newX = e.clientX - dragOffsetX, newY = e.clientY - dragOffsetY;
    if (newX < 0) newX = 0; if (newY < 0) newY = 0;
    profileWin.style.bottom = 'auto'; profileWin.style.right = 'auto';  
    profileWin.style.left = newX + 'px'; profileWin.style.top = newY + 'px';
});

document.addEventListener('mouseup', () => { isDragging = false; });

// ==========================================
// 9. CHARGEMENT AUTOMATIQUE KMZ DEPUIS GITHUB
// ==========================================
// REMPLACEZ CETTE URL par l'URL "Raw" de votre fichier sur GitHub.
// Elle doit ressembler à https://raw.githubusercontent.com/user/repo/branch/pistes.kmz
const GITHUB_KMZ_URL = 'https://raw.githubusercontent.com/user/repo/branch/pistes.kmz'; 

window.addEventListener('load', () => {
    // Tentative de chargement automatique.
    // Note : Cela peut échouer si GitHub bloque la requête (CORS) ou si l'URL est fausse.
    if (GITHUB_KMZ_URL && GITHUB_KMZ_URL.includes('raw.githubusercontent.com')) {
        processKMZ(GITHUB_KMZ_URL, 'pistes.kmz');
    }
});

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

let mntStore = [];
let drawStore = [];
let kmzStore = []; 
let currentPoints = [];
let tempLayer = null;
let currentTool = null;
let chartInstance = null;
let cursorMarker = null;
let currentProfileExportData = [];
let currentProfileDrawId = null;

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
    const url = prompt("Entrez l'URL raw du fichier .kmz sur GitHub\n(ex: https://raw.githubusercontent.com/...)");
    if (url) processKMZ(url, "pistes.kmz");
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
// 4. OUTILS DE TRACÉ
// ==========================================
window.startTool = (tool) => {
    currentTool = tool; currentPoints = [];
    if (tempLayer) map.removeLayer(tempLayer);
    document.querySelectorAll('.btn-tool').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-' + tool).classList.add('active');
    const finishBtn = document.getElementById('btn-finish'); 
    const activeBtn = document.getElementById('btn-' + tool);
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
        const dz = Math.abs(z2 - z1); const pente = dist > 0 ? (dz / dist * 100).toFixed(1) : 0;
        d.totalDist = dist; d.statsHtml = `Dist: <b>${dist.toFixed(1)} m</b> | ΔZ: <b>${dz.toFixed(1)} m</b> | Pente Moy: <b>${pente}%</b>`;
    } else {
        let area = 0;
        for (let i = 0; i < l93.length; i++) { let j = (i+1) % l93.length; area += l93[i][0]*l93[j][1] - l93[j][0]*l93[i][1]; }
        d.statsHtml = `Surface: <b>${(Math.abs(area)/2).toFixed(1)} m²</b>`;
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

window.changeColor = (id, color) => {
    const d = drawStore.find(x => x.id === id); if (!d) return;
    d.color = color; d.layer.setStyle({ color: color }); updateDrawUI();
    if (chartInstance && currentProfileDrawId === id) {
        chartInstance.data.datasets[0].borderColor = color;
        chartInstance.data.datasets[0].backgroundColor = color + '33';
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
    
    const l93Pts = d.ptsGPS.map(p => proj4("EPSG:4326", "EPSG:2154", [p.lng, p.lat]));
    let cumulativeDistances = [0]; let totalDist = 0;
    for (let i = 1; i < l93Pts.length; i++) {
        totalDist += Math.hypot(l93Pts[i][0]-l93Pts[i-1][0], l93Pts[i][1]-l93Pts[i-1][1]);
        cumulativeDistances.push(totalDist);
    }

    let chartData = []; let geoRef = []; currentProfileExportData = []; 
    const samplingInterval = 1; 

    let zStart = getZ(l93Pts[0]) || 0;
    addPointToChart(0, zStart, [l93Pts[0][0], l93Pts[0][1]]);
    let nextSampleDist = samplingInterval;

    for (let i = 1; i < l93Pts.length; i++) {
        const segLen = cumulativeDistances[i] - cumulativeDistances[i-1];
        const p1 = l93Pts[i-1]; const p2 = l93Pts[i];

        while (nextSampleDist < cumulativeDistances[i]) {
            const distInSeg = nextSampleDist - cumulativeDistances[i-1];
            const t = segLen === 0 ? 0 : distInSeg / segLen;
            const x = p1[0] + (p2[0] - p1[0]) * t;
            const y = p1[1] + (p2[1] - p1[1]) * t;
            const z = getZ([x, y]) || 0;
            addPointToChart(nextSampleDist, z, [x, y]);
            nextSampleDist += samplingInterval;
        }

        let zReal = getZ(l93Pts[i]) || 0;
        if (Math.abs(cumulativeDistances[i] - (nextSampleDist - samplingInterval)) > 0.1) {
             addPointToChart(cumulativeDistances[i], zReal, [l93Pts[i][0], l93Pts[i][1]]);
        }
    }

    function addPointToChart(dist, z, l93Coords) {
        chartData.push({ x: parseFloat(dist.toFixed(1)), y: parseFloat(z.toFixed(2)) }); 
        const gps = proj4("EPSG:2154", "EPSG:4326", l93Coords);
        geoRef.push(gps);
        // CSV Épuré (Seulement distance et altitude Z)
        currentProfileExportData.push({ dist: dist.toFixed(2), z: z.toFixed(2) });
    }

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

    // --- CONFIGURATION AUTOMATIQUE DES CURSEURS ---
    const xMinSlider = document.getElementById('x-min');
    const xMaxSlider = document.getElementById('x-max');
    const yMinSlider = document.getElementById('y-min');
    const yMaxSlider = document.getElementById('y-max');

    let minZ = Math.min(...chartData.map(pt => pt.y));
    let maxZ = Math.max(...chartData.map(pt => pt.y));
    const zMargin = (maxZ - minZ) * 0.1 || 10;
    minZ = Math.floor(minZ - zMargin);
    maxZ = Math.ceil(maxZ + zMargin);

    if(xMinSlider && xMaxSlider && yMinSlider && yMaxSlider) {
        xMinSlider.min = 0; xMinSlider.max = d.totalDist; xMinSlider.value = 0; xMinSlider.step = d.totalDist / 200 || 1;
        xMaxSlider.min = 0; xMaxSlider.max = d.totalDist; xMaxSlider.value = d.totalDist; xMaxSlider.step = d.totalDist / 200 || 1;

        yMinSlider.min = minZ; yMinSlider.max = maxZ; yMinSlider.value = minZ; yMinSlider.step = 0.5;
        yMaxSlider.min = minZ; yMaxSlider.max = maxZ; yMaxSlider.value = maxZ; yMaxSlider.step = 0.5;
        
        document.getElementById('x-vals').innerText = `0m - ${d.totalDist.toFixed(0)}m`;
        document.getElementById('y-vals').innerText = `${minZ}m - ${maxZ}m`;
    }
}

window.exportChartPNG = () => { const a = document.createElement('a'); a.href = document.getElementById('profileChart').toDataURL('image/png'); a.download = 'profil.png'; a.click(); };
window.exportChartCSV = () => {
    // \t crée une vraie tabulation entre les colonnes
    let csv = "\ufeffDistance (m)\tAltitude Z (m)\n";
    
    currentProfileExportData.forEach(row => { 
        // On sépare la distance et l'altitude par \t
        csv += `${row.dist.replace('.', ',')}\t${row.z.replace('.', ',')}\n`; 
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); 
    a.href = URL.createObjectURL(blob); 
    a.download = 'export_profil_1m.csv'; 
    a.click();
};
// ==========================================
// 7. GESTION DES CURSEURS LIVE (SCALES)
// ==========================================
window.updateScalesLive = () => {
    if (!chartInstance) return;

    let xMin = parseFloat(document.getElementById('x-min').value);
    let xMax = parseFloat(document.getElementById('x-max').value);
    let yMin = parseFloat(document.getElementById('y-min').value);
    let yMax = parseFloat(document.getElementById('y-max').value);

    // Sécurité : Empêcher Min de croiser Max
    if (xMin >= xMax - 1) { xMin = xMax - 1; document.getElementById('x-min').value = xMin; }
    if (yMin >= yMax - 1) { yMin = yMax - 1; document.getElementById('y-min').value = yMin; }

    document.getElementById('x-vals').innerText = `${xMin.toFixed(0)}m - ${xMax.toFixed(0)}m`;
    document.getElementById('y-vals').innerText = `${yMin.toFixed(0)}m - ${yMax.toFixed(0)}m`;

    chartInstance.options.scales.x.min = xMin;
    chartInstance.options.scales.x.max = xMax;
    chartInstance.options.scales.y.min = yMin;
    chartInstance.options.scales.y.max = yMax;

    chartInstance.update('none'); // Update sans animation (Ultra fluide)
};

// ==========================================
// 8. SUIVI SOURIS COORDONNÉES
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
// 9. FENÊTRE FLOTTANTE (DRAG & DROP)
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
